import { existsSync } from 'node:fs'
import { join, posix } from 'node:path'
import type { Database } from '../db/database'
import { ingestFile, type IngestSource } from '../library/ingest'
import { originalsDir } from '../library/layout'
import type { Library } from '../library/library'
import { emptyMetadata, localSortMs, wallToSortMs, type ExtractedMetadata } from '../media/metadata'
import { icloudAsSidecar, resolveMetadata, type ResolvedMetadata } from '../media/resolve'
import { ZipPool } from '../sources/zip'
import { parseTakeoutSidecar } from '../takeout/sidecar'
import { syncTakeoutAlbums } from '../repo/albums'
import { errorMessage, mapPool } from '../util'

export interface CommitProgress {
  phase: 'importing' | 'linking'
  done: number
  total: number
  bytes: number
  currentFile: string | null
}

interface PendingItem {
  id: number
  source_path: string
  source_root: string | null
  source_type: string | null
  container_path: string | null
  entry_name: string | null
  sidecar_path: string | null
  sidecar_json: string | null
  album: string | null
  relative_path: string
  filename: string
  size_bytes: number
  fs_created_at: string | null
  fs_modified_at: string | null
  media_type: 'photo' | 'video'
  mime_type: string
  sha256: string
  classification: 'new' | 'duplicate_library' | 'duplicate_batch'
  metadata_json: string | null
}

interface ImportInfo {
  source_type: string
  source_path: string
}

const CHUNK = 32

function parseMeta(json: string | null): ExtractedMetadata {
  if (!json) return emptyMetadata()
  try {
    return { ...emptyMetadata(), ...(JSON.parse(json) as Partial<ExtractedMetadata>) }
  } catch {
    return emptyMetadata()
  }
}

/** File metadata combined with its export sidecar (see resolveMetadata for precedence). */
function itemMetadata(item: PendingItem): ResolvedMetadata {
  let sidecar: Parameters<typeof resolveMetadata>[1] = null
  if (item.sidecar_json) {
    try {
      const json = JSON.parse(item.sidecar_json) as { icloud?: { createdUtcMs: number | null; favorite: boolean; hidden: boolean } }
      sidecar = json.icloud ? icloudAsSidecar(json.icloud) : parseTakeoutSidecar(json)
    } catch {
      sidecar = null
    }
  }
  return resolveMetadata(parseMeta(item.metadata_json), sidecar)
}

/** Timeline position: capture time when known; otherwise the source file's modified time (flagged as such). */
export function sortPosition(meta: ExtractedMetadata, fsModifiedAt: string | null, fallback: string): { sortTime: number; sortDay: string; source: string } {
  let sortTime: number
  let source: string
  if (meta.captureTime) {
    sortTime = wallToSortMs(meta.captureTime)
    source = meta.captureTimeSource ?? 'exif_original'
  } else {
    sortTime = localSortMs(new Date(fsModifiedAt ?? fallback))
    source = 'file_modified'
  }
  return { sortTime, sortDay: new Date(sortTime).toISOString().slice(0, 10), source }
}

function upsertProvenance(db: Database, assetId: number, item: PendingItem, imp: ImportInfo, importId: number, now: string): void {
  db.run(
    `INSERT INTO provenance (asset_id, source_type, source_root, source_path, relative_path, original_filename, size_bytes,
                             fs_created_at, fs_modified_at, first_import_id, last_import_id, first_seen_at, last_seen_at, times_seen,
                             metadata_json, container_path, sidecar_path, sidecar_json, album)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT (asset_id, source_path) DO UPDATE SET
       times_seen     = provenance.times_seen + (provenance.last_import_id <> excluded.last_import_id),
       last_import_id = excluded.last_import_id,
       last_seen_at   = excluded.last_seen_at,
       size_bytes     = excluded.size_bytes,
       fs_modified_at = excluded.fs_modified_at,
       sidecar_path   = COALESCE(excluded.sidecar_path, provenance.sidecar_path),
       sidecar_json   = COALESCE(excluded.sidecar_json, provenance.sidecar_json),
       album          = COALESCE(excluded.album, provenance.album)`,
    [
      assetId,
      item.source_type ?? imp.source_type,
      item.source_root ?? imp.source_path,
      item.source_path,
      item.relative_path,
      item.filename,
      item.size_bytes,
      item.fs_created_at,
      item.fs_modified_at,
      importId,
      importId,
      now,
      now,
      item.metadata_json,
      item.container_path,
      item.sidecar_path,
      item.sidecar_json,
      item.album
    ]
  )
}

function createAsset(db: Database, library: Library, item: PendingItem, relativePath: string, importId: number, now: string): number {
  const meta = itemMetadata(item)
  const pos = sortPosition(meta, item.fs_modified_at, now)
  const r = db.run(
    `INSERT INTO assets (sha256, media_type, mime_type, size_bytes, width, height, duration_ms, orientation,
                         capture_time, capture_offset_minutes, capture_time_source, sort_time, sort_day, sort_time_source,
                         latitude, longitude, altitude, camera_make, camera_model, lens_model, original_filename,
                         first_import_id, metadata_json, created_at, updated_at, description, favorite, has_audio, frames, fallback_sort_time, hidden, hidden_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.sha256,
      item.media_type,
      item.mime_type,
      item.size_bytes,
      meta.width,
      meta.height,
      meta.durationMs,
      meta.orientation,
      meta.captureTime,
      meta.captureOffsetMinutes,
      meta.captureTimeSource,
      pos.sortTime,
      pos.sortDay,
      pos.source,
      meta.latitude,
      meta.longitude,
      meta.altitude,
      meta.cameraMake,
      meta.cameraModel,
      meta.lensModel,
      item.filename,
      importId,
      JSON.stringify(meta.raw),
      now,
      now,
      meta.description,
      meta.favorite ? 1 : 0,
      meta.hasAudio === null || meta.hasAudio === undefined ? null : meta.hasAudio ? 1 : 0,
      meta.frames ?? null,
      meta.captureTime ? null : pos.sortTime,
      meta.hidden ? 1 : 0,
      meta.hidden ? now : null
    ]
  )
  const assetId = r.lastInsertRowid
  db.run(
    `INSERT INTO files (asset_id, storage_location_id, relative_path, size_bytes, sha256, role, verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'original', ?, ?)`,
    [assetId, library.managedLocationId, relativePath, item.size_bytes, item.sha256, now, now]
  )
  return assetId
}

/** Dates found in the file or its export metadata (not inferred by Photo Vault, not set by hand). */
const RECORDED_DATE = new Set(['exif_original', 'exif_digitized', 'xmp', 'takeout', 'icloud', 'quicktime', 'filename', 'exif_modified'])
const DATE_RANK: Record<string, number> = { exif_original: 6, exif_digitized: 5, xmp: 5, takeout: 4, icloud: 4, quicktime: 3, filename: 2, exif_modified: 1 }

/**
 * A later import may know more about an asset than the copy that was imported first — e.g. a Takeout or
 * iCloud export with the real "taken" time for a photo that was imported from a web download without one.
 * Fills in what is missing: a date (when the asset has none, only an estimate, or a weaker recorded one),
 * a location, a description and the favourite flag. Hand-set dates are never touched.
 */
function enrichAsset(library: Library, assetId: number, item: PendingItem): void {
  const db = library.db
  const a = db.get<{ capture_time: string | null; capture_time_source: string | null; latitude: number | null; description: string | null; favorite: number }>(
    'SELECT capture_time, capture_time_source, latitude, description, favorite FROM assets WHERE id = ?',
    [assetId]
  )
  if (!a) return
  const meta = itemMetadata(item)
  const now = new Date().toISOString()
  const from = item.container_path ? `${item.relative_path} in ${item.container_path}` : item.source_path

  const current = a.capture_time_source ?? ''
  const currentRank = a.capture_time === null || current === 'estimated' || current === 'duplicate' ? 0 : current === 'manual' ? Infinity : (DATE_RANK[current] ?? 0)
  const newSource = meta.captureTimeSource ?? ''
  if (meta.captureTime && RECORDED_DATE.has(newSource) && (DATE_RANK[newSource] ?? 0) > currentRank) {
    const pos = sortPosition(meta, item.fs_modified_at, now)
    db.run(
      `UPDATE assets SET capture_time = ?, capture_offset_minutes = ?, capture_time_source = ?, sort_time = ?, sort_day = ?, sort_time_source = ?,
              date_evidence = ?, updated_at = ? WHERE id = ?`,
      [meta.captureTime, meta.captureOffsetMinutes, newSource, pos.sortTime, pos.sortDay, pos.source, JSON.stringify([`Found in a later import: ${from}`]), now, assetId]
    )
    library.logger.info('enrich.date', { assetId, source: newSource, from })
  }
  if (a.latitude === null && meta.latitude !== null && meta.longitude !== null) {
    db.run('UPDATE assets SET latitude = ?, longitude = ?, altitude = ?, updated_at = ? WHERE id = ?', [meta.latitude, meta.longitude, meta.altitude, now, assetId])
  }
  if (!a.description && meta.description) db.run('UPDATE assets SET description = ?, updated_at = ? WHERE id = ?', [meta.description, now, assetId])
  if (a.favorite === 0 && meta.favorite) db.run('UPDATE assets SET favorite = 1, updated_at = ? WHERE id = ?', [now, assetId])
}

/** Where to read an item's bytes from: the plain file, or its entry inside a ZIP. */
function ingestSource(item: PendingItem, zips: ZipPool): IngestSource {
  const containerPath = item.container_path
  const entryName = item.entry_name
  if (containerPath && entryName) {
    return {
      kind: 'stream',
      label: item.source_path,
      open: async () => (await zips.get(containerPath)).openEntry(entryName),
      mtime: item.fs_modified_at ? new Date(item.fs_modified_at) : null
    }
  }
  return { kind: 'file', path: item.source_path }
}

/**
 * If verification found an asset's managed original missing and this import brings the identical bytes,
 * copy them back to the original path (verified, never overwriting anything). Damaged ("mismatch") files
 * are deliberately left alone – they need a human decision.
 */
async function restoreMissingOriginals(library: Library, importId: number, zips: ZipPool, signal?: AbortSignal): Promise<number> {
  const db = library.db
  const rows = db.all<PendingItem & { file_id: number; file_rel: string }>(
    `SELECT i.*, f.id AS file_id, f.relative_path AS file_rel
       FROM import_items i
       JOIN assets a ON a.sha256 = i.sha256
       JOIN files f ON f.asset_id = a.id AND f.storage_location_id = ?
      WHERE i.import_id = ? AND i.classification = 'duplicate_library' AND i.outcome IS NULL AND f.verify_status = 'missing'
      ORDER BY i.id`,
    [library.managedLocationId, importId]
  )
  const done = new Set<number>()
  for (const r of rows) {
    signal?.throwIfAborted()
    if (done.has(r.file_id)) continue
    if (existsSync(join(library.root, ...r.file_rel.split('/')))) continue // came back (e.g. drive reconnected)
    try {
      const res = await ingestFile({
        source: ingestSource(r, zips),
        expectedSha256: r.sha256,
        libraryRoot: library.root,
        tempDir: library.paths.temp,
        relDir: posix.dirname(r.file_rel),
        filename: posix.basename(r.file_rel),
        isPathTracked: (rel) =>
          rel !== r.file_rel && db.get('SELECT 1 FROM files WHERE storage_location_id = ? AND relative_path = ?', [library.managedLocationId, rel]) !== undefined
      })
      const now = new Date().toISOString()
      db.run("UPDATE files SET relative_path = ?, verify_status = 'ok', verified_at = ?, missing_since = NULL WHERE id = ?", [res.relativePath, now, r.file_id])
      done.add(r.file_id)
      library.logger.warn('ingest.restored_missing_original', { fileId: r.file_id, relativePath: res.relativePath, from: r.source_path })
    } catch (err) {
      library.logger.error('ingest.restore_failed', { fileId: r.file_id, error: errorMessage(err) })
    }
  }
  return done.size
}

/**
 * Ingests the classified items of an import:
 *   new items        -> verified copy into managed storage + asset + file + provenance
 *   duplicate items  -> provenance only (nothing is copied, nothing is deleted)
 * Safe to call again after an interruption: items that already have an outcome are skipped.
 */
export async function commitImport(opts: {
  library: Library
  importId: number
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (p: CommitProgress) => void
  onAssetsCreated?: (assetIds: number[]) => void
}): Promise<{ assetsCreated: number; failed: number }> {
  const { library, importId } = opts
  const db = library.db
  const imp = db.get<ImportInfo>('SELECT source_type, source_path FROM imports WHERE id = ?', [importId])
  if (!imp) throw new Error(`Unknown import ${importId}`)
  const log = library.logger

  const totalNew = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM import_items WHERE import_id = ? AND classification = 'new' AND outcome IS NULL", [importId])?.n ?? 0
  let done = 0
  let bytes = 0
  let assetsCreated = 0
  const isPathTracked = (rel: string): boolean =>
    db.get('SELECT 1 FROM files WHERE storage_location_id = ? AND relative_path = ?', [library.managedLocationId, rel]) !== undefined

  const zips = new ZipPool()
  try {
    let lastId = 0
    for (;;) {
      opts.signal?.throwIfAborted()
      const chunk = db.all<PendingItem>(
        `SELECT * FROM import_items WHERE import_id = ? AND classification = 'new' AND outcome IS NULL AND id > ? ORDER BY id LIMIT ?`,
        [importId, lastId, CHUNK]
      )
      if (chunk.length === 0) break
      lastId = chunk[chunk.length - 1]!.id

      const results = await mapPool(chunk, opts.concurrency ?? 3, async (item) => {
        // Another import may have added these bytes since analysis; then this is a duplicate after all.
        const existing = db.get<{ id: number }>('SELECT id FROM assets WHERE sha256 = ?', [item.sha256])
        if (existing) return { item, existingAssetId: existing.id, relativePath: null, error: null }
        try {
          const meta = itemMetadata(item)
          const res = await ingestFile({
            source: ingestSource(item, zips),
            expectedSha256: item.sha256,
            libraryRoot: library.root,
            tempDir: library.paths.temp,
            relDir: originalsDir(meta.captureTime),
            filename: item.filename,
            isPathTracked
          })
          if (res.adopted) log.warn('ingest.adopted_existing_file', { relativePath: res.relativePath, sha256: item.sha256 })
          return { item, existingAssetId: null, relativePath: res.relativePath, error: null }
        } catch (err) {
          return { item, existingAssetId: null, relativePath: null, error: errorMessage(err) }
        } finally {
          done++
          bytes += item.size_bytes
          opts.onProgress?.({ phase: 'importing', done, total: totalNew, bytes, currentFile: item.relative_path })
        }
      })

      const now = new Date().toISOString()
      const created: number[] = []
      let chunkFailed = 0
      db.tx(() => {
        for (const r of results) {
          if (r.error !== null) {
            chunkFailed++
            db.run("UPDATE import_items SET outcome = 'failed', error = ? WHERE id = ?", [r.error, r.item.id])
            log.error('ingest.failed', { importId, source: r.item.source_path, error: r.error })
            continue
          }
          let assetId: number
          let outcome: 'imported' | 'skipped'
          if (r.existingAssetId !== null) {
            assetId = r.existingAssetId
            outcome = 'skipped'
          } else {
            assetId = createAsset(db, library, r.item, r.relativePath as string, importId, now)
            outcome = 'imported'
            created.push(assetId)
          }
          upsertProvenance(db, assetId, r.item, imp, importId, now)
          db.run('UPDATE import_items SET outcome = ?, asset_id = ? WHERE id = ?', [outcome, assetId, r.item.id])
        }
        db.run('UPDATE imports SET assets_created = assets_created + ?, files_failed = files_failed + ? WHERE id = ?', [created.length, chunkFailed, importId])
      })
      assetsCreated += created.length
      if (created.length > 0) opts.onAssetsCreated?.(created)
    }

    await restoreMissingOriginals(library, importId, zips, opts.signal)
  } finally {
    await zips.closeAll()
  }

  // Duplicates: record where else these bytes were seen. Nothing is copied or removed.
  const totalDup =
    db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM import_items WHERE import_id = ? AND classification IN ('duplicate_library', 'duplicate_batch') AND outcome IS NULL",
      [importId]
    )?.n ?? 0
  let linked = 0
  let lastId = 0
  for (;;) {
    opts.signal?.throwIfAborted()
    const chunk = db.all<PendingItem>(
      `SELECT * FROM import_items WHERE import_id = ? AND classification IN ('duplicate_library', 'duplicate_batch')
         AND outcome IS NULL AND id > ? ORDER BY id LIMIT 500`,
      [importId, lastId]
    )
    if (chunk.length === 0) break
    lastId = chunk[chunk.length - 1]!.id
    const now = new Date().toISOString()
    db.tx(() => {
      for (const item of chunk) {
        const asset = db.get<{ id: number }>('SELECT id FROM assets WHERE sha256 = ?', [item.sha256])
        if (!asset) {
          db.run("UPDATE import_items SET outcome = 'failed', error = ? WHERE id = ?", [
            'An identical copy of this file was meant to be imported but failed; this copy was left untouched.',
            item.id
          ])
          db.run('UPDATE imports SET files_failed = files_failed + 1 WHERE id = ?', [importId])
          continue
        }
        upsertProvenance(db, asset.id, item, imp, importId, now)
        enrichAsset(library, asset.id, item)
        const outcome = item.classification === 'duplicate_batch' ? 'linked' : 'skipped'
        db.run('UPDATE import_items SET outcome = ?, asset_id = ? WHERE id = ?', [outcome, asset.id, item.id])
      }
    })
    linked += chunk.length
    opts.onProgress?.({ phase: 'linking', done: linked, total: totalDup, bytes, currentFile: null })
  }

  syncTakeoutAlbums(library, importId)
  // New provenance can change where an asset appears to come from: re-label everything this import touched.
  db.run('UPDATE assets SET classify_version = 0 WHERE id IN (SELECT asset_id FROM import_items WHERE import_id = ? AND asset_id IS NOT NULL)', [importId])

  const totals = db.get<{ assets_created: number; files_failed: number }>('SELECT assets_created, files_failed FROM imports WHERE id = ?', [importId])
  return { assetsCreated: totals?.assets_created ?? assetsCreated, failed: totals?.files_failed ?? 0 }
}
