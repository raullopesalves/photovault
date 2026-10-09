import { join, posix } from 'node:path'
import { classifyAsset, CLASSIFY_VERSION, deviceFoldersFromSidecar } from '../media/classify'
import sharp from '../media/sharp'
import { readVideoInfo } from '../media/video'
import { errorMessage } from '../util'
import type { Library } from './library'

interface AssetRow {
  id: number
  media_type: 'photo' | 'video'
  mime_type: string
  width: number | null
  height: number | null
  duration_ms: number | null
  has_audio: number | null
  frames: number | null
  camera_make: string | null
  camera_model: string | null
  metadata_json: string | null
  original_filename: string
}

const ANIMATABLE = new Set(['image/gif', 'image/webp'])

/**
 * Labels assets with origin and kind (see media/classify.ts). Runs in the background after imports and,
 * when the rules change (CLASSIFY_VERSION), re-labels the existing library. Reads managed originals
 * only when information is missing (e.g. sound-track detection for videos imported before it existed).
 */
export class ClassifyQueue {
  private running = false
  private stopped = false

  constructor(
    private readonly library: Library,
    private readonly opts: { onUpdated?: (assetIds: number[]) => void } = {}
  ) {}

  kick(): void {
    if (this.running || this.stopped) return
    this.running = true
    void this.loop().finally(() => {
      this.running = false
    })
  }

  stop(): void {
    this.stopped = true
  }

  async drain(): Promise<void> {
    this.kick()
    while (this.running) await new Promise((r) => setTimeout(r, 20))
  }

  private async loop(): Promise<void> {
    const db = this.library.db
    while (!this.stopped) {
      const rows = db.all<AssetRow>(
        `SELECT id, media_type, mime_type, width, height, duration_ms, has_audio, frames, camera_make, camera_model, metadata_json, original_filename
           FROM assets WHERE classify_version < ? ORDER BY id LIMIT 100`,
        [CLASSIFY_VERSION]
      )
      if (rows.length === 0) return
      const updated: number[] = []
      for (const row of rows) {
        if (this.stopped) return
        try {
          await this.classifyOne(row)
        } catch (err) {
          this.library.logger.warn('classify.failed', { assetId: row.id, error: errorMessage(err) })
          db.run('UPDATE assets SET classify_version = ? WHERE id = ?', [CLASSIFY_VERSION, row.id])
        }
        updated.push(row.id)
      }
      this.opts.onUpdated?.(updated)
      await new Promise((r) => setImmediate(r))
    }
  }

  private managedPath(assetId: number): string | null {
    const f = this.library.db.get<{ relative_path: string }>('SELECT relative_path FROM files WHERE asset_id = ? AND storage_location_id = ? ORDER BY id LIMIT 1', [
      assetId,
      this.library.managedLocationId
    ])
    return f ? join(this.library.root, ...f.relative_path.split('/')) : null
  }

  private async classifyOne(row: AssetRow): Promise<void> {
    const db = this.library.db
    let hasAudio = row.has_audio === null ? null : row.has_audio === 1
    let frames = row.frames
    let duration = row.duration_ms
    let raw: Record<string, unknown> = {}
    try {
      raw = row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {}
    } catch {
      raw = {}
    }

    // Fill gaps for items imported before these facts were extracted.
    if (row.media_type === 'video' && hasAudio === null) {
      const path = this.managedPath(row.id)
      const info = path ? await readVideoInfo(path) : null
      if (info) {
        hasAudio = info.hasAudio
        duration = duration ?? info.durationMs
        for (const [k, v] of Object.entries(info.tags)) raw[`Video${k[0]?.toUpperCase()}${k.slice(1)}`] = v
        if (info.createdUtcMs !== null) raw.QuickTimeCreationUtc = new Date(info.createdUtcMs).toISOString()
      }
    }
    if (row.media_type === 'photo' && frames === null && ANIMATABLE.has(row.mime_type)) {
      const path = this.managedPath(row.id)
      if (path) {
        try {
          frames = (await sharp(path, { failOn: 'none' }).metadata()).pages ?? 1
        } catch {
          frames = 1
        }
      }
    }

    const prov = db.all<{ original_filename: string; relative_path: string; sidecar_json: string | null }>(
      'SELECT original_filename, relative_path, sidecar_json FROM provenance WHERE asset_id = ?',
      [row.id]
    )
    const deviceFolders: string[] = []
    let shared = false
    for (const p of prov) {
      if (!p.sidecar_json) continue
      try {
        const r = deviceFoldersFromSidecar(JSON.parse(p.sidecar_json))
        deviceFolders.push(...r.folders)
        shared = shared || r.shared
      } catch {
        // ignore malformed sidecar
      }
    }
    // "Stripped": not a single capture-related tag survived (the raw tag subset is empty of them).
    // (A lone ModifyDate doesn't count: chat apps and editors leave one behind without any capture data.)
    const CAPTURE_KEYS =
      row.media_type === 'photo'
        ? ['Make', 'Model', 'DateTimeOriginal', 'CreateDate', 'Software', 'ExposureTime', 'FNumber', 'ISO', 'GPSLatitude', 'DateCreated']
        : ['QuickTimeCreationUtc', 'VideoMake', 'VideoModel']
    const metadataStripped = !row.camera_model && !row.camera_make && !CAPTURE_KEYS.some((k) => raw[k] !== undefined)
    const tags: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && (k === 'Software' || k.startsWith('Video'))) tags[k] = v

    const c = classifyAsset({
      mediaType: row.media_type,
      mime: row.mime_type,
      width: row.width,
      height: row.height,
      durationMs: duration,
      hasAudio,
      frames,
      cameraMake: row.camera_make,
      cameraModel: row.camera_model,
      tags,
      filenames: [...new Set([row.original_filename, ...prov.map((p) => p.original_filename)])],
      folders: [...new Set(prov.map((p) => posix.dirname(p.relative_path.replace(/\\/g, '/'))).filter((d) => d !== '.'))],
      deviceFolders: [...new Set(deviceFolders)],
      sharedWithMe: shared,
      metadataStripped
    })
    db.run(
      `UPDATE assets SET origin = ?, origin_confidence = ?, origin_hint = ?, origin_evidence = ?, kind = ?, kind_evidence = ?, has_audio = ?, frames = ?,
              duration_ms = ?, metadata_json = ?, classify_version = ?, updated_at = ? WHERE id = ?`,
      [
        c.origin,
        c.originConfidence,
        c.originHint,
        JSON.stringify(c.originEvidence),
        c.kind,
        JSON.stringify(c.kindEvidence),
        hasAudio === null ? null : hasAudio ? 1 : 0,
        frames,
        duration,
        JSON.stringify(raw),
        CLASSIFY_VERSION,
        new Date().toISOString(),
        row.id
      ]
    )
  }
}
