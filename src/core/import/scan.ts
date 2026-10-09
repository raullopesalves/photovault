import { opendir, stat } from 'node:fs/promises'
import { extname, join, posix, relative, resolve, sep } from 'node:path'
import { classifyByExtension, type MediaFormat } from '../media/formats'
import { zipEntryPath, type ZipPool } from '../sources/zip'
import { errorMessage } from '../util'

export interface ScanCounts {
  filesDiscovered: number
  photosFound: number
  videosFound: number
  sidecarsFound: number
  ignoredFound: number
  archivesFound: number
  unreadableDirs: number
}

/** One file to look at: either a plain file or an entry inside a ZIP archive. */
export interface SourceRef {
  /** The folder or ZIP the user selected. */
  root: string
  /** ZIP file containing this entry, or null for plain files. */
  containerPath: string | null
  entryName: string | null
  /** Unique path: the file path, or "<zip>!/<entry>". */
  path: string
  /** POSIX path relative to the selected root (ZIPs found inside a folder contribute their own path). */
  relativePath: string
  /** Folder of the file *inside* the export; used to pair media with sidecars across ZIP volumes. */
  dir: string
  name: string
  /** Known up front for ZIP entries; plain files are stat'ed during analysis. */
  size: number | null
  mtime: Date | null
  fingerprint: string | null
}

export interface MediaCandidate extends SourceRef {
  /** Format implied by the extension; confirmed later by content sniffing. */
  extFormat: MediaFormat
}

export interface ScanProblem extends SourceRef {
  error: string
}

export interface ScanResult {
  candidates: MediaCandidate[]
  sidecars: SourceRef[]
  problems: ScanProblem[]
  counts: ScanCounts
}

const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', '.trash', '.trashes', '.spotlight-v100', '.fseventsd', 'node_modules'])
const SKIP_FILES = new Set(['thumbs.db', 'desktop.ini', '.ds_store'])

export function emptyScanCounts(): ScanCounts {
  return { filesDiscovered: 0, photosFound: 0, videosFound: 0, sidecarsFound: 0, ignoredFound: 0, archivesFound: 0, unreadableDirs: 0 }
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel))
}

function dirOf(p: string): string {
  const d = posix.dirname(p)
  return d === '.' ? '' : d
}

function isZipName(name: string): boolean {
  return extname(name).toLowerCase() === '.zip'
}

function byPath(a: { relativePath: string; root: string }, b: { relativePath: string; root: string }): number {
  const ka = `${a.root}\u0000${a.relativePath}`
  const kb = `${b.root}\u0000${b.relativePath}`
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

/**
 * Enumerates the selected roots. Folders are walked iteratively without following symlinks/junctions
 * and never into `excludeRoots` (the library itself). ZIP archives – selected directly or found inside
 * a folder – are listed from their central directory without extracting anything.
 */
export async function scanSources(
  roots: string[],
  opts: { excludeRoots?: string[]; zips: ZipPool; signal?: AbortSignal; onProgress?: (counts: ScanCounts) => void }
): Promise<ScanResult> {
  const excludes = (opts.excludeRoots ?? []).map((p) => resolve(p))
  const counts = emptyScanCounts()
  const result: ScanResult = { candidates: [], sidecars: [], problems: [], counts }

  const classify = (ref: SourceRef): void => {
    counts.filesDiscovered++
    const cls = classifyByExtension(ref.name)
    if (cls.kind === 'media') {
      if (cls.format.mediaType === 'photo') counts.photosFound++
      else counts.videosFound++
      result.candidates.push({ ...ref, extFormat: cls.format })
    } else if (cls.kind === 'sidecar') {
      counts.sidecarsFound++
      result.sidecars.push(ref)
    } else {
      counts.ignoredFound++
    }
    if (counts.filesDiscovered % 250 === 0) opts.onProgress?.({ ...counts })
  }

  const scanZip = async (root: string, zipPath: string, prefix: string): Promise<void> => {
    counts.archivesFound++
    const base: Omit<SourceRef, 'entryName' | 'path' | 'relativePath' | 'dir' | 'name' | 'size' | 'mtime' | 'fingerprint'> = {
      root,
      containerPath: zipPath
    }
    let archive
    try {
      archive = await opts.zips.get(zipPath)
    } catch (err) {
      result.problems.push({
        ...base,
        containerPath: null,
        entryName: null,
        path: zipPath,
        relativePath: prefix || posix.basename(zipPath.replace(/\\/g, '/')),
        dir: '',
        name: posix.basename(zipPath.replace(/\\/g, '/')),
        size: null,
        mtime: null,
        fingerprint: null,
        error: `The ZIP archive could not be read: ${errorMessage(err)}`
      })
      return
    }
    const zst = await stat(zipPath)
    for (const e of archive.entries) {
      opts.signal?.throwIfAborted()
      if (e.isDirectory) continue
      const name = posix.basename(e.name)
      if (!name || SKIP_FILES.has(name.toLowerCase()) || name.startsWith('._') || e.name.startsWith('__MACOSX/')) continue
      const ref: SourceRef = {
        ...base,
        entryName: e.name,
        path: zipEntryPath(zipPath, e.name),
        relativePath: prefix ? `${prefix}/${e.name}` : e.name,
        dir: dirOf(e.name),
        name,
        size: e.size,
        mtime: e.mtime,
        fingerprint: `z:${e.size}:${e.crc32}:${zst.size}:${Math.round(zst.mtimeMs)}`
      }
      if (e.problem) {
        counts.filesDiscovered++
        result.problems.push({ ...ref, error: e.problem })
        continue
      }
      if (isZipName(name)) {
        counts.filesDiscovered++
        counts.ignoredFound++ // archives inside archives are not opened
        continue
      }
      classify(ref)
    }
  }

  for (const rawRoot of roots) {
    const root = resolve(rawRoot)
    const st = await stat(root)
    if (st.isFile()) {
      await scanZip(root, root, '')
      continue
    }
    const stack: string[] = [root]
    while (stack.length > 0) {
      opts.signal?.throwIfAborted()
      const dir = stack.pop() as string
      if (excludes.some((ex) => isInside(dir, ex))) continue
      let handle
      try {
        handle = await opendir(dir)
      } catch {
        counts.unreadableDirs++
        continue
      }
      const subdirs: string[] = []
      for await (const entry of handle) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name.toLowerCase())) subdirs.push(full)
          continue
        }
        if (!entry.isFile()) continue // symlinks, devices, sockets
        if (SKIP_FILES.has(entry.name.toLowerCase()) || entry.name.startsWith('._')) continue
        const relativePath = relative(root, full).split(sep).join('/')
        if (isZipName(entry.name)) {
          await scanZip(root, full, relativePath)
          continue
        }
        classify({
          root,
          containerPath: null,
          entryName: null,
          path: full,
          relativePath,
          dir: dirOf(relativePath),
          name: entry.name,
          size: null,
          mtime: null,
          fingerprint: null
        })
      }
      subdirs.sort().reverse()
      stack.push(...subdirs)
    }
  }
  result.candidates.sort(byPath)
  result.sidecars.sort(byPath)
  opts.onProgress?.({ ...counts })
  return result
}
