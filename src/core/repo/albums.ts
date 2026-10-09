import type { AlbumSummary } from '@shared/types'
import type { Library } from '../library/library'

interface AlbumRow {
  id: number
  name: string
  description: string | null
  kind: 'user' | 'takeout'
  cover_asset_id: number | null
  updated_at: string
  count: number
  cover_id: number | null
  cover_thumb: 'pending' | 'ready' | 'failed' | null
}

const ALBUM_SELECT = `
  SELECT al.id, al.name, al.description, al.kind, al.cover_asset_id, al.updated_at,
         (SELECT COUNT(*) FROM album_assets x JOIN assets t ON t.id = x.asset_id WHERE x.album_id = al.id AND t.trashed_at IS NULL) AS count,
         c.id AS cover_id, c.thumb_status AS cover_thumb
    FROM albums al
    LEFT JOIN assets c ON c.id = COALESCE(
      al.cover_asset_id,
      (SELECT a.id FROM album_assets x JOIN assets a ON a.id = x.asset_id WHERE x.album_id = al.id AND a.trashed_at IS NULL ORDER BY a.sort_time DESC, a.id DESC LIMIT 1)
    )`

function toSummary(r: AlbumRow): AlbumSummary {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    kind: r.kind,
    count: r.count,
    coverAssetId: r.cover_id,
    coverThumb: r.cover_thumb,
    updatedAt: r.updated_at
  }
}

function cleanName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!n) throw new Error('Album name cannot be empty.')
  return n
}

export function listAlbums(library: Library): AlbumSummary[] {
  return library.db.all<AlbumRow>(`${ALBUM_SELECT} ORDER BY al.updated_at DESC, al.id DESC`).map(toSummary)
}

export function getAlbum(library: Library, id: number): AlbumSummary | null {
  const r = library.db.get<AlbumRow>(`${ALBUM_SELECT} WHERE al.id = ?`, [id])
  return r ? toSummary(r) : null
}

export function createAlbum(library: Library, name: string, assetIds: number[] = []): AlbumSummary {
  const db = library.db
  const now = new Date().toISOString()
  const id = db.tx(() => {
    const albumId = db.run("INSERT INTO albums (name, kind, created_at, updated_at) VALUES (?, 'user', ?, ?)", [cleanName(name), now, now]).lastInsertRowid
    addAssets(library, albumId, assetIds)
    return albumId
  })
  library.logger.info('album.created', { id, name, assets: assetIds.length })
  return getAlbum(library, id) as AlbumSummary
}

export function updateAlbum(library: Library, id: number, patch: { name?: string; description?: string | null; coverAssetId?: number | null }): AlbumSummary {
  const db = library.db
  const current = getAlbum(library, id)
  if (!current) throw new Error('Album not found.')
  const name = patch.name !== undefined ? cleanName(patch.name) : current.name
  const description = patch.description !== undefined ? (patch.description?.trim() || null) : current.description
  db.run('UPDATE albums SET name = ?, description = ?, updated_at = ? WHERE id = ?', [name, description, new Date().toISOString(), id])
  if (patch.coverAssetId !== undefined) db.run('UPDATE albums SET cover_asset_id = ? WHERE id = ?', [patch.coverAssetId, id])
  return getAlbum(library, id) as AlbumSummary
}

/** Removes the album and its memberships only. Photos stay in the library and on disk. */
export function deleteAlbum(library: Library, id: number): void {
  library.db.tx(() => {
    library.db.run('DELETE FROM album_assets WHERE album_id = ?', [id])
    library.db.run('DELETE FROM albums WHERE id = ?', [id])
  })
  library.logger.info('album.deleted', { id })
}

export function addAssets(library: Library, albumId: number, assetIds: number[]): number {
  const db = library.db
  const now = new Date().toISOString()
  let added = 0
  db.tx(() => {
    for (const assetId of assetIds) {
      added += db.run('INSERT OR IGNORE INTO album_assets (album_id, asset_id, added_at) SELECT ?, id, ? FROM assets WHERE id = ?', [albumId, now, assetId]).changes
    }
    db.run('UPDATE albums SET updated_at = ? WHERE id = ?', [now, albumId])
  })
  return added
}

export function removeAssets(library: Library, albumId: number, assetIds: number[]): number {
  const db = library.db
  let removed = 0
  db.tx(() => {
    for (const assetId of assetIds) removed += db.run('DELETE FROM album_assets WHERE album_id = ? AND asset_id = ?', [albumId, assetId]).changes
    db.run('UPDATE albums SET cover_asset_id = NULL WHERE id = ? AND cover_asset_id IN (SELECT value FROM json_each(?))', [albumId, JSON.stringify(assetIds)])
    db.run('UPDATE albums SET updated_at = ? WHERE id = ?', [new Date().toISOString(), albumId])
  })
  return removed
}

export function albumsOfAsset(library: Library, assetId: number): Array<{ id: number; name: string }> {
  return library.db.all<{ id: number; name: string }>(
    'SELECT al.id, al.name FROM album_assets x JOIN albums al ON al.id = x.album_id WHERE x.asset_id = ? ORDER BY al.name',
    [assetId]
  )
}

/**
 * Recreates Google Photos albums from the Takeout folders seen by one import. Albums are keyed by
 * title, so re-importing never duplicates them; only memberships observed in *this* import are added,
 * so a photo the user removed from an album is not silently put back by an unrelated import.
 */
export function syncTakeoutAlbums(library: Library, importId: number): void {
  const db = library.db
  const now = new Date().toISOString()
  db.tx(() => {
    db.run(
      `INSERT OR IGNORE INTO albums (name, kind, source_key, created_at, updated_at)
       SELECT album, 'takeout', album, ?, ? FROM import_items
        WHERE import_id = ? AND album IS NOT NULL AND asset_id IS NOT NULL AND outcome IN ('imported', 'linked', 'skipped')
        GROUP BY album`,
      [now, now, importId]
    )
    db.run(
      `INSERT OR IGNORE INTO album_assets (album_id, asset_id, added_at)
       SELECT al.id, i.asset_id, ? FROM import_items i JOIN albums al ON al.kind = 'takeout' AND al.source_key = i.album
        WHERE i.import_id = ? AND i.asset_id IS NOT NULL AND i.outcome IN ('imported', 'linked', 'skipped')`,
      [now, importId]
    )
  })
}

export function setHidden(library: Library, assetIds: number[], hidden: boolean): void {
  const db = library.db
  const now = new Date().toISOString()
  db.tx(() => {
    for (const id of assetIds) db.run('UPDATE assets SET hidden = ?, hidden_at = ?, updated_at = ? WHERE id = ?', [hidden ? 1 : 0, hidden ? now : null, now, id])
  })
}

export function setFavorites(library: Library, assetIds: number[], favorite: boolean): void {
  const db = library.db
  const now = new Date().toISOString()
  db.tx(() => {
    for (const id of assetIds) db.run('UPDATE assets SET favorite = ?, updated_at = ? WHERE id = ?', [favorite ? 1 : 0, now, id])
  })
}
