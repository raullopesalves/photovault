import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { ffmpeg, videoFrame } from '../media/ffmpeg'
import { applyEdits } from '../media/edits'
import { isRawMime, rawPreviewImage } from '../media/raw'
import type { PhotoEdits } from '@shared/types'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import exifr from 'exifr'
import sharp, { type Sharp } from '../media/sharp'
import type { Database } from '../db/database'
import { thumbnailRelPath } from '../library/layout'
import type { Library } from '../library/library'
import { isSharpDecodable } from '../media/formats'
import { decodeHeic } from '../media/heic'
import { errorMessage } from '../util'

/**
 * Platform thumbnailer (e.g. the Windows shell / macOS QuickLook via Electron's nativeImage).
 * Used for formats libvips cannot decode: HEIC, RAW, video. Returns an encoded image or null.
 */
export type PlatformThumbnailer = (absolutePath: string, size: number) => Promise<Buffer | null>

export const VARIANTS = {
  thumb: 512,
  preview: 2048
} as const
export type Variant = keyof typeof VARIANTS

export interface ThumbResult {
  relativePath: string
  width: number
  height: number
  generator: string
}

/** Rotation for an EXIF orientation value when the decoder cannot apply it itself (embedded JPEG thumbnails). */
function orient(img: Sharp, orientation: number | null): Sharp {
  switch (orientation) {
    case 2: return img.flop()
    case 3: return img.rotate(180)
    case 4: return img.flip()
    case 5: return img.rotate(90).flop()
    case 6: return img.rotate(90)
    case 7: return img.rotate(270).flop()
    case 8: return img.rotate(270)
    default: return img
  }
}

async function writeVariant(pipeline: Sharp, size: number, dest: string, rotation = 0, edits: PhotoEdits | null = null): Promise<{ width: number; height: number }> {
  await mkdir(dirname(dest), { recursive: true })
  const tmp = `${dest}.${randomUUID().slice(0, 8)}.tmp`
  try {
    let out: Sharp
    if (edits) {
      // Decode larger when cropping, so the cropped rendition still has the full size.
      const pre = Math.min(4096, Math.round(size / Math.min(edits.crop?.w ?? 1, edits.crop?.h ?? 1)))
      const raw = await pipeline.resize(pre, pre, { fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const edited = await applyEdits({ data: raw.data, width: raw.info.width, height: raw.info.height }, rotation, edits)
      out = sharp(await edited.png({ compressionLevel: 0 }).toBuffer()).resize(size, size, { fit: 'inside', withoutEnlargement: true })
    } else {
      out = pipeline.resize(size, size, { fit: 'inside', withoutEnlargement: true })
      // A pipeline holds one rotation (the auto-orientation), so the user's rotation is a second pass.
      if (rotation) out = sharp(await out.png({ compressionLevel: 0 }).toBuffer()).rotate(rotation)
    }
    const info = await out.webp({ quality: size > 1024 ? 85 : 78 }).toFile(tmp)
    // Thumbnails are a regenerable cache, so replacing an existing one is fine.
    await rename(tmp, dest)
    return { width: info.width, height: info.height }
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}

/**
 * Renders a cached WebP for one asset. Strategy:
 *   1. libvips decode of the original (auto-oriented)
 *   2. embedded EXIF JPEG thumbnail (works for many HEIC/RAW files)
 *   3. platform thumbnailer
 */
export async function renderThumbnail(opts: {
  source: string
  mime: string
  sha256: string
  orientation: number | null
  /** User rotation in degrees clockwise (non-destructive). */
  rotation?: number
  /** Non-destructive edits (crop, adjustments, filter). */
  edits?: PhotoEdits | null
  variant: Variant
  libraryRoot: string
  platform?: PlatformThumbnailer
}): Promise<ThumbResult> {
  const rot = opts.rotation ?? 0
  const edits = opts.edits ?? null
  const size = VARIANTS[opts.variant]
  const relativePath = thumbnailRelPath(opts.sha256, opts.variant)
  const dest = join(opts.libraryRoot, ...relativePath.split('/'))
  const errors: string[] = []

  if (isSharpDecodable(opts.mime)) {
    try {
      const dims = await writeVariant(sharp(opts.source, { failOn: 'none' }).rotate(), size, dest, rot, edits)
      return { relativePath, ...dims, generator: 'sharp' }
    } catch (err) {
      errors.push(`sharp: ${errorMessage(err)}`)
    }
  }
  if (isRawMime(opts.mime)) {
    // Camera RAW: the camera's own full-size JPEG preview inside the file.
    try {
      const img = await rawPreviewImage(opts.source)
      if (img) {
        const dims = await writeVariant(img, size, dest, rot, edits)
        return { relativePath, ...dims, generator: 'raw-preview' }
      }
    } catch (err) {
      errors.push(`raw-preview: ${errorMessage(err)}`)
    }
  }
  if (opts.mime.startsWith('image/') && opts.variant === 'thumb') {
    try {
      const embedded = (await exifr.thumbnail(opts.source)) as Uint8Array | undefined
      if (embedded && embedded.length > 0) {
        const dims = await writeVariant(orient(sharp(Buffer.from(embedded)), opts.orientation), size, dest, rot, edits)
        return { relativePath, ...dims, generator: 'exif-embedded' }
      }
    } catch (err) {
      errors.push(`exif-thumbnail: ${errorMessage(err)}`)
    }
  }
  if (opts.mime === 'image/heic' || opts.mime === 'image/heif') {
    try {
      const img = await decodeHeic(opts.source)
      const dims = await writeVariant(sharp(img.rgba, { raw: { width: img.width, height: img.height, channels: 4 } }), size, dest, rot, edits)
      return { relativePath, ...dims, generator: 'libheif' }
    } catch (err) {
      errors.push(`libheif: ${errorMessage(err)}`)
    }
  }
  if (opts.mime.startsWith('video/') && ffmpeg()) {
    // A frame a second in (or mid-way for very short clips), decoded by ffmpeg: works for HEVC without OS codecs.
    try {
      let frame: Buffer
      try {
        frame = await videoFrame(opts.source, 1000, size)
      } catch {
        frame = await videoFrame(opts.source, 0, size)
      }
      const dims = await writeVariant(sharp(frame), size, dest, rot, edits)
      return { relativePath, ...dims, generator: 'ffmpeg' }
    } catch (err) {
      errors.push(`ffmpeg: ${errorMessage(err)}`)
    }
  }
  if (opts.platform) {
    try {
      const buf = await opts.platform(opts.source, size)
      if (buf && buf.length > 0) {
        const dims = await writeVariant(sharp(buf), size, dest, rot, edits)
        return { relativePath, ...dims, generator: 'platform' }
      }
    } catch (err) {
      errors.push(`platform: ${errorMessage(err)}`)
    }
  }
  throw new Error(`No thumbnail could be generated (${errors.join('; ') || 'unsupported format'})`)
}

interface AssetForThumb {
  id: number
  sha256: string
  mime_type: string
  orientation: number | null
  rotation: number
  edits: string | null
  relative_path: string
}

export function originalPathFor(
  library: Library,
  assetId: number
): { absolutePath: string; mime: string; sha256: string; orientation: number | null; rotation: number; edits: PhotoEdits | null } | null {
  const row = library.db.get<AssetForThumb>(
    `SELECT a.id, a.sha256, a.mime_type, a.orientation, a.rotation, a.edits, f.relative_path
       FROM assets a JOIN files f ON f.asset_id = a.id AND f.storage_location_id = ?
      WHERE a.id = ? ORDER BY f.id LIMIT 1`,
    [library.managedLocationId, assetId]
  )
  if (!row) return null
  return {
    absolutePath: join(library.root, ...row.relative_path.split('/')),
    mime: row.mime_type,
    sha256: row.sha256,
    orientation: row.orientation,
    rotation: row.rotation ?? 0,
    edits: row.edits ? (JSON.parse(row.edits) as PhotoEdits) : null
  }
}

function recordThumb(db: Database, assetId: number, variant: Variant, r: ThumbResult): void {
  db.run(
    `INSERT INTO asset_thumbnails (asset_id, variant, relative_path, width, height, generator, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (asset_id, variant) DO UPDATE SET relative_path = excluded.relative_path, width = excluded.width,
       height = excluded.height, generator = excluded.generator, created_at = excluded.created_at`,
    [assetId, variant, r.relativePath, r.width, r.height, r.generator, new Date().toISOString()]
  )
}

/**
 * Background worker that renders grid thumbnails for assets with thumb_status = 'pending'.
 * Runs independently of imports, survives restarts (state lives in the DB) and never blocks ingest.
 */
export class ThumbnailQueue {
  private running = false
  private stopped = false
  private readonly inflightPreviews = new Map<number, Promise<string | null>>()

  constructor(
    private readonly library: Library,
    private readonly opts: { platform?: PlatformThumbnailer; concurrency?: number; onUpdated?: (assetIds: number[]) => void } = {}
  ) {}

  /** Starts processing if idle. Safe to call often. */
  kick(): void {
    if (this.running || this.stopped) return
    this.running = true
    void this.loop().finally(() => {
      this.running = false
    })
  }

  stop(): void {
    this.stopped = true
  }

  /** Resolves when no pending thumbnails remain (used by tests). */
  async drain(): Promise<void> {
    this.kick()
    while (this.running) await new Promise((r) => setTimeout(r, 20))
  }

  private async loop(): Promise<void> {
    const db = this.library.db
    const concurrency = this.opts.concurrency ?? 3
    while (!this.stopped) {
      const batch = db.all<{ id: number }>("SELECT id FROM assets WHERE thumb_status = 'pending' ORDER BY sort_time DESC LIMIT ?", [concurrency * 4])
      if (batch.length === 0) return
      const updated: number[] = []
      let cursor = 0
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (cursor < batch.length && !this.stopped) {
            const { id } = batch[cursor++]!
            const src = originalPathFor(this.library, id)
            let status: 'ready' | 'failed' = 'failed'
            if (src) {
              try {
                const r = await renderThumbnail({
                  source: src.absolutePath,
                  mime: src.mime,
                  sha256: src.sha256,
                  orientation: src.orientation,
                  rotation: src.rotation,
                  edits: src.edits,
                  variant: 'thumb',
                  libraryRoot: this.library.root,
                  platform: this.opts.platform
                })
                recordThumb(db, id, 'thumb', r)
                status = 'ready'
              } catch (err) {
                this.library.logger.warn('thumbnail.failed', { assetId: id, error: errorMessage(err) })
              }
            }
            db.run('UPDATE assets SET thumb_status = ?, updated_at = ? WHERE id = ?', [status, new Date().toISOString(), id])
            updated.push(id)
          }
        })
      )
      if (updated.length > 0) this.opts.onUpdated?.(updated)
    }
  }

  /** Re-renders the grid thumbnail now (after a rotation), so the grid never shows a stale or missing image. */
  async rerender(assetId: number): Promise<void> {
    const src = originalPathFor(this.library, assetId)
    if (!src) return
    try {
      const r = await renderThumbnail({ ...src, source: src.absolutePath, variant: 'thumb', libraryRoot: this.library.root, platform: this.opts.platform })
      recordThumb(this.library.db, assetId, 'thumb', r)
      this.library.db.run("UPDATE assets SET thumb_status = 'ready' WHERE id = ?", [assetId])
    } catch (err) {
      this.library.logger.warn('thumbnail.failed', { assetId, error: errorMessage(err) })
    }
  }

  /** Large preview for formats the renderer cannot show natively (HEIC, TIFF, RAW). Generated on demand and cached. */
  ensurePreview(assetId: number): Promise<string | null> {
    const existing = this.inflightPreviews.get(assetId)
    if (existing) return existing
    const job = (async (): Promise<string | null> => {
      const db = this.library.db
      const row = db.get<{ relative_path: string }>("SELECT relative_path FROM asset_thumbnails WHERE asset_id = ? AND variant = 'preview'", [assetId])
      if (row) return join(this.library.root, ...row.relative_path.split('/'))
      const src = originalPathFor(this.library, assetId)
      if (!src) return null
      try {
        const r = await renderThumbnail({
          source: src.absolutePath,
          mime: src.mime,
          sha256: src.sha256,
          orientation: src.orientation,
          rotation: src.rotation,
          edits: src.edits,
          variant: 'preview',
          libraryRoot: this.library.root,
          platform: this.opts.platform
        })
        recordThumb(db, assetId, 'preview', r)
        return join(this.library.root, ...r.relativePath.split('/'))
      } catch (err) {
        this.library.logger.warn('preview.failed', { assetId, error: errorMessage(err) })
        return null
      }
    })().finally(() => this.inflightPreviews.delete(assetId))
    this.inflightPreviews.set(assetId, job)
    return job
  }
}

/** Bump when thumbnail generation gains a new method: thumbnails that failed before are retried once. */
export const THUMB_RETRY_VERSION = 2

/** Marks earlier failures for a retry if generation improved since (e.g. HEIC via libheif, videos via ffmpeg). */
export function retryFailedThumbnailsOnce(library: Library): number {
  const db = library.db
  const done = Number(db.get<{ value: string }>("SELECT value FROM library_settings WHERE key = 'thumb_retry'")?.value ?? 0)
  if (done >= THUMB_RETRY_VERSION) return 0
  const n = db.run("UPDATE assets SET thumb_status = 'pending' WHERE thumb_status = 'failed'").changes
  db.run(
    "INSERT INTO library_settings (key, value) VALUES ('thumb_retry', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [String(THUMB_RETRY_VERSION)]
  )
  if (n) library.logger.info('thumbnails.retry_failed', { count: n })
  return n
}

/**
 * Thumbnails whose files are gone (a library opened from a backup drive, which does not carry them, or a deleted
 * thumbnails/ folder) are queued to be made again; otherwise the grid would show broken images for good. A sample is
 * checked first, so a healthy library costs a few file checks; any miss means a full check.
 */
export function requeueMissingThumbnails(library: Library, sample = 30): number {
  const db = library.db
  const exists = (rel: string): boolean => existsSync(join(library.root, ...rel.split('/')))
  const probe = db.all<{ relative_path: string }>("SELECT relative_path FROM asset_thumbnails WHERE variant = 'thumb' ORDER BY RANDOM() LIMIT ?", [sample])
  if (probe.every((r) => exists(r.relative_path))) return 0
  const rows = db.all<{ asset_id: number; variant: string; relative_path: string }>('SELECT asset_id, variant, relative_path FROM asset_thumbnails')
  const missing = rows.filter((r) => !exists(r.relative_path))
  db.tx(() => {
    for (const r of missing) {
      db.run('DELETE FROM asset_thumbnails WHERE asset_id = ? AND variant = ?', [r.asset_id, r.variant])
      if (r.variant === 'thumb') db.run("UPDATE assets SET thumb_status = 'pending' WHERE id = ?", [r.asset_id])
    }
  })
  const thumbs = missing.filter((r) => r.variant === 'thumb').length
  library.logger.warn('thumbnails.missing_requeued', { thumbs, previews: missing.length - thumbs })
  return thumbs
}

/** One thumbnail asked for but missing on disk: queue it to be made again. */
export function requeueThumbnail(library: Library, assetId: number): void {
  library.db.tx(() => {
    library.db.run("DELETE FROM asset_thumbnails WHERE asset_id = ? AND variant = 'thumb'", [assetId])
    library.db.run("UPDATE assets SET thumb_status = 'pending' WHERE id = ?", [assetId])
  })
}

