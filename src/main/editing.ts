import type { PhotoEdits } from '@shared/types'
import { applyEdits, cleanEdits, decodeOriented } from '@core/media/edits'
import type { Library } from '@core/library/library'
import { originalPathFor } from '@core/thumbnails/thumbnails'

/** The photo being edited, decoded once (≤ 2048 px) so slider previews are quick. */
let base: { key: string; raw: { data: Buffer; width: number; height: number } } | null = null

async function baseImage(library: Library, assetId: number): Promise<{ data: Buffer; width: number; height: number }> {
  const src = originalPathFor(library, assetId)
  if (!src) throw new Error('This photo has no original file in the library.')
  const key = `${library.root}:${assetId}:${src.sha256}`
  if (base?.key !== key) base = { key, raw: await decodeOriented(src.absolutePath, src.mime, 2048) }
  return base.raw
}

export function editState(library: Library, assetId: number): { edits: PhotoEdits | null; rotation: number } {
  const r = library.db.get<{ edits: string | null; rotation: number }>('SELECT edits, rotation FROM assets WHERE id = ?', [assetId])
  if (!r) throw new Error('Not found')
  return { edits: r.edits ? (JSON.parse(r.edits) as PhotoEdits) : null, rotation: r.rotation ?? 0 }
}

/** A quick JPEG preview (data: URL) of the photo with these edits, for the editor. */
export async function editPreview(library: Library, assetId: number, rotation: number, edits: unknown, opts: { skipCrop?: boolean; size?: number }): Promise<string> {
  const raw = await baseImage(library, assetId)
  const img = await applyEdits(raw, normaliseRotation(rotation), cleanEdits(edits), { skipCrop: opts.skipCrop })
  const size = Math.min(2048, Math.max(64, opts.size ?? 1400))
  const jpeg = await img.resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

function normaliseRotation(r: number): number {
  return ((((Math.round(r / 90) * 90) % 360) + 360) % 360) as number
}

/**
 * Saves edits (null = back to the original). Only the catalogue changes; renditions are re-rendered. A new
 * rotation also invalidates the visual fingerprint, smart-search vector and faces, which depend on orientation.
 */
export function saveEdits(library: Library, assetId: number, rotation: number, edits: unknown): void {
  const db = library.db
  const clean = cleanEdits(edits)
  const rot = normaliseRotation(rotation)
  const now = new Date().toISOString()
  db.tx(() => {
    const before = db.get<{ rotation: number; media_type: string }>('SELECT rotation, media_type FROM assets WHERE id = ?', [assetId])
    if (!before) throw new Error('Not found')
    if (before.media_type !== 'photo') throw new Error('Only photos can be edited.')
    db.run('UPDATE assets SET edits = ?, rotation = ?, edit_rev = edit_rev + 1, updated_at = ? WHERE id = ?', [
      clean ? JSON.stringify(clean) : null,
      rot,
      now,
      assetId
    ])
    db.run("DELETE FROM asset_thumbnails WHERE asset_id = ? AND variant = 'preview'", [assetId])
    if ((before.rotation ?? 0) !== rot) {
      for (const t of ['asset_hashes', 'asset_embeddings', 'faces', 'face_scans']) db.run(`DELETE FROM ${t} WHERE asset_id = ?`, [assetId])
    }
  })
  library.logger.info('assets.edited', { assetId, rotation: rot, edits: clean })
}

/** The photo with its edits applied, full resolution, as JPEG. */
export async function renderEdited(library: Library, assetId: number): Promise<{ jpeg: Buffer; name: string }> {
  const src = originalPathFor(library, assetId)
  const name = library.db.get<{ original_filename: string }>('SELECT original_filename FROM assets WHERE id = ?', [assetId])?.original_filename
  if (!src || !name) throw new Error('This photo has no original file in the library.')
  const raw = await decodeOriented(src.absolutePath, src.mime, 12_000)
  const img = await applyEdits(raw, src.rotation, src.edits)
  const stem = name.replace(/\.[^.]+$/, '')
  return { jpeg: await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer(), name: `${stem} (edited).jpg` }
}
