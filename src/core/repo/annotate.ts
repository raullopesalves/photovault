import type { AssetFace, AssetQuery, SmartAlbum } from '@shared/types'
import type { DetectedFace } from '../ai/faces'
import type { Library } from '../library/library'
import { assetWhere } from './filters'

/** The user's own annotations: tags, captions, hand-set locations, smart albums and hand-marked faces. */

const cleanTag = (t: string): string => t.trim().replace(/\s+/g, ' ').slice(0, 60)

export function setTags(library: Library, assetIds: number[], add: string[], remove: string[]): void {
  const db = library.db
  const now = new Date().toISOString()
  const plus = [...new Set(add.map(cleanTag).filter(Boolean))]
  const minus = [...new Set(remove.map(cleanTag).filter(Boolean))]
  db.tx(() => {
    for (const id of assetIds) {
      for (const t of plus) db.run('INSERT OR IGNORE INTO asset_tags (asset_id, tag, created_at) VALUES (?, ?, ?)', [id, t, now])
      for (const t of minus) db.run('DELETE FROM asset_tags WHERE asset_id = ? AND tag = ?', [id, t])
    }
  })
}

export function tagsOf(library: Library, assetId: number): string[] {
  return library.db.all<{ tag: string }>('SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag', [assetId]).map((r) => r.tag)
}

export function allTags(library: Library): Array<{ tag: string; count: number }> {
  return library.db.all<{ tag: string; count: number }>(
    `SELECT t.tag, COUNT(*) AS count FROM asset_tags t JOIN assets a ON a.id = t.asset_id
      WHERE a.trashed_at IS NULL GROUP BY t.tag ORDER BY count DESC, t.tag LIMIT 500`
  )
}

export function setDescription(library: Library, assetId: number, text: string | null): void {
  const clean = text?.trim().slice(0, 2000) || null
  library.db.run('UPDATE assets SET description = ?, updated_at = ? WHERE id = ?', [clean, new Date().toISOString(), assetId])
}

/** Places items on the map by hand; `null` removes a hand-set location (locations from the files stay). */
export function setLocation(library: Library, assetIds: number[], loc: { lat: number; lon: number } | null): void {
  const db = library.db
  const now = new Date().toISOString()
  if (loc && (!(Math.abs(loc.lat) <= 90) || !(Math.abs(loc.lon) <= 180))) throw new Error('Invalid location')
  db.tx(() => {
    for (const id of assetIds) {
      if (loc) {
        db.run("UPDATE assets SET latitude = ?, longitude = ?, location_source = 'manual', updated_at = ? WHERE id = ?", [loc.lat, loc.lon, now, id])
      } else {
        db.run("UPDATE assets SET latitude = NULL, longitude = NULL, location_source = NULL, updated_at = ? WHERE id = ? AND location_source = 'manual'", [now, id])
      }
    }
  })
}

// --- Smart albums ------------------------------------------------------------------------------------

/** Filters that make sense to save (not paging, selection or display-only state). */
function savable(q: AssetQuery): AssetQuery {
  const { ids: _ids, smartText: _s, sort: _sort, trash: _t, ...rest } = q
  return { ...rest, hidden: 'exclude' }
}

export function smartAlbums(library: Library): SmartAlbum[] {
  return library.db.all<{ id: number; name: string; query_json: string }>('SELECT id, name, query_json FROM smart_albums ORDER BY name').map((r) => {
    const query = JSON.parse(r.query_json) as AssetQuery
    const w = assetWhere(query)
    const count = library.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM assets a ${w.sql}`, w.params)?.n ?? 0
    const cover =
      library.db.get<{ id: number }>(`SELECT a.id FROM assets a ${w.sql} AND a.thumb_status = 'ready' ORDER BY a.favorite DESC, a.sort_time DESC LIMIT 1`, w.params)?.id ?? null
    return { id: r.id, name: r.name, query, count, coverId: cover }
  })
}

export function createSmartAlbum(library: Library, name: string, query: AssetQuery): SmartAlbum {
  const now = new Date().toISOString()
  const clean = name.trim().slice(0, 120)
  if (!clean) throw new Error('Give the album a name.')
  const id = Number(
    library.db.run('INSERT INTO smart_albums (name, query_json, created_at, updated_at) VALUES (?, ?, ?, ?)', [clean, JSON.stringify(savable(query)), now, now]).lastInsertRowid
  )
  return smartAlbums(library).find((a) => a.id === id) as SmartAlbum
}

export function updateSmartAlbum(library: Library, id: number, patch: { name?: string; query?: AssetQuery }): void {
  const now = new Date().toISOString()
  if (patch.name !== undefined) library.db.run('UPDATE smart_albums SET name = ?, updated_at = ? WHERE id = ?', [patch.name.trim().slice(0, 120) || 'Smart album', now, id])
  if (patch.query) library.db.run('UPDATE smart_albums SET query_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(savable(patch.query)), now, id])
}

export function deleteSmartAlbum(library: Library, id: number): void {
  library.db.run('DELETE FROM smart_albums WHERE id = ?', [id])
}

// --- Faces on one photo ------------------------------------------------------------------------------

export function assetFaces(library: Library, assetId: number): AssetFace[] {
  return library.db
    .all<{ id: number; x: number; y: number; w: number; h: number; person_id: number | null; name: string | null; manual: number }>(
      `SELECT f.id, f.x, f.y, f.w, f.h, f.person_id, p.name, f.manual
         FROM faces f LEFT JOIN persons p ON p.id = f.person_id WHERE f.asset_id = ? ORDER BY f.x`,
      [assetId]
    )
    .map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, personId: r.person_id, personName: r.name, manual: r.manual === 1 }))
}

/**
 * Records a face the user marked. `found` is the detector's result inside the marked area (then the face is
 * recognisable and can be grouped); without it the face is stored as a plain box (quality 0, excluded from
 * grouping) that the user names by hand.
 */
export function addManualFace(library: Library, assetId: number, box: { x: number; y: number; w: number; h: number }, found: Omit<DetectedFace, 'crop'> | null): number {
  const db = library.db
  const f = found ?? { ...box, score: 0, quality: 0, vec: new Float32Array(128) }
  return Number(
    db.run('INSERT INTO faces (asset_id, x, y, w, h, score, quality, vec, manual, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)', [
      assetId,
      f.x,
      f.y,
      f.w,
      f.h,
      f.score,
      f.quality,
      new Uint8Array(f.vec.buffer, f.vec.byteOffset, f.vec.byteLength),
      'user',
      new Date().toISOString()
    ]).lastInsertRowid
  )
}

/** "Not a face": removes the detection (the photo stays scanned, so it is not detected again). */
export function deleteFace(library: Library, faceId: number): void {
  const db = library.db
  db.tx(() => {
    db.run('DELETE FROM faces WHERE id = ?', [faceId])
    db.run('DELETE FROM persons WHERE NOT EXISTS (SELECT 1 FROM faces f WHERE f.person_id = persons.id)')
  })
}
