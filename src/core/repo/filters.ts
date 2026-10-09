import type { AssetKind, AssetOrigin, AssetQuery, Facets } from '@shared/types'
import type { Library } from '../library/library'
import { refreshSearchIndex, searchCondition } from './search'

export interface WhereClause {
  sql: string
  params: Array<string | number>
}

/**
 * Builds the WHERE clause shared by the timeline groups and the asset pages, so their counts and
 * offsets always agree. Every filter is index-friendly or a bounded EXISTS; text search uses the FTS5
 * index (core/repo/search.ts) — callers refresh it first with refreshSearchIndex() when `text` is set.
 */
export function assetWhere(q: AssetQuery | undefined): WhereClause {
  const parts: string[] = []
  const params: Array<string | number> = []
  // The Bin is its own world: binned items appear nowhere else, and the Bin shows only them.
  parts.push(q?.trash === 'only' ? 'a.trashed_at IS NOT NULL' : 'a.trashed_at IS NULL')
  // Live Photo motion clips travel with their still; they never appear as separate items.
  parts.push('a.live_photo_of IS NULL AND a.version_of IS NULL')
  if (!q) return { sql: `WHERE ${parts.join(' AND ')}`, params }

  if (q.mediaType === 'photo' || q.mediaType === 'video') {
    parts.push('a.media_type = ?')
    params.push(q.mediaType)
  }
  if (q.favorite) parts.push('a.favorite = 1')
  if (q.located) parts.push('a.latitude IS NOT NULL AND a.longitude IS NOT NULL')
  if (typeof q.tag === 'string') {
    parts.push('a.id IN (SELECT t.asset_id FROM asset_tags t WHERE t.tag = ?)')
    params.push(q.tag)
  }
  if (typeof q.personId === 'number') {
    // IN, not a correlated EXISTS: SQLite would otherwise re-read this person's faces for every photo.
    parts.push('a.id IN (SELECT f.asset_id FROM faces f WHERE f.person_id = ?)')
    params.push(q.personId)
  }
  if (q.ids) {
    parts.push('a.id IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(q.ids))
  }
  if (q.bbox) {
    const [south, west, north, east] = q.bbox
    parts.push(
      west <= east
        ? 'a.latitude BETWEEN ? AND ? AND a.longitude BETWEEN ? AND ?'
        : 'a.latitude BETWEEN ? AND ? AND (a.longitude >= ? OR a.longitude <= ?)'
    )
    params.push(south, north, west, east)
  }
  // Year 0 = "No date".
  if (typeof q.year === 'number' && Number.isInteger(q.year)) {
    if (q.year === 0) parts.push('a.undated = 1')
    else {
      parts.push('a.undated = 0 AND a.sort_day >= ? AND a.sort_day < ?')
      params.push(`${q.year}-01-01`, `${q.year + 1}-01-01`)
    }
  }
  if (typeof q.cameraModel === 'string') {
    parts.push("a.camera_model = ? AND COALESCE(a.camera_make, '') = ?")
    params.push(q.cameraModel, q.cameraMake ?? '')
  }
  if (typeof q.sourceType === 'string') {
    parts.push('EXISTS (SELECT 1 FROM provenance p WHERE p.asset_id = a.id AND p.source_type = ?)')
    params.push(q.sourceType)
  }
  if (q.origin === 'unknown') parts.push('a.origin IS NULL')
  else if (typeof q.origin === 'string') {
    parts.push('a.origin = ?')
    params.push(q.origin)
  }
  if (q.originHint === 'none') parts.push('a.origin_hint IS NULL')
  else if (q.originHint === 'whatsapp_size' || q.originHint === 'social_size') {
    parts.push('a.origin_hint = ?')
    params.push(q.originHint)
  }
  if (typeof q.kind === 'string') {
    parts.push('a.kind = ?')
    params.push(q.kind)
  }
  if (q.hidden === 'exclude') parts.push('a.hidden = 0')
  if (q.hidden === 'only') parts.push('a.hidden = 1')
  // Multi-select filters: OR within each, AND between them.
  if (q.types?.length) {
    const media = q.types.filter((t) => t === 'photo' || t === 'video')
    const kinds = q.types.filter((t) => t !== 'photo' && t !== 'video')
    const ors: string[] = []
    if (media.length) {
      ors.push(`a.media_type IN (${media.map(() => '?').join(', ')})`)
      params.push(...media)
    }
    if (kinds.length) {
      ors.push(`a.kind IN (${kinds.map(() => '?').join(', ')})`)
      params.push(...kinds)
    }
    parts.push(`(${ors.join(' OR ')})`)
  }
  if (q.years?.length) {
    parts.push(`(${q.years.map((y) => (y === 0 ? 'a.undated = 1' : '(a.undated = 0 AND a.sort_day >= ? AND a.sort_day < ?)')).join(' OR ')})`)
    for (const y of q.years) if (y !== 0) params.push(`${y}-01-01`, `${y + 1}-01-01`)
  }
  if (q.cameras?.length) {
    parts.push(`(${q.cameras.map(() => "(a.camera_model = ? AND COALESCE(a.camera_make, '') = ?)").join(' OR ')})`)
    for (const c of q.cameras) params.push(c.model, c.make ?? '')
  }
  if (q.sourceTypes?.length) {
    parts.push(`EXISTS (SELECT 1 FROM provenance p WHERE p.asset_id = a.id AND p.source_type IN (${q.sourceTypes.map(() => '?').join(', ')}))`)
    params.push(...q.sourceTypes)
  }
  if (q.origins?.length) {
    const known = q.origins.filter((o) => o !== 'unknown')
    const ors: string[] = []
    if (known.length) {
      ors.push(`a.origin IN (${known.map(() => '?').join(', ')})`)
      params.push(...known)
    }
    if (q.origins.includes('unknown')) ors.push('a.origin IS NULL')
    parts.push(`(${ors.join(' OR ')})`)
  }
  if (typeof q.albumId === 'number') {
    parts.push('a.id IN (SELECT x.asset_id FROM album_assets x WHERE x.album_id = ?)')
    params.push(q.albumId)
  }
  const tokens = (q.text ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 8)
  for (const token of tokens) {
    const c = searchCondition(token)
    parts.push(c.sql)
    params.push(...c.params)
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params }
}

/** Hide or show everything matching a filter. Only flips a flag; files and albums are untouched. */
export function setHiddenByQuery(library: Library, q: AssetQuery, hidden: boolean): number {
  if (q.text) refreshSearchIndex(library)
  const w = assetWhere(q)
  return library.db.run(
    `UPDATE assets SET hidden = ?, hidden_at = ?, updated_at = ? WHERE id IN (SELECT a.id FROM assets a ${w.sql}) AND hidden <> ?`,
    [hidden ? 1 : 0, hidden ? new Date().toISOString() : null, new Date().toISOString(), ...w.params, hidden ? 1 : 0]
  ).changes
}

export function isEmptyQuery(q: AssetQuery | undefined): boolean {
  return assetWhere(q).sql === assetWhere(undefined).sql
}

/** Values the filter menus offer, with counts. */
export function facets(library: Library): Facets {
  const db = library.db
  return {
    years: db.all<{ year: number; count: number }>(
      `SELECT CASE WHEN undated = 1 THEN 0 ELSE CAST(substr(sort_day, 1, 4) AS INTEGER) END AS year, COUNT(*) AS count
         FROM assets WHERE trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL GROUP BY year ORDER BY year = 0, year DESC`
    ),
    cameras: db.all<{ make: string | null; model: string; count: number }>(
      `SELECT camera_make AS make, camera_model AS model, COUNT(*) AS count FROM assets
        WHERE camera_model IS NOT NULL AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL GROUP BY camera_make, camera_model ORDER BY count DESC LIMIT 50`
    ),
    sources: db.all<{ type: string; count: number }>(
      `SELECT p.source_type AS type, COUNT(DISTINCT p.asset_id) AS count FROM provenance p JOIN assets a ON a.id = p.asset_id
        WHERE a.trashed_at IS NULL AND a.live_photo_of IS NULL AND a.version_of IS NULL GROUP BY p.source_type ORDER BY count DESC`
    ),
    favorites: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM assets WHERE favorite = 1 AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL')?.n ?? 0,
    videos: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM assets WHERE media_type = 'video' AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL")?.n ?? 0,
    origins: db.all<{ origin: AssetOrigin | 'unknown'; count: number; hidden: number }>(
      "SELECT COALESCE(origin, 'unknown') AS origin, COUNT(*) AS count, SUM(hidden) AS hidden FROM assets WHERE kind IS NOT NULL AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL GROUP BY origin ORDER BY count DESC"
    ),
    kinds: db.all<{ kind: AssetKind; count: number; hidden: number }>(
      'SELECT kind, COUNT(*) AS count, SUM(hidden) AS hidden FROM assets WHERE kind IS NOT NULL AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL GROUP BY kind ORDER BY count DESC'
    ),
    receivedHints: db.all<{ hint: 'whatsapp_size' | 'social_size' | 'none'; count: number; hidden: number }>(
      "SELECT COALESCE(origin_hint, 'none') AS hint, COUNT(*) AS count, SUM(hidden) AS hidden FROM assets WHERE origin = 'received' AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL GROUP BY origin_hint ORDER BY count DESC"
    ),
    hidden: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM assets WHERE hidden = 1 AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL')?.n ?? 0,
    unclassified: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM assets WHERE classify_version = 0')?.n ?? 0
  }
}
