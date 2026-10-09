import { constants, existsSync, mkdirSync } from 'node:fs'
import { copyFile, utimes } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { wallToSortMs } from '../media/metadata'
import { errorMessage } from '../util'
import type { Library } from './library'

export interface ExportProgress {
  done: number
  total: number
  failed: number
  bytes: number
}

export interface ExportResult {
  exported: number
  failed: number
  bytes: number
  folder: string
  errors: string[]
}

/** Characters Windows (and some sync tools) reject in file names. */
function safeName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '')
  return cleaned || 'photo'
}

/** "name.jpg", then "name (2).jpg", "name (3).jpg"… — the first that does not exist yet. */
function freeName(folder: string, name: string, taken: Set<string>): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`
    if (!taken.has(candidate.toLowerCase()) && !existsSync(join(folder, candidate))) return candidate
  }
}

/**
 * Copies the originals of the given items into `folder`, byte for byte, under their original file names.
 * Never overwrites: name clashes get " (2)", and the copy itself uses COPYFILE_EXCL, so a file that appears
 * meanwhile is not replaced either. Each copy's modified time is set to the date taken (if known) so other
 * apps sort the export sensibly. Live Photo clips travel with their still. Nothing in the library changes.
 */
export async function exportOriginals(
  library: Library,
  assetIds: number[],
  folder: string,
  opts: { onProgress?: (p: ExportProgress) => void; signal?: { cancelled: boolean } } = {}
): Promise<ExportResult> {
  const db = library.db
  mkdirSync(folder, { recursive: true })
  const clips = db
    .all<{ id: number }>('SELECT id FROM assets WHERE live_photo_of IN (SELECT value FROM json_each(?))', [JSON.stringify(assetIds)])
    .map((r) => r.id)
  const ids = [...new Set([...assetIds, ...clips])]
  const result: ExportResult = { exported: 0, failed: 0, bytes: 0, folder, errors: [] }
  const taken = new Set<string>()
  const report = (): void => opts.onProgress?.({ done: result.exported + result.failed, total: ids.length, failed: result.failed, bytes: result.bytes })

  for (const id of ids) {
    if (opts.signal?.cancelled) break
    const a = db.get<{ original_filename: string; size_bytes: number; capture_time: string | null }>(
      'SELECT original_filename, size_bytes, capture_time FROM assets WHERE id = ?',
      [id]
    )
    const f = db.get<{ relative_path: string; root_path: string | null }>(
      `SELECT f.relative_path, s.root_path FROM files f JOIN storage_locations s ON s.id = f.storage_location_id
        WHERE f.asset_id = ? ORDER BY s.root_path IS NOT NULL, f.id LIMIT 1`,
      [id]
    )
    if (!a || !f) continue
    try {
      const src = join(f.root_path ?? library.root, ...f.relative_path.split('/'))
      const name = freeName(folder, safeName(a.original_filename), taken)
      taken.add(name.toLowerCase())
      const dest = join(folder, name)
      await copyFile(src, dest, constants.COPYFILE_EXCL)
      if (a.capture_time) {
        // Wall-clock time taken, applied as local time.
        const wall = new Date(wallToSortMs(a.capture_time))
        const local = new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds())
        await utimes(dest, local, local).catch(() => undefined)
      }
      result.exported++
      result.bytes += a.size_bytes
    } catch (err) {
      result.failed++
      result.errors.push(`${a.original_filename}: ${errorMessage(err)}`)
    }
    if ((result.exported + result.failed) % 10 === 0) report()
  }
  report()
  library.logger.info('export.finished', { folder, exported: result.exported, failed: result.failed, bytes: result.bytes })
  return result
}
