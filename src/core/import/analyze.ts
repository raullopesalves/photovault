import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import type { ImportSummary } from '@shared/types'
import type { Database } from '../db/database'
import { sniffBuffer, sniffFile, classifyByExtension } from '../media/formats'
import { sha256File } from '../media/hash'
import { emptyMetadata, extractMetadata, type ExtractedMetadata } from '../media/metadata'
import { parseICloudDetails, parseXmpSidecar, type ICloudRecord, type XmpSidecar } from '../sources/sidecars'
import { MoovCollector } from '../media/video'
import type { ZipPool } from '../sources/zip'
import { SidecarIndex } from '../takeout/match'
import { looksLikeTakeoutPath, parseTakeoutAlbum, parseTakeoutSidecar, type TakeoutSidecar } from '../takeout/sidecar'
import { errorMessage, isoOrNull, mapPool } from '../util'
import type { MediaCandidate, ScanProblem, SourceRef } from './scan'

export interface AnalyzeProgress {
  analyzed: number
  total: number
  bytes: number
  hashesReused: number
  sidecarsMatched: number
  currentFile: string | null
}

export interface SidecarValue {
  path: string
  json: string
  parsed: TakeoutSidecar
}

export interface SidecarCatalog {
  index: SidecarIndex<SidecarValue>
  /** Takeout album folder (path inside the export) -> album title. */
  albums: Map<string, string>
  /** XMP sidecars by "<dir>\u0000<file name without .xmp, lower case>". */
  xmp?: Map<string, { path: string; data: XmpSidecar }>
  /** iCloud "Photo Details.csv" rows by "<dir>\u0000<image name, lower case>". */
  icloud?: Map<string, { path: string; record: ICloudRecord }>
}

export type SourceType = 'LOCAL_FOLDER' | 'ZIP' | 'GOOGLE_TAKEOUT' | 'ICLOUD_EXPORT'

interface ItemRow {
  import_id: number
  source_path: string
  source_root: string
  source_type: SourceType
  container_path: string | null
  entry_name: string | null
  relative_path: string
  filename: string
  size_bytes: number
  fs_created_at: string | null
  fs_modified_at: string | null
  source_fingerprint: string | null
  media_type: string | null
  mime_type: string | null
  sha256: string | null
  hash_reused: number
  classification: 'pending' | 'unsupported' | 'error'
  metadata_json: string | null
  sidecar_path: string | null
  sidecar_json: string | null
  album: string | null
  error: string | null
}

const INSERT_ITEM = `
  INSERT INTO import_items (import_id, source_path, source_root, source_type, container_path, entry_name, relative_path, filename,
                            size_bytes, fs_created_at, fs_modified_at, source_fingerprint, media_type, mime_type, sha256, hash_reused,
                            classification, metadata_json, sidecar_path, sidecar_json, album, error)
  VALUES (:import_id, :source_path, :source_root, :source_type, :container_path, :entry_name, :relative_path, :filename,
          :size_bytes, :fs_created_at, :fs_modified_at, :source_fingerprint, :media_type, :mime_type, :sha256, :hash_reused,
          :classification, :metadata_json, :sidecar_path, :sidecar_json, :album, :error)
  ON CONFLICT (import_id, source_path) DO NOTHING`

/** Entries up to this size are buffered whole while hashing, so metadata extraction sees the complete file. */
const FULL_BUFFER_LIMIT = 48 * 1024 * 1024
const HEAD_BYTES = 4 * 1024 * 1024
const SIDECAR_LIMIT = 2 * 1024 * 1024

/** Reads every JSON sidecar once and indexes Google Takeout photo metadata and album titles. */
export async function readSidecars(opts: {
  sidecars: SourceRef[]
  zips: ZipPool
  signal?: AbortSignal
  onProgress?: (read: number, total: number) => void
}): Promise<SidecarCatalog> {
  const index = new SidecarIndex<SidecarValue>()
  const albums = new Map<string, string>()
  const xmp = new Map<string, { path: string; data: XmpSidecar }>()
  const icloud = new Map<string, { path: string; record: ICloudRecord }>()
  const readText = async (s: SourceRef): Promise<string | null> => {
    if (s.containerPath && s.entryName) return (await (await opts.zips.get(s.containerPath)).readEntry(s.entryName, SIDECAR_LIMIT * 16)).toString('utf8')
    const st = await stat(s.path)
    if (st.size > SIDECAR_LIMIT * 16) return null
    return (await readFile(s.path)).toString('utf8')
  }
  // XMP sidecars (Lightroom, darktable, …) and iCloud export details: small, read up front.
  for (const s of opts.sidecars) {
    const lower = s.name.toLowerCase()
    try {
      if (lower.endsWith('.xmp')) {
        const text = await readText(s)
        if (text) xmp.set(`${s.dir}\u0000${lower.slice(0, -4)}`, { path: s.path, data: parseXmpSidecar(text) })
      } else if (lower.endsWith('.csv') && lower.startsWith('photo details')) {
        const text = await readText(s)
        if (text) for (const [name, record] of parseICloudDetails(text)) icloud.set(`${s.dir}\u0000${name}`, { path: s.path, record })
      }
    } catch {
      // unreadable sidecar: the media is still imported
    }
  }
  const jsons = opts.sidecars.filter((s) => s.name.toLowerCase().endsWith('.json'))
  let read = 0
  await mapPool(
    jsons,
    4,
    async (s) => {
      try {
        let buf: Buffer
        if (s.containerPath && s.entryName) {
          buf = await (await opts.zips.get(s.containerPath)).readEntry(s.entryName, SIDECAR_LIMIT)
        } else {
          const st = await stat(s.path)
          if (st.size > SIDECAR_LIMIT) return
          buf = await readFile(s.path)
        }
        const text = buf.toString('utf8').replace(/^﻿/, '')
        const json: unknown = JSON.parse(text)
        const sidecar = parseTakeoutSidecar(json)
        if (sidecar) {
          index.add(s.dir, s.name, sidecar.title, { path: s.path, json: text, parsed: sidecar })
        } else {
          const album = parseTakeoutAlbum(json)
          if (album) albums.set(s.dir, album.title)
        }
      } catch {
        // Unreadable or non-JSON sidecar: ignore, the media is still imported.
      } finally {
        read++
        if (read % 50 === 0 || read === jsons.length) opts.onProgress?.(read, jsons.length)
      }
    },
    opts.signal
  )
  return { index, albums, xmp, icloud }
}

interface Digest {
  sha256: string
  /** Whole entry (small files) or its first bytes. */
  head: Buffer
  full: boolean
  moov: Buffer | null
}

/** One pass over a stream: SHA-256 plus whatever bytes metadata extraction needs. */
function digestStream(stream: Readable, size: number, signal?: AbortSignal): Promise<Digest> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const keepAll = size <= FULL_BUFFER_LIMIT
    const chunks: Buffer[] = []
    let kept = 0
    const moov = new MoovCollector()
    const onAbort = (): void => {
      stream.destroy(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      if (keepAll || kept < HEAD_BYTES) {
        chunks.push(chunk)
        kept += chunk.length
      }
      if (!keepAll) moov.push(chunk)
    })
    stream.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    stream.on('end', () => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ sha256: hash.digest('hex'), head: Buffer.concat(chunks), full: keepAll, moov: moov.moov })
    })
  })
}

function sourceTypeOf(ref: SourceRef, sidecarMatched: boolean): SourceType {
  if (sidecarMatched || looksLikeTakeoutPath(ref.relativePath)) return 'GOOGLE_TAKEOUT'
  return ref.containerPath ? 'ZIP' : 'LOCAL_FOLDER'
}

function baseRow(importId: number, ref: SourceRef): ItemRow {
  const cls = classifyByExtension(ref.name)
  return {
    import_id: importId,
    source_path: ref.path,
    source_root: ref.root,
    source_type: ref.containerPath ? 'ZIP' : 'LOCAL_FOLDER',
    container_path: ref.containerPath,
    entry_name: ref.entryName,
    relative_path: ref.relativePath,
    filename: ref.name,
    size_bytes: ref.size ?? 0,
    fs_created_at: null,
    fs_modified_at: isoOrNull(ref.mtime),
    source_fingerprint: ref.fingerprint,
    media_type: cls.kind === 'media' ? cls.format.mediaType : null,
    mime_type: cls.kind === 'media' ? cls.format.mime : null,
    sha256: null,
    hash_reused: 0,
    classification: 'pending',
    metadata_json: null,
    sidecar_path: null,
    sidecar_json: null,
    album: null,
    error: null
  }
}

interface PreviousObservation {
  sha256: string
  media_type: string
  mime_type: string
  metadata_json: string | null
}

/** Applies sidecars that travel next to the file: iCloud export details and XMP. */
async function analyzeOne(db: Database, importId: number, c: MediaCandidate, zips: ZipPool, catalog: SidecarCatalog, signal?: AbortSignal): Promise<ItemRow> {
  const row = await analyzeFile(db, importId, c, zips, catalog, signal)
  if (row.classification !== 'pending') return row

  const icloud = catalog.icloud?.get(`${c.dir}\u0000${c.name.toLowerCase()}`)
  if (icloud && !row.sidecar_json) {
    row.sidecar_path = icloud.path
    row.sidecar_json = JSON.stringify({ icloud: icloud.record })
    row.source_type = 'ICLOUD_EXPORT'
  } else if (!row.sidecar_json && /(^|\/)iCloud Photos(\/|$)/i.test(c.relativePath)) {
    row.source_type = 'ICLOUD_EXPORT'
  }

  const lower = c.name.toLowerCase()
  const stem = lower.includes('.') ? lower.slice(0, lower.lastIndexOf('.')) : lower
  const x = catalog.xmp?.get(`${c.dir}\u0000${lower}`) ?? catalog.xmp?.get(`${c.dir}\u0000${stem}`)
  if (x && row.metadata_json) {
    try {
      const meta = { ...emptyMetadata(), ...(JSON.parse(row.metadata_json) as Partial<ExtractedMetadata>) }
      const cameraDate = meta.captureTimeSource === 'exif_original' || meta.captureTimeSource === 'exif_digitized' || meta.captureTimeSource === 'xmp'
      if (x.data.dateTaken && !cameraDate) {
        meta.captureTime = x.data.dateTaken
        meta.captureOffsetMinutes = null
        meta.captureTimeSource = 'xmp'
      }
      if (meta.latitude === null && x.data.latitude !== null) {
        meta.latitude = x.data.latitude
        meta.longitude = x.data.longitude
      }
      meta.raw = { ...meta.raw, XmpSidecar: x.path, ...(x.data.rating ? { XmpRating: x.data.rating } : {}), ...(x.data.description ? { XmpDescription: x.data.description.slice(0, 256) } : {}) }
      row.metadata_json = JSON.stringify(meta)
    } catch {
      // keep the file's own metadata
    }
  }
  return row
}

async function analyzeFile(db: Database, importId: number, c: MediaCandidate, zips: ZipPool, catalog: SidecarCatalog, signal?: AbortSignal): Promise<ItemRow> {
  const row = baseRow(importId, c)
  const sidecar = catalog.index.match(c.dir, c.name)
  if (sidecar) {
    row.sidecar_path = sidecar.value.path
    row.sidecar_json = sidecar.value.json
  }
  row.source_type = sourceTypeOf(c, sidecar !== null)
  if (row.source_type === 'GOOGLE_TAKEOUT') row.album = catalog.albums.get(c.dir) ?? null

  try {
    if (!c.containerPath) {
      const st = await stat(c.path)
      row.size_bytes = st.size
      // Recorded for provenance only – filesystem times are NOT capture time.
      row.fs_created_at = isoOrNull(st.birthtime)
      row.fs_modified_at = isoOrNull(st.mtime)
      row.source_fingerprint = `f:${st.size}:${Math.round(st.mtimeMs)}`
    }
    if (row.size_bytes === 0) {
      row.classification = 'unsupported'
      row.error = 'Empty file'
      return row
    }

    // Unchanged since an earlier import (same path, same size/mtime or CRC)? Reuse that SHA-256 instead of re-reading.
    const prev = db.get<PreviousObservation>(
      `SELECT sha256, media_type, mime_type, metadata_json FROM import_items
        WHERE source_path = ? AND source_fingerprint = ? AND sha256 IS NOT NULL
          AND classification IN ('new', 'duplicate_library', 'duplicate_batch')
        ORDER BY id DESC LIMIT 1`,
      [c.path, row.source_fingerprint]
    )
    if (prev) {
      row.sha256 = prev.sha256
      row.media_type = prev.media_type
      row.mime_type = prev.mime_type
      row.metadata_json = prev.metadata_json
      row.hash_reused = 1
      return row
    }

    if (!c.containerPath) {
      // Do not trust extensions: the content decides what the file is.
      const sniffed = await sniffFile(c.path)
      if (!sniffed) {
        row.classification = 'unsupported'
        row.error = 'File content is not a recognised photo or video format'
        return row
      }
      row.media_type = sniffed.mediaType
      row.mime_type = sniffed.mime
      row.sha256 = await sha256File(c.path, signal)
      row.metadata_json = JSON.stringify(await extractMetadata({ path: c.path }, c.name, sniffed.mediaType, sniffed.mime))
    } else {
      const archive = await zips.get(c.containerPath)
      const digest = await digestStream(await archive.openEntry(c.entryName as string), row.size_bytes, signal)
      const sniffed = sniffBuffer(digest.head.subarray(0, 64), c.name)
      if (!sniffed) {
        row.classification = 'unsupported'
        row.error = 'File content is not a recognised photo or video format'
        return row
      }
      row.media_type = sniffed.mediaType
      row.mime_type = sniffed.mime
      row.sha256 = digest.sha256
      row.metadata_json = JSON.stringify(
        await extractMetadata({ buffer: digest.head, moov: digest.full ? null : digest.moov }, c.name, sniffed.mediaType, sniffed.mime)
      )
    }
  } catch (err) {
    if (signal?.aborted) throw err
    row.classification = 'error'
    row.error = errorMessage(err)
  }
  return row
}

/**
 * Hashes and extracts metadata for every candidate, pairs it with its export sidecar and persists
 * import_items in batches. Sources are only ever read.
 */
export async function analyzeCandidates(opts: {
  db: Database
  importId: number
  candidates: MediaCandidate[]
  problems?: ScanProblem[]
  catalog: SidecarCatalog
  zips: ZipPool
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (p: AnalyzeProgress) => void
}): Promise<{ hashesReused: number; sidecarsMatched: number }> {
  const { db, importId, candidates } = opts
  const batch: ItemRow[] = []
  let analyzed = 0
  let bytes = 0
  let hashesReused = 0
  let sidecarsMatched = 0
  const flush = (): void => {
    if (batch.length === 0) return
    const rows = batch.splice(0, batch.length)
    db.tx(() => {
      for (const r of rows) db.run(INSERT_ITEM, { ...r })
    })
  }
  for (const p of opts.problems ?? []) {
    batch.push({ ...baseRow(importId, p), classification: 'error', error: p.error })
  }
  await mapPool(
    candidates,
    opts.concurrency ?? 4,
    async (c) => {
      const row = await analyzeOne(db, importId, c, opts.zips, opts.catalog, opts.signal)
      batch.push(row)
      analyzed++
      bytes += row.size_bytes
      hashesReused += row.hash_reused
      if (row.sidecar_json) sidecarsMatched++
      if (batch.length >= 200) flush()
      opts.onProgress?.({ analyzed, total: candidates.length, bytes, hashesReused, sidecarsMatched, currentFile: c.relativePath })
    },
    opts.signal
  )
  flush()
  return { hashesReused, sidecarsMatched }
}

/**
 * Classifies hashed items. SHA-256 is the only identity:
 *   - hash already in the library        -> duplicate_library
 *   - first occurrence (by path) of hash -> new
 *   - further occurrences in this source -> duplicate_batch
 * Deterministic: the same source always yields the same classification.
 */
export function classifyItems(db: Database, importId: number): void {
  db.tx(() => {
    // Content the user permanently deleted is not imported again (it can be allowed in Settings).
    db.run(
      `UPDATE import_items SET classification = 'deleted_before'
        WHERE import_id = ? AND classification = 'pending' AND sha256 IN (SELECT sha256 FROM deleted_assets)`,
      [importId]
    )
    db.run(
      `UPDATE import_items
         SET classification = 'duplicate_library',
             asset_id = (SELECT a.id FROM assets a WHERE a.sha256 = import_items.sha256)
       WHERE import_id = ? AND classification = 'pending'
         AND sha256 IN (SELECT sha256 FROM assets)`,
      [importId]
    )
    db.run(
      `UPDATE import_items
         SET classification = CASE WHEN r.rn = 1 THEN 'new' ELSE 'duplicate_batch' END
        FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY sha256 ORDER BY source_root, relative_path, id) AS rn
                FROM import_items WHERE import_id = ? AND classification = 'pending') AS r
       WHERE import_items.id = r.id`,
      [importId]
    )
  })
}

interface ImportRow {
  id: number
  source_type: string
  source_path: string
  trigger: string
  sources_json: string | null
  status: string
  started_at: string
  analyzed_at: string | null
  completed_at: string | null
  files_scanned: number
  photos_found: number
  videos_found: number
  sidecars_found: number
  ignored_found: number
  archives_found: number
  sidecars_matched: number
  hashes_reused: number
  assets_created: number
  files_failed: number
}

export function importSources(imp: { sources_json: string | null; source_path: string }): string[] {
  try {
    const parsed = imp.sources_json ? (JSON.parse(imp.sources_json) as unknown) : null
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') && parsed.length > 0) return parsed as string[]
  } catch {
    // fall through
  }
  return [imp.source_path]
}

export function importSummary(db: Database, importId: number): ImportSummary | null {
  const imp = db.get<ImportRow>('SELECT * FROM imports WHERE id = ?', [importId])
  if (!imp) return null
  const groups = db.all<{ classification: string; media_type: string | null; n: number; bytes: number | null; pending: number }>(
    `SELECT classification, media_type, COUNT(*) AS n, SUM(size_bytes) AS bytes, SUM(outcome IS NULL) AS pending
       FROM import_items WHERE import_id = ? GROUP BY classification, media_type`,
    [importId]
  )
  const takeout = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM import_items WHERE import_id = ? AND source_type = 'GOOGLE_TAKEOUT'", [importId])?.n ?? 0
  const s: ImportSummary = {
    importId: imp.id,
    trigger: imp.trigger === 'watch' ? 'watch' : 'user',
    sourceType: imp.source_type,
    sourcePath: imp.source_path,
    sources: importSources(imp),
    status: imp.status,
    startedAt: imp.started_at,
    completedAt: imp.completed_at,
    filesScanned: imp.files_scanned,
    photosFound: imp.photos_found,
    videosFound: imp.videos_found,
    sidecarsFound: imp.sidecars_found,
    ignoredFound: imp.ignored_found,
    archivesFound: imp.archives_found,
    sidecarsMatched: imp.sidecars_matched,
    hashesReused: imp.hashes_reused,
    takeoutItems: takeout,
    newAssets: 0,
    newPhotos: 0,
    newVideos: 0,
    duplicatesLibrary: 0,
    duplicatesBatch: 0,
    deletedBefore: 0,
    unsupported: 0,
    errors: 0,
    bytesNew: 0,
    bytesDuplicate: 0,
    assetsCreated: imp.assets_created,
    filesFailed: imp.files_failed,
    resumable: false
  }
  let pending = 0
  for (const g of groups) {
    const bytes = g.bytes ?? 0
    switch (g.classification) {
      case 'new':
        s.newAssets += g.n
        s.bytesNew += bytes
        pending += g.pending
        if (g.media_type === 'video') s.newVideos += g.n
        else s.newPhotos += g.n
        break
      case 'duplicate_library':
        s.duplicatesLibrary += g.n
        s.bytesDuplicate += bytes
        pending += g.pending
        break
      case 'duplicate_batch':
        s.duplicatesBatch += g.n
        s.bytesDuplicate += bytes
        pending += g.pending
        break
      case 'deleted_before':
        s.deletedBefore += g.n
        break
      case 'unsupported':
        s.unsupported += g.n
        break
      case 'error':
        s.errors += g.n
        break
    }
  }
  // An analysed import that stopped before every item was handled can be picked up again.
  s.resumable = imp.status === 'interrupted' && imp.analyzed_at !== null && pending > 0
  return s
}
