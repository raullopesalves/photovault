import { readFile } from 'node:fs/promises'
import exifr from 'exifr'
import sharp, { type Sharp } from './sharp'

/**
 * Camera RAW files (CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF, PEF…). Decoding the sensor data needs a RAW
 * developer, but practically every RAW file also carries a full-size JPEG preview rendered by the camera.
 * That preview is used for thumbnails, viewing, faces, smart search and edits — no OS codec needed. The RAW
 * original is always kept and exported as it is.
 */
const RAW_MIMES = new Set([
  'image/x-adobe-dng',
  'image/x-canon-cr2',
  'image/x-canon-cr3',
  'image/x-nikon-nef',
  'image/x-sony-arw',
  'image/x-olympus-orf',
  'image/x-panasonic-rw2',
  'image/x-fuji-raf',
  'image/x-pentax-pef',
  'image/x-samsung-srw'
])

export function isRawMime(mime: string): boolean {
  return RAW_MIMES.has(mime)
}

/**
 * End of the JPEG that starts at `start` (index after its EOI), or -1. Walks the marker segments (so JPEG
 * thumbnails nested inside APP1/EXIF are skipped), then scans the entropy-coded data for the EOI marker.
 */
function jpegEnd(buf: Buffer, start: number): number {
  let i = start + 2
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return -1
    const marker = buf[i + 1] as number
    if (marker === 0xff) {
      i++ // fill byte
      continue
    }
    if (marker === 0xd9) return i + 2
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = buf.readUInt16BE(i + 2)
    if (len < 2) return -1
    if (marker === 0xda) {
      // Start of scan: entropy data until the EOI (FF D9); FF 00 and restart markers are part of the data.
      let j = i + 2 + len
      while (j + 1 < buf.length) {
        if (buf[j] === 0xff) {
          const n = buf[j + 1] as number
          if (n === 0xd9) return j + 2
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7) && n !== 0xff && n !== 0xda) {
            // Another marker after the scan (e.g. a following progressive scan): keep walking segments.
            i = j
            break
          }
        }
        j++
      }
      if (j + 1 >= buf.length) return -1
      continue
    }
    i += 2 + len
  }
  return -1
}

/** The largest embedded JPEG in a RAW file (the camera's full-size preview), or null. */
export async function extractRawPreview(path: string): Promise<Buffer | null> {
  const buf = await readFile(path)
  let best: { start: number; end: number } | null = null
  let i = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]))
  while (i !== -1) {
    const end = jpegEnd(buf, i)
    if (end > i && (!best || end - i > best.end - best.start)) best = { start: i, end }
    // Continue after this JPEG (or just past its start if it could not be walked).
    i = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), end > i ? end : i + 3)
  }
  if (!best || best.end - best.start < 8_000) return null
  return buf.subarray(best.start, best.end)
}

const ORIENT: Record<number, (s: Sharp) => Sharp> = {
  2: (s) => s.flop(),
  3: (s) => s.rotate(180),
  4: (s) => s.flip(),
  5: (s) => s.rotate(90).flop(),
  6: (s) => s.rotate(90),
  7: (s) => s.rotate(270).flop(),
  8: (s) => s.rotate(270)
}

/**
 * A sharp pipeline of the RAW file's preview, upright. The orientation comes from the RAW's own EXIF when
 * the preview has none.
 */
export async function rawPreviewImage(path: string): Promise<Sharp | null> {
  const jpeg = await extractRawPreview(path)
  if (!jpeg) return null
  const ownOrientation = (await sharp(jpeg).metadata()).orientation
  if (ownOrientation && ownOrientation > 1) return sharp(jpeg).rotate()
  const raw = (await exifr.orientation(path).catch(() => undefined)) as number | undefined
  const fix = raw ? ORIENT[raw] : undefined
  return fix ? fix(sharp(jpeg)) : sharp(jpeg)
}
