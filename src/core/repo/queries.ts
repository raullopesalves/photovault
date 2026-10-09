import { join } from 'node:path'
import type {
  AssetDetail,
  AssetSummary,
  CaptureTimeSource,
  DuplicateGroup,
  FullView,
  ImportItemInfo,
  ImportSummary,
  ItemClassification,
  LibraryInfo,
  ProvenanceInfo,
  AssetKind,
  AssetOrigin,
  AssetQuery,
  SortTimeSource,
  TimelineGroup,
  PhotoEdits
} from '@shared/types'
import { importSummary } from '../import/analyze'
import { albumsOfAsset } from './albums'
import { assetWhere } from './filters'
import { refreshSearchIndex } from './search'
import { peopleOfAsset } from './people'
import { tagsOf } from './annotate'
import { placeLabel } from '../geo/places'
import type { Library } from '../library/library'
import { isBrowserDisplayable } from '../media/formats'

interface AssetRow {
  id: number
  sha256: string
  media_type: 'photo' | 'video'
  mime_type: string
  size_bytes: number
  width: number | null
  height: number | null
  duration_ms: number | null
  orientation: number | null
  capture_time: string | null
  capture_offset_minutes: number | null
  capture_time_source: string | null
  sort_time: number
  sort_time_source: string
  latitude: number | null
  longitude: number | null
  altitude: number | null
  camera_make: string | null
  camera_model: string | null
  lens_model: string | null
  original_filename: string
  favorite: number
  thumb_status: 'pending' | 'ready' | 'failed'
  metadata_json: string | null
  description: string | null
  created_at: string
  hidden: number
  trashed_at: string | null
  kind: AssetKind | null
  origin: AssetOrigin | null
  origin_evidence: string | null
  origin_confidence: 'certain' | 'probable' | null
  date_evidence: string | null
  kind_evidence: string | null
  has_audio: number | null
  rotation: number
  edits: string | null
  edit_rev: number
}

const SUMMARY_COLS = 'id, media_type, mime_type, width, height, duration_ms, sort_time, capture_time, thumb_status, favorite, hidden, kind, trashed_at, rotation, edit_rev, edits'

/** Id of the Live Photo motion clip attached to this still, if any. */
const LIVE_COL = '(SELECT v.id FROM assets v WHERE v.live_photo_of = a.id LIMIT 1) AS live_video_id'

function toSummary(
  r: Pick<AssetRow, 'id' | 'media_type' | 'mime_type' | 'width' | 'height' | 'duration_ms' | 'sort_time' | 'capture_time' | 'thumb_status' | 'favorite' | 'hidden' | 'kind' | 'trashed_at' | 'rotation' | 'edits' | 'edit_rev'> & {
    live_video_id?: number | null
  }
): AssetSummary {
  return {
    id: r.id,
    mediaType: r.media_type,
    mimeType: r.mime_type,
    width: r.width,
    height: r.height,
    durationMs: r.duration_ms,
    sortTime: r.sort_time,
    captureKnown: r.capture_time !== null,
    thumb: r.thumb_status,
    favorite: r.favorite === 1,
    hidden: r.hidden === 1,
    trashed: r.trashed_at !== null,
    rotation: r.rotation ?? 0,
    edited: !!r.edits,
    rev: `${r.rotation ?? 0}.${r.edit_rev ?? 0}`,
    liveVideoId: r.live_video_id ?? null,
    kind: r.kind
  }
}

export function libraryInfo(library: Library): LibraryInfo {
  const r = library.db.get<{
    n: number
    photos: number | null
    videos: number | null
    bytes: number | null
    pending: number | null
    hidden: number | null
    bin: number | null
    binBytes: number | null
  }>(
    `SELECT SUM(trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL) AS n,
            SUM(media_type = 'photo' AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL) AS photos,
            SUM(media_type = 'video' AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL) AS videos,
            SUM(size_bytes) AS bytes,
            SUM(thumb_status = 'pending') AS pending,
            SUM(hidden = 1 AND trashed_at IS NULL AND live_photo_of IS NULL AND version_of IS NULL) AS hidden,
            SUM(trashed_at IS NOT NULL) AS bin,
            SUM(CASE WHEN trashed_at IS NOT NULL THEN size_bytes ELSE 0 END) AS binBytes
       FROM assets`
  )
  const deleted = library.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM deleted_assets')?.n ?? 0
  const unprotected =
    library.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM assets a WHERE a.trashed_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM files f JOIN backup_files b ON b.file_id = f.id AND b.status = 'ok' AND b.sha256 = f.sha256 WHERE f.asset_id = a.id)`
    )?.n ?? 0
  return {
    path: library.root,
    assetCount: r?.n ?? 0,
    photoCount: r?.photos ?? 0,
    videoCount: r?.videos ?? 0,
    totalBytes: r?.bytes ?? 0,
    pendingThumbnails: r?.pending ?? 0,
    hiddenCount: r?.hidden ?? 0,
    binCount: r?.bin ?? 0,
    binBytes: r?.binBytes ?? 0,
    deletedCount: deleted,
    unprotectedCount: unprotected
  }
}

/** Timeline order; `timeline()` buckets, `assetsPage()` and `assetIdsInRange()` must all agree on it. */
function orderBy(query?: AssetQuery): { sql: string; params: string[] } {
  // Smart search results, best match first: the position in the `ids` list.
  if (query?.sort === 'relevance' && query.ids)
    return { sql: '(SELECT CAST(j.key AS INTEGER) FROM json_each(?) j WHERE j.value = a.id), a.id', params: [JSON.stringify(query.ids)] }
  return { sql: query?.sort === 'added' ? 'a.created_at DESC, a.id DESC' : 'a.undated, a.sort_time DESC, a.id DESC', params: [] }
}

/** Month buckets in timeline order. Tiny even for 100k assets (one row per month). */
export function timeline(library: Library, query?: AssetQuery): TimelineGroup[] {
  if (query?.text) refreshSearchIndex(library)
  const w = assetWhere(query)
  if (query?.sort === 'relevance' && query.ids) {
    const n = library.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM assets a ${w.sql}`, w.params)?.n ?? 0
    return n ? [{ month: 'matches', count: n }] : []
  }
  if (query?.sort === 'added') {
    // Day the item entered the library (local time; monotonic with created_at, so it matches orderBy).
    return library.db.all<TimelineGroup>(
      `SELECT substr(datetime(a.created_at, 'localtime'), 1, 10) AS month, COUNT(*) AS count
         FROM assets a ${w.sql} GROUP BY month ORDER BY month DESC`,
      w.params
    )
  }
  return library.db.all<TimelineGroup>(
    `SELECT CASE WHEN a.undated = 1 THEN 'undated' ELSE substr(a.sort_day, 1, 7) END AS month, COUNT(*) AS count
       FROM assets a ${w.sql} GROUP BY month ORDER BY month = 'undated', month DESC`,
    w.params
  )
}

/** A window of the timeline, ordered exactly like `timeline()` so offsets line up with its groups. */
export function assetsPage(library: Library, offset: number, limit: number, query?: AssetQuery): AssetSummary[] {
  if (query?.text) refreshSearchIndex(library)
  const w = assetWhere(query)
  const cols = `${SUMMARY_COLS.split(', ').map((c) => `a.${c}`).join(', ')}, ${LIVE_COL}`
  const rows = library.db.all<AssetRow>(
    `SELECT ${cols} FROM assets a ${w.sql} ORDER BY ${orderBy(query).sql} LIMIT ? OFFSET ?`,
    [...w.params, ...orderBy(query).params, Math.max(1, Math.min(limit, 1000)), Math.max(0, offset)]
  )
  return rows.map(toSummary)
}

/** Summaries for specific assets (any order). */
/** Ids of a timeline range in timeline order (same ordering as assetsPage). */
export function assetIdsInRange(library: Library, query: AssetQuery | undefined, offset: number, limit: number): number[] {
  if (query?.text) refreshSearchIndex(library)
  const w = assetWhere(query)
  return library.db
    .all<{ id: number }>(`SELECT a.id FROM assets a ${w.sql} ORDER BY ${orderBy(query).sql} LIMIT ? OFFSET ?`, [
      ...w.params,
      ...orderBy(query).params,
      Math.max(1, Math.min(limit, 200_000)),
      Math.max(0, offset)
    ])
    .map((r) => r.id)
}

export function assetSummaries(library: Library, ids: number[]): AssetSummary[] {
  if (ids.length === 0) return []
  const cols = `${SUMMARY_COLS.split(', ').map((c) => `a.${c}`).join(', ')}, ${LIVE_COL}`
  return library.db
    .all<AssetRow>(`SELECT ${cols} FROM assets a WHERE a.id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)])
    .map(toSummary)
}

function fullViewFor(mediaType: string, mime: string, rotation: number, edited: boolean): FullView {
  if (mediaType === 'video') return 'video'
  if (rotation || edited) return 'preview' // rotation and edits live in the generated preview, not in the original
  // Anything Chromium cannot decode (HEIC, TIFF, RAW) is shown via a generated preview.
  return isBrowserDisplayable(mime) ? 'original' : 'preview'
}

function exposureFrom(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const t = raw.ExposureTime
  if (typeof t === 'number' && t > 0) out.Shutter = t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`
  if (typeof raw.FNumber === 'number') out.Aperture = `ƒ/${Math.round(raw.FNumber * 10) / 10}`
  if (typeof raw.ISO === 'number') out.ISO = String(raw.ISO)
  if (typeof raw.FocalLength === 'number') out['Focal length'] = `${Math.round(raw.FocalLength * 10) / 10} mm`
  if (typeof raw.Software === 'string') out.Software = raw.Software
  return out
}

interface ProvRow {
  id: number
  asset_id: number
  source_type: string
  source_root: string
  source_path: string
  original_filename: string
  size_bytes: number
  fs_created_at: string | null
  fs_modified_at: string | null
  first_import_id: number
  first_seen_at: string
  last_seen_at: string
  times_seen: number
  container_path: string | null
  sidecar_path: string | null
  album: string | null
}

function toProvenance(p: ProvRow): ProvenanceInfo {
  return {
    id: p.id,
    sourceType: p.source_type,
    sourceRoot: p.source_root,
    sourcePath: p.source_path,
    originalFilename: p.original_filename,
    sizeBytes: p.size_bytes,
    fsCreatedAt: p.fs_created_at,
    fsModifiedAt: p.fs_modified_at,
    firstImportId: p.first_import_id,
    firstSeenAt: p.first_seen_at,
    lastSeenAt: p.last_seen_at,
    timesSeen: p.times_seen,
    containerPath: p.container_path,
    sidecarPath: p.sidecar_path,
    album: p.album
  }
}

function parseList(json: string | null): string[] {
  try {
    const v = json ? (JSON.parse(json) as unknown) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function assetDetail(library: Library, id: number): AssetDetail | null {
  const db = library.db
  const r = db.get<AssetRow & { live_video_id: number | null }>(`SELECT a.*, ${LIVE_COL} FROM assets a WHERE a.id = ?`, [id])
  if (!r) return null
  const files = db.all<{ id: number; relative_path: string; size_bytes: number; verified_at: string | null; name: string; root_path: string | null }>(
    `SELECT f.id, f.relative_path, f.size_bytes, f.verified_at, s.name, s.root_path
       FROM files f JOIN storage_locations s ON s.id = f.storage_location_id WHERE f.asset_id = ? ORDER BY f.id`,
    [id]
  )
  const sources = db.all<ProvRow>('SELECT * FROM provenance WHERE asset_id = ? ORDER BY first_seen_at, id', [id])
  let raw: Record<string, unknown> = {}
  try {
    raw = r.metadata_json ? (JSON.parse(r.metadata_json) as Record<string, unknown>) : {}
  } catch {
    raw = {}
  }
  return {
    ...toSummary(r),
    sha256: r.sha256,
    sizeBytes: r.size_bytes,
    originalFilename: r.original_filename,
    captureTime: r.capture_time,
    captureOffsetMinutes: r.capture_offset_minutes,
    captureTimeSource: r.capture_time_source as CaptureTimeSource | null,
    sortTimeSource: r.sort_time_source as SortTimeSource,
    latitude: r.latitude,
    longitude: r.longitude,
    altitude: r.altitude,
    cameraMake: r.camera_make,
    cameraModel: r.camera_model,
    lensModel: r.lens_model,
    orientation: r.orientation,
    importedAt: r.created_at,
    description: r.description,
    fullView: fullViewFor(r.media_type, r.mime_type, r.rotation ?? 0, !!r.edits),
    edits: r.edits ? (JSON.parse(r.edits) as PhotoEdits) : null,
    people: peopleOfAsset(library, id),
    tags: tagsOf(library, id),
    originalVersionId: db.get<{ id: number }>('SELECT id FROM assets WHERE version_of = ? LIMIT 1', [id])?.id ?? null,
    autoCaption: db.get<{ caption: string | null }>('SELECT caption FROM asset_captions WHERE asset_id = ?', [id])?.caption ?? null,
    locationSource: (r as { location_source?: string | null }).location_source ?? null,
    place:
      (r as { place?: string | null }).place ||
      (r.latitude !== null && r.longitude !== null ? placeLabel(r.latitude, r.longitude) : null),
    exposure: exposureFrom(raw),
    albums: albumsOfAsset(library, id),
    backups: db
      .all<{ path: string; relative_path: string; status: string; verified_at: string | null }>(
        `SELECT t.path, b.relative_path, b.status, b.verified_at FROM backup_files b JOIN backup_targets t ON t.id = b.target_id
           JOIN files f ON f.id = b.file_id WHERE f.asset_id = ? ORDER BY t.id`,
        [id]
      )
      .map((b) => ({ path: join(b.path, ...b.relative_path.split('/')), status: b.status, verifiedAt: b.verified_at })),
    origin: r.origin,
    originConfidence: r.origin_confidence,
    dateEvidence: parseList(r.date_evidence),
    originEvidence: parseList(r.origin_evidence),
    kindEvidence: parseList(r.kind_evidence),
    hasAudio: r.has_audio === null ? null : r.has_audio === 1,
    files: files.map((f) => ({
      id: f.id,
      locationName: f.name,
      relativePath: f.relative_path,
      absolutePath: f.root_path === null ? join(library.root, ...f.relative_path.split('/')) : join(f.root_path, ...f.relative_path.split('/')),
      sizeBytes: f.size_bytes,
      verifiedAt: f.verified_at
    })),
    sources: sources.map(toProvenance)
  }
}

export function setFavorite(library: Library, id: number, favorite: boolean): void {
  library.db.run('UPDATE assets SET favorite = ?, updated_at = ? WHERE id = ?', [favorite ? 1 : 0, new Date().toISOString(), id])
}

export function thumbnailPath(library: Library, assetId: number, variant: 'thumb' | 'preview'): string | null {
  const row = library.db.get<{ relative_path: string }>('SELECT relative_path FROM asset_thumbnails WHERE asset_id = ? AND variant = ?', [assetId, variant])
  return row ? join(library.root, ...row.relative_path.split('/')) : null
}

export function listImports(library: Library, limit = 100): ImportSummary[] {
  const ids = library.db.all<{ id: number }>('SELECT id FROM imports ORDER BY id DESC LIMIT ?', [limit])
  return ids.map((r) => importSummary(library.db, r.id)).filter((s): s is ImportSummary => s !== null)
}

export function importItems(library: Library, importId: number, classification: ItemClassification | 'all', offset: number, limit: number): ImportItemInfo[] {
  const where = classification === 'all' ? '' : 'AND i.classification = ?'
  const params: (string | number)[] = [importId]
  if (classification !== 'all') params.push(classification)
  params.push(Math.min(Math.max(limit, 1), 500), Math.max(offset, 0))
  const rows = library.db.all<{
    id: number
    relative_path: string
    filename: string
    size_bytes: number
    media_type: 'photo' | 'video' | null
    classification: ItemClassification
    outcome: ImportItemInfo['outcome']
    sha256: string | null
    asset_id: number | null
    error: string | null
    match_filename: string | null
    match_path: string | null
  }>(
    `SELECT i.id, i.relative_path, i.filename, i.size_bytes, i.media_type, i.classification, i.outcome, i.sha256,
            COALESCE(i.asset_id, a.id) AS asset_id, i.error,
            a.original_filename AS match_filename,
            (SELECT f.relative_path FROM files f WHERE f.asset_id = a.id ORDER BY f.id LIMIT 1) AS match_path
       FROM import_items i LEFT JOIN assets a ON a.sha256 = i.sha256
      WHERE i.import_id = ? ${where}
      ORDER BY i.relative_path LIMIT ? OFFSET ?`,
    params
  )
  return rows.map((r) => ({
    id: r.id,
    relativePath: r.relative_path,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    mediaType: r.media_type,
    classification: r.classification,
    outcome: r.outcome,
    sha256: r.sha256,
    assetId: r.asset_id,
    error: r.error,
    matchFilename: r.match_filename,
    matchRelativePath: r.match_path
  }))
}

/** Assets observed in more than one place: exact (byte-identical) duplicates, with every source. */
export function duplicateGroups(library: Library, offset: number, limit: number): { total: number; groups: DuplicateGroup[] } {
  const db = library.db
  const total =
    db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM (SELECT p.asset_id FROM provenance p JOIN assets a ON a.id = p.asset_id WHERE a.trashed_at IS NULL GROUP BY p.asset_id HAVING COUNT(*) > 1)'
    )?.n ?? 0
  const rows = db.all<AssetRow & { sources: number }>(
    `SELECT a.*, p.n AS sources FROM (SELECT asset_id, COUNT(*) AS n FROM provenance GROUP BY asset_id HAVING COUNT(*) > 1) p
       JOIN assets a ON a.id = p.asset_id WHERE a.trashed_at IS NULL ORDER BY p.n DESC, a.sort_time DESC LIMIT ? OFFSET ?`,
    [Math.min(Math.max(limit, 1), 200), Math.max(offset, 0)]
  )
  const groups = rows.map((r) => ({
    asset: toSummary(r),
    sha256: r.sha256,
    originalFilename: r.original_filename,
    sizeBytes: r.size_bytes,
    sources: db.all<ProvRow>('SELECT * FROM provenance WHERE asset_id = ? ORDER BY first_seen_at, id', [r.id]).map(toProvenance)
  }))
  return { total, groups }
}
