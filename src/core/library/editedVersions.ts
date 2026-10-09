import { posix } from 'node:path'
import type { Library } from './library'

/**
 * Pairs a photo with the edited version saved next to it, so the timeline shows one item, like the phone:
 *   - Apple: IMG_1234.HEIC (original) + IMG_E1234.JPG (edited; an IMG_1234.AAE describes the edit);
 *   - Google Takeout: name.jpg + name-edited.jpg.
 * The ORIGINAL points at its edited version (assets.version_of) and leaves the grid; the viewer can show it,
 * and Bin/delete take both. Both stay ordinary files in the library. Idempotent.
 */
export function linkEditedVersions(library: Library): number {
  const db = library.db
  type Row = { asset_id: number; source_root: string; relative_path: string; media_type: string }
  const rows = db.all<Row>(
    `SELECT p.asset_id, p.source_root, p.relative_path, a.media_type
       FROM provenance p JOIN assets a ON a.id = p.asset_id
      WHERE a.trashed_at IS NULL AND a.live_photo_of IS NULL AND a.media_type = 'photo'`
  )
  const parts = (r: Row): { dir: string; stem: string } => {
    const rel = r.relative_path.replace(/\\/g, '/')
    const base = posix.basename(rel)
    return { dir: `${r.source_root}\u0000${posix.dirname(rel)}`, stem: (base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base).toLowerCase() }
  }
  const byStem = new Map<string, number>()
  for (const r of rows) {
    const p = parts(r)
    byStem.set(`${p.dir}\u0000${p.stem}`, r.asset_id)
  }
  let linked = 0
  const now = new Date().toISOString()
  db.tx(() => {
    for (const r of rows) {
      const p = parts(r)
      const apple = /^img_e(\d{4,})$/.exec(p.stem)
      const google = /^(.+)-edited$/.exec(p.stem)
      const originalStem = apple ? `img_${apple[1]}` : google ? google[1] : null
      if (!originalStem) continue
      const original = byStem.get(`${p.dir}\u0000${originalStem}`)
      if (!original || original === r.asset_id) continue
      linked += db.run('UPDATE assets SET version_of = ?, updated_at = ? WHERE id = ? AND version_of IS NULL', [r.asset_id, now, original]).changes
    }
  })
  if (linked) library.logger.info('edited_versions.linked', { linked })
  return linked
}
