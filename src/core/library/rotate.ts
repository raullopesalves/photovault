import type { Library } from './library'

/**
 * Non-destructive rotation: the angle (clockwise, on top of the file's own EXIF orientation) is stored in the
 * catalogue and applied to the cached thumbnail/preview; the original file is never rewritten.
 * Videos are not rotated. Returns the ids that changed (their thumbnails must be re-rendered).
 */
export function rotateAssets(library: Library, assetIds: number[], degrees: number): number[] {
  if (![90, 180, 270, -90].includes(degrees)) throw new Error('Rotation must be a multiple of 90°')
  const db = library.db
  const now = new Date().toISOString()
  const changed: number[] = []
  db.tx(() => {
    for (const id of assetIds) {
      const r = db.run(
        `UPDATE assets SET rotation = (rotation + ? + 360) % 360, updated_at = ? WHERE id = ? AND media_type = 'photo'`,
        [degrees, now, id]
      )
      if (r.changes === 0) continue
      changed.push(id)
      // Cached renditions are stale: the preview is re-rendered on demand, the visual fingerprint recomputed.
      db.run("DELETE FROM asset_thumbnails WHERE asset_id = ? AND variant = 'preview'", [id])
      db.run('DELETE FROM asset_hashes WHERE asset_id = ?', [id])
      db.run('DELETE FROM asset_embeddings WHERE asset_id = ?', [id])
      // Faces are found again on the rotated picture (their boxes and crops changed).
      db.run('DELETE FROM faces WHERE asset_id = ?', [id])
      db.run('DELETE FROM face_scans WHERE asset_id = ?', [id])
    }
  })
  library.logger.info('assets.rotated', { count: changed.length, degrees })
  return changed
}
