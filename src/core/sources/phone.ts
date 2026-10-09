import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PhoneCopyProgress, PhoneDevice } from '@shared/types'

/**
 * Phones and cameras plugged in by USB appear in Windows as portable devices (MTP), not as drives, so Node
 * cannot read them. Windows' own Shell can: this PowerShell script lists the devices that have a DCIM or
 * Pictures folder and copies those folders into an ordinary folder, which is then imported as usual.
 *
 * The phone is only read. Files are copied into an empty ".incoming" folder first and then moved into place,
 * so nothing is ever overwritten; a file already copied earlier (same name and size) is not copied again.
 */
const SCRIPT = String.raw`
param([string]$Mode = 'list', [string]$Device = '', [string]$Dest = '', [string]$SourcePath = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$shell = New-Object -ComObject Shell.Application

function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }
function Clean([string]$n) { return ($n -replace '[<>:"/\\|?*\x00-\x1f]', '_').TrimEnd('. ') }

function Get-Devices {
  foreach ($i in $shell.Namespace(17).Items()) { if ($i.IsFolder -and -not $i.IsFileSystem) { $i } }
}

function Get-Roots($device) {
  $roots = @()
  foreach ($storage in $device.GetFolder.Items()) {
    if (-not $storage.IsFolder) { continue }
    if ($storage.Name -eq 'DCIM') { $roots += [pscustomobject]@{ Rel = 'DCIM'; Folder = $storage }; continue }
    foreach ($f in $storage.GetFolder.Items()) {
      if ($f.IsFolder -and ($f.Name -eq 'DCIM' -or $f.Name -eq 'Pictures')) {
        $roots += [pscustomobject]@{ Rel = (Clean $storage.Name) + '\' + $f.Name; Folder = $f }
      }
    }
  }
  return $roots
}

function Size($item) {
  try { $s = $item.ExtendedProperty('System.Size'); if ($s) { return [int64]$s } } catch { }
  try { return [int64]$item.Size } catch { return [int64]0 }
}

function FileName($item) {
  try { $n = $item.ExtendedProperty('System.FileName'); if ($n) { return [string]$n } } catch { }
  return [string]$item.Name
}

if ($Mode -eq 'list') {
  $out = @()
  foreach ($d in Get-Devices) {
    $folders = @()
    try { foreach ($r in Get-Roots $d) { $folders += $r.Rel } } catch { }
    $out += [pscustomobject]@{ name = [string]$d.Name; folders = $folders }
  }
  Emit @{ devices = $out }
  exit 0
}

if ($SourcePath) {
  $roots = @([pscustomobject]@{ Rel = 'DCIM'; Folder = $shell.Namespace($SourcePath).Self })
} else {
  $dev = Get-Devices | Where-Object { $_.Name -eq $Device } | Select-Object -First 1
  if (-not $dev) { Emit @{ error = 'not-found' }; exit 2 }
  $roots = @(Get-Roots $dev)
}

$files = New-Object System.Collections.ArrayList
function Walk($folder, [string]$rel) {
  foreach ($i in $folder.GetFolder.Items()) {
    if ($i.IsFolder -and -not ($i.IsFileSystem -and (Test-Path -LiteralPath $i.Path -PathType Leaf))) { Walk $i ($rel + '\' + (Clean $i.Name)) }
    else { [void]$files.Add([pscustomobject]@{ Item = $i; Rel = $rel }) }
  }
}
foreach ($r in $roots) { Walk $r.Folder $r.Rel }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$incoming = Join-Path $Dest '.incoming'
if (Test-Path -LiteralPath $incoming) { Remove-Item -LiteralPath $incoming -Recurse -Force }
New-Item -ItemType Directory -Force -Path $incoming | Out-Null
$inNs = $shell.Namespace($incoming)

$p = @{ total = $files.Count; done = 0; copied = 0; skipped = 0; failed = 0; bytes = [int64]0; current = '' }
Emit $p
foreach ($f in $files) {
  $name = Clean (FileName $f.Item)
  $size = Size $f.Item
  $dir = Join-Path $Dest $f.Rel
  $p.current = $name
  try {
    $target = Join-Path $dir $name
    if ($size -gt 0 -and (Test-Path -LiteralPath $target -PathType Leaf) -and (Get-Item -LiteralPath $target).Length -eq $size) {
      $p.skipped++
    } else {
      $inNs.CopyHere($f.Item, 4 + 16 + 512 + 1024)
      $deadline = (Get-Date).AddMinutes(15)
      $got = $null
      while (-not $got -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 120
        $c = Get-ChildItem -LiteralPath $incoming -File -Force | Select-Object -First 1
        if (-not $c -or ($size -gt 0 -and $c.Length -ne $size)) { continue }
        try { $h = [System.IO.File]::Open($c.FullName, 'Open', 'Read', 'None'); $h.Close(); $got = $c } catch { }
      }
      if (-not $got) { throw 'timed out' }
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      $stem = Clean ([System.IO.Path]::GetFileNameWithoutExtension($got.Name))
      $ext = [System.IO.Path]::GetExtension($got.Name)
      $hash = $null
      $k = 1
      while ($true) {
        $final = Join-Path $dir ($(if ($k -eq 1) { $stem + $ext } else { $stem + ' (' + $k + ')' + $ext }))
        if (-not (Test-Path -LiteralPath $final)) { break }
        if ((Get-Item -LiteralPath $final).Length -eq $got.Length) {
          if (-not $hash) { $hash = (Get-FileHash -LiteralPath $got.FullName -Algorithm SHA256).Hash }
          if ((Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash -eq $hash) { Remove-Item -LiteralPath $got.FullName -Force; $final = $null; $p.skipped++; break }
        }
        $k++
      }
      if ($final) {
        Move-Item -LiteralPath $got.FullName -Destination $final
        $p.copied++
        $p.bytes += $got.Length
      }
    }
  } catch {
    $p.failed++
    Get-ChildItem -LiteralPath $incoming -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  $p.done++
  Emit $p
}
Remove-Item -LiteralPath $incoming -Recurse -Force -ErrorAction SilentlyContinue
$p.current = ''
$p.finished = $true
Emit $p
`

function scriptPath(): string {
  const dir = join(tmpdir(), 'Photo Vault')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'phone.ps1')
  // BOM: Windows PowerShell 5.1 reads scripts without one in the ANSI code page.
  writeFileSync(p, '﻿' + SCRIPT.replace(/\r?\n/g, '\r\n'))
  return p
}

function run(args: string[], onLine: (o: Record<string, unknown>) => void, signal?: AbortSignal): Promise<number> {
  return new Promise((resolveRun, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Importing straight from a phone is only available on Windows.'))
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(), ...args], { windowsHide: true })
    let buf = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      buf += d
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/^﻿/, '').trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('{')) continue
        try {
          onLine(JSON.parse(line) as Record<string, unknown>)
        } catch {
          /* not ours */
        }
      }
    })
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    const abort = (): void => void child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', reject)
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return reject(new Error('Cancelled'))
      if (code !== 0 && code !== 2) return reject(new Error(err.trim().split('\n')[0] || `PowerShell exited with ${code}`))
      resolveRun(code ?? 0)
    })
  })
}

/** Portable devices (phones, cameras) currently connected, with the photo folders that can be read. */
export async function listPhones(): Promise<PhoneDevice[]> {
  let devices: PhoneDevice[] = []
  await run(['-Mode', 'list'], (o) => {
    const raw = o.devices
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    devices = list.map((d: { name?: unknown; folders?: unknown }) => ({
      name: String(d.name ?? ''),
      folders: (Array.isArray(d.folders) ? d.folders : d.folders ? [d.folders] : []).map(String)
    }))
  })
  return devices.filter((d) => d.name)
}

/**
 * Copies the device's DCIM and Pictures folders into `dest` (kept as `<storage>\DCIM\...`). `sourcePath`
 * replaces the device with an ordinary folder (tests).
 */
export async function copyFromPhone(
  device: string,
  dest: string,
  opts: { onProgress?: (p: PhoneCopyProgress) => void; signal?: AbortSignal; sourcePath?: string } = {}
): Promise<PhoneCopyProgress> {
  let last: PhoneCopyProgress = { device, folder: dest, total: 0, done: 0, copied: 0, skipped: 0, failed: 0, bytes: 0, current: '' }
  let notFound = false
  const args = ['-Mode', 'copy', '-Device', device, '-Dest', dest]
  if (opts.sourcePath) args.push('-SourcePath', opts.sourcePath)
  await run(
    args,
    (o) => {
      if (o.error === 'not-found') {
        notFound = true
        return
      }
      last = {
        device,
        folder: dest,
        total: Number(o.total) || 0,
        done: Number(o.done) || 0,
        copied: Number(o.copied) || 0,
        skipped: Number(o.skipped) || 0,
        failed: Number(o.failed) || 0,
        bytes: Number(o.bytes) || 0,
        current: typeof o.current === 'string' ? o.current : '',
        finished: o.finished === true
      }
      opts.onProgress?.(last)
    },
    opts.signal
  )
  if (notFound) throw new Error(`"${device}" is no longer connected. Plug it in, unlock it and allow access to photos.`)
  return last
}
