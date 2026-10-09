import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { errorMessage } from '../util'
import type { Library } from './library'

/** How a permanently deleted original leaves the library folder: e.g. the OS recycle bin, or plain unlink. */
export type RemoveFile = (absolutePath: string) => Promise<void>

export interface DeleteProgress {
  done: number
  total: number
  failed: number
  bytes: number
}

export interface DeleteResult {
  deleted: number
  failed: number
  bytes: number
  errors: string[]
}

/** A Live Photo's motion clip always shares its still's fate. */
function withLiveClips(library: Library, assetIds: number[]): number[] {
  if (assetIds.length === 0) return assetIds
  const clips = library.db
    .all<{ id: number }>('SELECT id FROM assets WHERE live_photo_of IN (SELECT value FROM json_each(?))', [JSON.stringify(assetIds)])
    .map((r) => r.id)
  return [...new Set([...assetIds, ...clips])]
}

/** Moves items to the Bin. Reversible; nothing on disk changes. */
export function moveToBin(library: Library, assetIds: number[]): number {
  assetIds = withLiveClips(library, assetIds)
  const now = new Date().toISOString()
  let n = 0
  library.db.tx(() => {
    for (const id of assetIds) n += library.db.run('UPDATE assets SET trashed_at = ?, updated_at = ? WHERE id = ? AND trashed_at IS NULL', [now, now, id]).changes
  })
  library.logger.info('bin.moved', { count: n })
  return n
}

export function restoreFromBin(library: Library, assetIds: number[]): number {
  assetIds = withLiveClips(library, assetIds)
  const now = new Date().toISOString()
  let n = 0
  library.db.tx(() => {
    for (const id of assetIds) n += library.db.run('UPDATE assets SET trashed_at = NULL, updated_at = ? WHERE id = ? AND trashed_at IS NOT NULL', [now, id]).changes
  })
  library.logger.info('bin.restored', { count: n })
  return n
}

export function binIds(library: Library): number[] {
  return library.db.all<{ id: number }>('SELECT id FROM assets WHERE trashed_at IS NOT NULL ORDER BY id').map((r) => r.id)
}

/**
 * Permanently deletes items that are in the Bin (anything else is refused):
 *   1. the managed original(s) leave the library folder through `removeFile` (the app passes the OS recycle bin);
 *      if that fails, the item stays in the Bin untouched;
 *   2. cached thumbnails are removed;
 *   3. its catalogue rows go, and its SHA-256 is remembered in `deleted_assets` so a later import of the same
 *      bytes is reported as "deleted before" instead of being imported again.
 * Source folders and archives are never touched. Every deletion is logged.
 */
export async function deletePermanently(
  library: Library,
  assetIds: number[],
  opts: { removeFile?: RemoveFile; onProgress?: (p: DeleteProgress) => void } = {}
): Promise<DeleteResult> {
  const db = library.db
  assetIds = withLiveClips(library, assetIds)
  const removeFile = opts.removeFile ?? ((p: string) => unlink(p))
  const result: DeleteResult = { deleted: 0, failed: 0, bytes: 0, errors: [] }
  const total = assetIds.length

  for (const id of assetIds) {
    const asset = db.get<{ id: number; sha256: string; original_filename: string; media_type: string; size_bytes: number; trashed_at: string | null }>(
      'SELECT id, sha256, original_filename, media_type, size_bytes, trashed_at FROM assets WHERE id = ?',
      [id]
    )
    if (!asset || !asset.trashed_at) continue // only items already in the Bin can be deleted
    const files = db.all<{ relative_path: string; root_path: string | null }>(
      'SELECT f.relative_path, s.root_path FROM files f JOIN storage_locations s ON s.id = f.storage_location_id WHERE f.asset_id = ?',
      [id]
    )
    try {
      for (const f of files) {
        const abs = join(f.root_path ?? library.root, ...f.relative_path.split('/'))
        if (existsSync(abs)) await removeFile(abs)
      }
    } catch (err) {
      result.failed++
      result.errors.push(`${asset.original_filename}: ${errorMessage(err)}`)
      library.logger.error('bin.delete_failed', { assetId: id, error: errorMessage(err) })
      opts.onProgress?.({ done: result.deleted + result.failed, total, failed: result.failed, bytes: result.bytes })
      continue
    }
    for (const t of db.all<{ relative_path: string }>('SELECT relative_path FROM asset_thumbnails WHERE asset_id = ?', [id])) {
      await unlink(join(library.root, ...t.relative_path.split('/'))).catch(() => undefined) // regenerable cache
    }
    const now = new Date().toISOString()
    db.tx(() => {
      db.run(
        `INSERT INTO deleted_assets (sha256, original_filename, media_type, size_bytes, deleted_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (sha256) DO UPDATE SET deleted_at = excluded.deleted_at`,
        [asset.sha256, asset.original_filename, asset.media_type, asset.size_bytes, now]
      )
      for (const table of ['album_assets', 'asset_hashes', 'asset_embeddings', 'asset_tags', 'faces', 'face_scans', 'asset_thumbnails', 'provenance', 'files']) {
        db.run(`DELETE FROM ${table} WHERE asset_id = ?`, [id])
      }
      db.run('DELETE FROM near_duplicate_dismissals WHERE asset_a = ? OR asset_b = ?', [id, id])
      db.run('UPDATE albums SET cover_asset_id = NULL WHERE cover_asset_id = ?', [id])
      db.run('UPDATE import_items SET asset_id = NULL WHERE asset_id = ?', [id])
      db.run('DELETE FROM assets WHERE id = ?', [id])
    })
    library.logger.warn('bin.deleted', { sha256: asset.sha256, filename: asset.original_filename, files: files.map((f) => f.relative_path), bytes: asset.size_bytes })
    result.deleted++
    result.bytes += asset.size_bytes
    if (result.deleted % 20 === 0 || result.deleted + result.failed === total) {
      opts.onProgress?.({ done: result.deleted + result.failed, total, failed: result.failed, bytes: result.bytes })
    }
  }
  library.logger.info('bin.delete_finished', { ...result, errors: result.errors.length })
  return result
}

/** Allows previously deleted content to be imported again (clears the remembered hashes). */
export function forgetDeleted(library: Library): number {
  return library.db.run('DELETE FROM deleted_assets').changes
}
