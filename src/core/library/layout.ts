import { posix } from 'node:path'

const { basename, extname } = posix

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * Makes a filename safe on Windows/macOS/Linux while keeping it recognisable.
 * Never used for identity – only for the human-readable name in managed storage.
 */
export function safeFilename(name: string): string {
  let n = basename(name.replace(/\\/g, '/'))
  // eslint-disable-next-line no-control-regex
  n = n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '')
  const ext = extname(n)
  let stem = ext ? n.slice(0, -ext.length) : n
  if (stem.length === 0) stem = 'file'
  if (WINDOWS_RESERVED.test(stem)) stem = `${stem}_`
  // Keep paths comfortably below Windows MAX_PATH-style limits.
  if (stem.length > 120) stem = stem.slice(0, 120)
  return `${stem}${ext.slice(0, 16)}`
}

/** Managed originals folder (POSIX-style, relative to the library root). */
export function originalsDir(captureTime: string | null): string {
  if (!captureTime) return 'originals/undated'
  const year = captureTime.slice(0, 4)
  const month = captureTime.slice(5, 7)
  return posix.join('originals', year, month)
}

/**
 * Candidate names in order of preference. Collisions get a deterministic suffix derived
 * from the content hash (IMG_4821.HEIC -> IMG_4821_a73f81c2.HEIC); a counter is the last resort.
 */
export function* candidateNames(filename: string, sha256: string): Generator<string> {
  const safe = safeFilename(filename)
  const ext = extname(safe)
  const stem = ext ? safe.slice(0, -ext.length) : safe
  yield safe
  yield `${stem}_${sha256.slice(0, 8)}${ext}`
  yield `${stem}_${sha256.slice(0, 16)}${ext}`
  for (let i = 2; i < 1000; i++) yield `${stem}_${sha256.slice(0, 8)}_${i}${ext}`
}

export function thumbnailRelPath(sha256: string, variant: string): string {
  return posix.join('thumbnails', sha256.slice(0, 2), `${sha256}-${variant}.webp`)
}
