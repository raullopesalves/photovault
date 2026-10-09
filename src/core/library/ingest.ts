import { randomUUID } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { copyFile, link, lstat, mkdir, rename, stat, unlink, utimes } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { sha256File } from '../media/hash'
import { candidateNames } from './layout'

export class SourceChangedError extends Error {
  constructor(path: string) {
    super(`The source file changed after it was analysed, so it was not imported: ${path}`)
  }
}

/** A plain file, or bytes that have to be streamed (e.g. an entry inside a ZIP archive). */
export type IngestSource = { kind: 'file'; path: string } | { kind: 'stream'; label: string; open: () => Promise<Readable>; mtime: Date | null }

export interface IngestRequest {
  source: IngestSource
  expectedSha256: string
  libraryRoot: string
  tempDir: string
  /** POSIX path relative to the library root, e.g. originals/2024/07 */
  relDir: string
  filename: string
  /** True when the library database already tracks this relative path. */
  isPathTracked: (relativePath: string) => boolean
}

export interface IngestResult {
  relativePath: string
  /** An untracked file with identical bytes was already at the destination (e.g. after a crash) and was reused. */
  adopted: boolean
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EXDEV', 'EINVAL', 'ENOSYS', 'EACCES'])

/**
 * Copies one original into managed storage without ever overwriting anything:
 *   1. copy to a unique temp file inside the library (COPYFILE_EXCL)
 *   2. hash the copy and compare with the hash recorded during analysis
 *   3. publish with link() which fails atomically if the destination exists
 *      (falls back to exists-check + rename on filesystems without hard links, e.g. exFAT)
 *   4. on a name collision with different bytes, try the next deterministic candidate name
 * The source file is only ever read.
 */
export async function ingestFile(req: IngestRequest): Promise<IngestResult> {
  const destDir = join(req.libraryRoot, ...req.relDir.split('/'))
  await mkdir(destDir, { recursive: true })
  await mkdir(req.tempDir, { recursive: true })

  const tmp = join(req.tempDir, `${req.expectedSha256.slice(0, 16)}-${randomUUID()}.part`)
  const src = req.source
  let tmpExists = true
  try {
    if (src.kind === 'file') {
      await copyFile(src.path, tmp, constants.COPYFILE_EXCL)
    } else {
      await pipeline(await src.open(), createWriteStream(tmp, { flags: 'wx' }))
    }
    const copiedHash = await sha256File(tmp)
    if (copiedHash !== req.expectedSha256) throw new SourceChangedError(src.kind === 'file' ? src.path : src.label)

    // Keep the original modification time on the managed copy; the archive stays understandable without Photo Vault.
    if (src.kind === 'file') {
      const srcStat = await stat(src.path)
      await utimes(tmp, srcStat.atime, srcStat.mtime)
    } else if (src.mtime) {
      await utimes(tmp, src.mtime, src.mtime)
    }

    for (const name of candidateNames(req.filename, req.expectedSha256)) {
      const relativePath = posix.join(req.relDir, name)
      if (req.isPathTracked(relativePath)) continue
      const dest = join(destDir, name)

      let published = false
      try {
        await link(tmp, dest)
        published = true
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? ''
        if (code === 'EEXIST') {
          // fall through to the collision check below
        } else if (LINK_UNSUPPORTED.has(code)) {
          if (!(await exists(dest))) {
            await rename(tmp, dest)
            tmpExists = false
            return { relativePath, adopted: false }
          }
        } else {
          throw err
        }
      }
      if (published) return { relativePath, adopted: false }

      // Something already occupies this name. Reuse it only if it is byte-identical; otherwise try another name.
      const existingHash = await sha256File(dest).catch(() => null)
      if (existingHash === req.expectedSha256) return { relativePath, adopted: true }
    }
    throw new Error(`Could not find a free filename for ${req.filename}`)
  } finally {
    if (tmpExists) await unlink(tmp).catch(() => undefined)
  }
}
