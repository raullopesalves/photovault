import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import type { MediaType } from '@shared/types'

export interface MediaFormat {
  mediaType: MediaType
  mime: string
}

const PHOTO_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.bmp': 'image/bmp',
  '.dng': 'image/x-adobe-dng',
  '.cr2': 'image/x-canon-cr2',
  '.cr3': 'image/x-canon-cr3',
  '.nef': 'image/x-nikon-nef',
  '.arw': 'image/x-sony-arw',
  '.orf': 'image/x-olympus-orf',
  '.rw2': 'image/x-panasonic-rw2',
  '.raf': 'image/x-fuji-raf'
}

const VIDEO_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.3gp': 'video/3gpp',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv'
}

/** Metadata companions we recognise but do not import yet (Takeout JSON, XMP, Apple edit sidecars). */
const SIDECAR_EXT = new Set(['.json', '.xmp', '.aae', '.thm', '.csv'])

export type ExtensionClass = { kind: 'media'; format: MediaFormat } | { kind: 'sidecar' } | { kind: 'ignored' }

export function classifyByExtension(filename: string): ExtensionClass {
  const ext = extname(filename).toLowerCase()
  const photo = PHOTO_EXT[ext]
  if (photo) return { kind: 'media', format: { mediaType: 'photo', mime: photo } }
  const video = VIDEO_EXT[ext]
  if (video) return { kind: 'media', format: { mediaType: 'video', mime: video } }
  if (SIDECAR_EXT.has(ext)) return { kind: 'sidecar' }
  return { kind: 'ignored' }
}

const TIFF_RAW_EXT = new Set(['.dng', '.cr2', '.nef', '.arw'])

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.subarray(start, end).toString('latin1')
}

/**
 * Identify media by content (magic bytes), not by extension.
 * Returns null when the header is not a format we recognise.
 */
export function sniffBuffer(buf: Buffer, filename = ''): MediaFormat | null {
  const ext = extname(filename).toLowerCase()
  const b = (i: number): number => buf[i] ?? -1
  if (buf.length < 12) return null

  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { mediaType: 'photo', mime: 'image/jpeg' }
  if (b(0) === 0x89 && ascii(buf, 1, 4) === 'PNG') return { mediaType: 'photo', mime: 'image/png' }
  if (ascii(buf, 0, 4) === 'GIF8') return { mediaType: 'photo', mime: 'image/gif' }
  if (ascii(buf, 0, 2) === 'BM') return { mediaType: 'photo', mime: 'image/bmp' }
  if (ascii(buf, 0, 4) === 'RIFF') {
    const kind = ascii(buf, 8, 12)
    if (kind === 'WEBP') return { mediaType: 'photo', mime: 'image/webp' }
    if (kind === 'AVI ') return { mediaType: 'video', mime: 'video/x-msvideo' }
    return null
  }
  if (ascii(buf, 0, 15) === 'FUJIFILMCCD-RAW') return { mediaType: 'photo', mime: 'image/x-fuji-raf' }
  if (ascii(buf, 0, 4) === 'IIRO') return { mediaType: 'photo', mime: 'image/x-olympus-orf' }
  if (b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x55 && b(3) === 0x00) return { mediaType: 'photo', mime: 'image/x-panasonic-rw2' }
  const tiffLE = b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x2a && b(3) === 0x00
  const tiffBE = b(0) === 0x4d && b(1) === 0x4d && b(2) === 0x00 && b(3) === 0x2a
  if (tiffLE || tiffBE) {
    // Many RAW formats are TIFF containers; keep the specific RAW mime when the extension says so.
    if (TIFF_RAW_EXT.has(ext)) return { mediaType: 'photo', mime: PHOTO_EXT[ext] as string }
    return { mediaType: 'photo', mime: 'image/tiff' }
  }
  if (ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12)
    switch (brand) {
      case 'heic':
      case 'heix':
      case 'hevc':
      case 'hevx':
      case 'heim':
      case 'heis':
        return { mediaType: 'photo', mime: 'image/heic' }
      case 'mif1':
      case 'msf1':
        return { mediaType: 'photo', mime: ext === '.heic' ? 'image/heic' : 'image/heif' }
      case 'avif':
      case 'avis':
        return { mediaType: 'photo', mime: 'image/avif' }
      case 'crx ':
        return { mediaType: 'photo', mime: 'image/x-canon-cr3' }
      case 'qt  ':
        return { mediaType: 'video', mime: 'video/quicktime' }
      case '3gp4':
      case '3gp5':
      case '3gp6':
      case '3g2a':
        return { mediaType: 'video', mime: 'video/3gpp' }
      case 'M4V ':
      case 'M4VH':
        return { mediaType: 'video', mime: 'video/x-m4v' }
      default:
        // isom, iso2, mp41, mp42, avc1, dash, MSNV, ...
        return { mediaType: 'video', mime: ext === '.mov' ? 'video/quicktime' : 'video/mp4' }
    }
  }
  // QuickTime files without an ftyp box start with moov/mdat/wide/free atoms.
  const atom = ascii(buf, 4, 8)
  if ((atom === 'moov' || atom === 'mdat' || atom === 'wide' || atom === 'free') && ext === '.mov') {
    return { mediaType: 'video', mime: 'video/quicktime' }
  }
  if (b(0) === 0x1a && b(1) === 0x45 && b(2) === 0xdf && b(3) === 0xa3) {
    return { mediaType: 'video', mime: ext === '.webm' ? 'video/webm' : 'video/x-matroska' }
  }
  if (b(0) === 0x30 && b(1) === 0x26 && b(2) === 0xb2 && b(3) === 0x75) return { mediaType: 'video', mime: 'video/x-ms-wmv' }
  // MPEG transport stream: sync byte every 188 bytes (TS) or 192 bytes with a 4-byte prefix (M2TS/AVCHD).
  if (b(0) === 0x47 || b(4) === 0x47) {
    if (ext === '.mts' || ext === '.m2ts') return { mediaType: 'video', mime: 'video/mp2t' }
  }
  return null
}

export async function sniffFile(path: string): Promise<MediaFormat | null> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(64)
    const { bytesRead } = await fh.read(buf, 0, 64, 0)
    return sniffBuffer(buf.subarray(0, bytesRead), path)
  } finally {
    await fh.close()
  }
}

/** Formats Chromium can render directly in an <img>/<video>, so the lightbox can show the original. */
const BROWSER_IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])
const BROWSER_VIDEOS = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'])

export function isBrowserDisplayable(mime: string): boolean {
  return BROWSER_IMAGES.has(mime) || BROWSER_VIDEOS.has(mime)
}

/** Formats sharp (prebuilt libvips) can decode. HEIC/HEVC is intentionally absent from those builds. */
const SHARP_DECODABLE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/tiff'])

export function isSharpDecodable(mime: string): boolean {
  return SHARP_DECODABLE.has(mime)
}
