import type { PhotoEdits } from '@shared/types'
import { isSharpDecodable } from './formats'
import { decodeHeic } from './heic'
import { isRawMime, rawPreviewImage } from './raw'
import sharp, { type Sharp } from './sharp'

/**
 * Non-destructive photo edits. The catalogue stores the instructions (assets.edits, JSON); thumbnails,
 * previews and "export with edits" are rendered from the untouched original. Order: EXIF orientation →
 * user rotation → crop → flip → light/contrast/colour/warmth → filter.
 */
export const FILTERS = ['vivid', 'warm', 'cool', 'fade', 'bw', 'sepia'] as const

const clamp = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0)

/** Validates/normalises edits from the UI; returns null when nothing is changed. */
export function cleanEdits(e: unknown): PhotoEdits | null {
  if (!e || typeof e !== 'object') return null
  const x = e as Record<string, unknown>
  const out: PhotoEdits = {}
  const c = x.crop as Record<string, unknown> | undefined
  if (c && typeof c === 'object') {
    const cx = clamp(c.x, 0, 1)
    const cy = clamp(c.y, 0, 1)
    const cw = clamp(c.w, 0.02, 1 - cx)
    const ch = clamp(c.h, 0.02, 1 - cy)
    if (cx > 0.001 || cy > 0.001 || cw < 0.999 || ch < 0.999) out.crop = { x: cx, y: cy, w: cw, h: ch }
  }
  if (x.flip === true) out.flip = true
  for (const k of ['light', 'contrast', 'color', 'warmth'] as const) {
    const v = clamp(x[k], -1, 1)
    if (Math.abs(v) >= 0.01) out[k] = Math.round(v * 100) / 100
  }
  if (typeof x.filter === 'string' && (FILTERS as readonly string[]).includes(x.filter)) out.filter = x.filter as PhotoEdits['filter']
  return Object.keys(out).length ? out : null
}

/** Decodes an image (EXIF-oriented) to raw RGB, at most `maxSize` px. HEIC goes through libheif. */
export async function decodeOriented(path: string, mime: string, maxSize: number): Promise<{ data: Buffer; width: number; height: number }> {
  let img: Sharp
  if (isSharpDecodable(mime)) img = sharp(path, { failOn: 'none' }).rotate()
  else if (isRawMime(mime)) {
    const raw = await rawPreviewImage(path)
    if (!raw) throw new Error('This RAW file has no preview to work from.')
    img = raw
  } else if (mime === 'image/heic' || mime === 'image/heif') {
    const h = await decodeHeic(path)
    img = sharp(h.rgba, { raw: { width: h.width, height: h.height, channels: 4 } })
  } else throw new Error('This format cannot be edited.')
  const { data, info } = await img
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Applies rotation and edits to an already-decoded RGB image. Crop coordinates are fractions of the rotated
 * picture, so they work at any resolution.
 */
export async function applyEdits(raw: { data: Buffer; width: number; height: number }, rotation: number, edits: PhotoEdits | null, opts: { skipCrop?: boolean } = {}): Promise<Sharp> {
  let img = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } })
  let w = raw.width
  let h = raw.height
  if (rotation) {
    const r = await img.rotate(rotation).raw().toBuffer({ resolveWithObject: true })
    img = sharp(r.data, { raw: { width: r.info.width, height: r.info.height, channels: 3 } })
    w = r.info.width
    h = r.info.height
  }
  if (!edits) return img
  if (edits.crop && !opts.skipCrop) {
    const left = Math.min(w - 1, Math.round(edits.crop.x * w))
    const top = Math.min(h - 1, Math.round(edits.crop.y * h))
    const width = Math.max(1, Math.min(w - left, Math.round(edits.crop.w * w)))
    const height = Math.max(1, Math.min(h - top, Math.round(edits.crop.h * h)))
    const c = await img.extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true })
    img = sharp(c.data, { raw: { width: c.info.width, height: c.info.height, channels: 3 } })
  }
  if (edits.flip) img = img.flop()

  let light = edits.light ?? 0
  let contrast = edits.contrast ?? 0
  let color = edits.color ?? 0
  let warmth = edits.warmth ?? 0
  switch (edits.filter) {
    case 'vivid':
      color += 0.35
      contrast += 0.12
      break
    case 'warm':
      warmth += 0.55
      break
    case 'cool':
      warmth -= 0.55
      break
    case 'fade':
      contrast -= 0.3
      color -= 0.25
      light += 0.05
      break
  }
  if (light || color) img = img.modulate({ brightness: 1 + light * 0.6, saturation: Math.max(0, 1 + color) })
  if (contrast) {
    const a = 1 + contrast * 0.7
    img = img.linear(a, 128 * (1 - a))
  }
  if (warmth) {
    const k = warmth * 0.14
    img = img.recomb([
      [1 + k, 0, 0],
      [0, 1 + k * 0.15, 0],
      [0, 0, 1 - k]
    ])
  }
  if (edits.filter === 'bw') img = img.grayscale()
  if (edits.filter === 'sepia') {
    img = img.recomb([
      [0.393, 0.769, 0.189],
      [0.349, 0.686, 0.168],
      [0.272, 0.534, 0.131]
    ])
  }
  return img
}

export const hasEdits = (e: PhotoEdits | null | undefined): boolean => !!e && Object.keys(e).length > 0
