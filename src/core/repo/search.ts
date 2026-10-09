import type { Library } from '../library/library'

/**
 * Full-text search index (SQLite FTS5, trigram tokenizer): one row per asset holding every searchable text —
 * file names (including every name it was found under), folders and Google album names, cameras, description,
 * the date, the format, the user's album names, tags and the names of the people in it. Trigrams keep "contains" semantics ("4801" finds
 * IMG_4801.JPG) and ignore case and accents. Triggers mark changed assets in `search_dirty`; this module
 * (re)builds those rows lazily — in the background after open/imports, and before any text query.
 */
const TEXT_SQL = `
  a.original_filename || ' ' || COALESCE(a.place, '') || ' ' || COALESCE(a.camera_make, '') || ' ' || COALESCE(a.camera_model, '') || ' ' ||
  COALESCE(a.description, '') || ' ' || COALESCE(a.sort_day, '') || ' ' || a.mime_type || ' ' ||
  COALESCE((SELECT group_concat(COALESCE(p.original_filename, '') || ' ' || COALESCE(p.album, '') || ' ' || COALESCE(p.relative_path, ''), ' ')
              FROM provenance p WHERE p.asset_id = a.id), '') || ' ' ||
  COALESCE((SELECT group_concat(al.name, ' ') FROM album_assets x JOIN albums al ON al.id = x.album_id WHERE x.asset_id = a.id), '') || ' ' ||
  COALESCE((SELECT group_concat(DISTINCT pe.name) FROM faces fa JOIN persons pe ON pe.id = fa.person_id WHERE fa.asset_id = a.id AND pe.name IS NOT NULL), '') || ' ' ||
  COALESCE((SELECT group_concat(tg.tag, ' ') FROM asset_tags tg WHERE tg.asset_id = a.id), '') || ' ' ||
  COALESCE((SELECT c.caption FROM asset_captions c WHERE c.asset_id = a.id), '')`

/** Re-indexes up to `limit` changed assets (all when omitted). Returns how many were indexed. */
export function refreshSearchIndex(library: Library, limit?: number): number {
  const db = library.db
  const ids = db
    .all<{ asset_id: number }>(`SELECT asset_id FROM search_dirty ORDER BY asset_id${limit ? ' LIMIT ?' : ''}`, limit ? [limit] : [])
    .map((r) => r.asset_id)
  if (ids.length === 0) return 0
  const list = JSON.stringify(ids)
  db.tx(() => {
    db.run('DELETE FROM asset_search WHERE rowid IN (SELECT value FROM json_each(?))', [list])
    db.run(`INSERT INTO asset_search (rowid, text) SELECT a.id, ${TEXT_SQL} FROM assets a WHERE a.id IN (SELECT value FROM json_each(?))`, [list])
    db.run('DELETE FROM search_dirty WHERE asset_id IN (SELECT value FROM json_each(?))', [list])
  })
  return ids.length
}

/** Indexes everything still pending in small steps, yielding between them so the app stays responsive. */
export async function buildSearchIndexInBackground(library: Library, isCurrent: () => boolean): Promise<void> {
  while (isCurrent()) {
    if (refreshSearchIndex(library, 2000) === 0) return
    await new Promise((r) => setTimeout(r, 15))
  }
}

/** SQL condition matching assets whose searchable text contains `token`. */
export function searchCondition(token: string): { sql: string; params: string[] } {
  // Trigram MATCH needs ≥ 3 characters; shorter tokens fall back to a scan of the index text.
  if ([...token].length >= 3) {
    return { sql: 'a.id IN (SELECT rowid FROM asset_search WHERE asset_search MATCH ?)', params: [`"${token.replace(/"/g, '""')}"`] }
  }
  const like = `%${token.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return { sql: "a.id IN (SELECT rowid FROM asset_search WHERE text LIKE ? ESCAPE '\\')", params: [like] }
}
