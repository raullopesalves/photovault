import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { copyFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type { ImportSummary } from '@shared/types'
import { Library } from '@core/library/library'
import { ImportService } from '@core/import/service'

export interface Sandbox {
  dir: string
  source: string
  libraryRoot: string
  cleanup: () => void
}

export function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 'photovault-test-'))
  const source = join(dir, 'source')
  mkdirSync(source, { recursive: true })
  return { dir, source, libraryRoot: join(dir, 'library'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export interface JpegOptions {
  color?: string
  width?: number
  height?: number
  dateTimeOriginal?: string
  make?: string
  model?: string
  gps?: { lat: string; latRef: 'N' | 'S'; lon: string; lonRef: 'E' | 'W' }
}

/** Writes a real JPEG. Different colours/sizes produce different bytes. */
export async function makeJpeg(path: string, o: JpegOptions = {}): Promise<string> {
  mkdirSync(dirname(path), { recursive: true })
  const exif: Record<string, Record<string, string>> = {}
  if (o.make || o.model) exif.IFD0 = { ...(o.make ? { Make: o.make } : {}), ...(o.model ? { Model: o.model } : {}) }
  if (o.dateTimeOriginal) exif.IFD2 = { DateTimeOriginal: o.dateTimeOriginal }
  if (o.gps) exif.IFD3 = { GPSLatitudeRef: o.gps.latRef, GPSLatitude: o.gps.lat, GPSLongitudeRef: o.gps.lonRef, GPSLongitude: o.gps.lon }
  let img = sharp({ create: { width: o.width ?? 64, height: o.height ?? 48, channels: 3, background: o.color ?? '#3366cc' } }).jpeg({ quality: 90 })
  if (Object.keys(exif).length > 0) img = img.withExif(exif)
  await img.toFile(path)
  return path
}

export async function copy(from: string, to: string): Promise<void> {
  mkdirSync(dirname(to), { recursive: true })
  await copyFile(from, to)
}

export async function writeText(path: string, text: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/** Full import (scan -> analyze -> commit) the way the app does it. */
export async function runImport(library: Library, source: string | string[], opts: { commit?: boolean } = {}): Promise<ImportSummary> {
  const service = new ImportService(library)
  const id = await service.start(source)
  await service.settle()
  let p = service.current()
  if (p?.phase !== 'ready') throw new Error(`Import did not reach ready: ${p?.phase} ${p?.error}`)
  if (opts.commit !== false) {
    await service.commit(id)
    await service.settle()
    p = service.current()
    if (p?.phase !== 'completed') throw new Error(`Import did not complete: ${p?.phase} ${p?.error}`)
  }
  return p.summary as ImportSummary
}

export function openLibrary(root: string): Library {
  return Library.create(root)
}

export function count(library: Library, table: string): number {
  return library.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0
}

/** All files under originals/, relative, sorted. */
export function managedFiles(library: Library): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const r = rel ? `${rel}/${name}` : name
      if (statSync(full).isDirectory()) walk(full, r)
      else out.push(r)
    }
  }
  walk(library.paths.originals, '')
  return out.sort()
}

export interface ZipEntrySpec {
  name: string
  /** Copy bytes from this file… */
  file?: string
  /** …or use these bytes / this text. */
  data?: Buffer | string
  mtime?: Date
}

/** Writes a ZIP with yazl. `rename` rewrites raw entry names afterwards (to forge unsafe names yazl refuses to write). */
export async function makeZip(path: string, entries: ZipEntrySpec[], rename?: Array<[string, string]>): Promise<string> {
  const { ZipFile } = await import('yazl')
  const { readFile: rf, writeFile: wf } = await import('node:fs/promises')
  mkdirSync(dirname(path), { recursive: true })
  const zip = new ZipFile()
  for (const e of entries) {
    const data = e.file ? await rf(e.file) : typeof e.data === 'string' ? Buffer.from(e.data) : (e.data ?? Buffer.alloc(0))
    zip.addBuffer(data, e.name, { mtime: e.mtime ?? new Date('2020-01-01T12:00:00Z') })
  }
  zip.end()
  const chunks: Buffer[] = []
  for await (const c of zip.outputStream) chunks.push(c as Buffer)
  const buf = Buffer.concat(chunks)
  for (const [from, to] of rename ?? []) {
    if (from.length !== to.length) throw new Error('rename must keep the length')
    let idx = buf.indexOf(from)
    while (idx !== -1) {
      buf.write(to, idx, 'latin1')
      idx = buf.indexOf(from, idx + 1)
    }
  }
  await wf(path, buf)
  return path
}

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}

/** Minimal MP4: ftyp, mdat (padding) and moov with mvhd (creation time, duration) and tkhd (dimensions). */
export function makeMp4(opts: {
  createdUtc: Date
  durationS: number
  width: number
  height: number
  mdatBytes?: number
  moovFirst?: boolean
  /** Adds a sound track (handler 'soun'). Default: video only. */
  audio?: boolean
  /** QuickTime-style udta text tags, e.g. { '©cmt': 'vid:123' }. */
  tags?: Record<string, string>
}): Buffer {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\x02\0isommp41', 'latin1'))
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(Math.floor(opts.createdUtc.getTime() / 1000) + 2082844800, 4)
  mvhd.writeUInt32BE(1000, 12)
  mvhd.writeUInt32BE(opts.durationS * 1000, 16)
  const tkhd = Buffer.alloc(84)
  tkhd.writeUInt32BE(opts.width * 65536, 76)
  tkhd.writeUInt32BE(opts.height * 65536, 80)
  const hdlr = (type: string): Buffer => {
    const b = Buffer.alloc(24)
    b.write(type, 8, 'latin1')
    return box('hdlr', b)
  }
  const traks = [box('trak', box('tkhd', tkhd), box('mdia', hdlr('vide')))]
  if (opts.audio) traks.push(box('trak', box('tkhd', Buffer.alloc(84)), box('mdia', hdlr('soun'))))
  const udta = Object.entries(opts.tags ?? {}).map(([k, v]) => {
    const text = Buffer.from(v, 'utf8')
    const head = Buffer.alloc(4)
    head.writeUInt16BE(text.length, 0)
    return box(k, head, text)
  })
  const moov = box('moov', box('mvhd', mvhd), ...traks, ...(udta.length ? [box('udta', ...udta)] : []))
  const mdat = box('mdat', Buffer.alloc(opts.mdatBytes ?? 1024, 7))
  return opts.moovFirst ? Buffer.concat([ftyp, moov, mdat]) : Buffer.concat([ftyp, mdat, moov])
}

/** Photo-like test scene (gradient sky, sun, mountains, seeded texture). `shift` moves the "camera". */
export function photoScene(seed: number, shift = 0): Buffer {
  let r = seed * 9973
  const rnd = (): number => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648
  const blobs = Array.from(
    { length: 40 },
    () =>
      `<circle cx="${(rnd() * 1600 + shift) | 0}" cy="${(600 + rnd() * 500) | 0}" r="${(10 + rnd() * 90) | 0}" fill="hsl(${(rnd() * 360) | 0},50%,${(20 + rnd() * 50) | 0}%)" opacity="0.8"/>`
  ).join('')
  const hue = (seed * 47) % 360
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,30%)"/></linearGradient></defs>
    <rect width="1600" height="1200" fill="url(#g)"/><circle cx="${300 + shift + seed * 50}" cy="250" r="90" fill="#ffe"/>
    <path d="M0 800 L ${400 + shift} 500 L 900 800 L 1200 ${560 + seed * 10} L 1600 800 L 1600 1200 L 0 1200Z" fill="hsl(${hue + 180},30%,25%)"/>${blobs}</svg>`)
}
