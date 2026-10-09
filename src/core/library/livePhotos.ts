import { posix } from 'node:path'
import type { Library } from './library'

const PHOTO_MIME = new Set(['image/heic', 'image/heif', 'image/jpeg'])
const VIDEO_MIME = new Set(['video/quicktime', 'video/mp4'])
/** Live Photo motion clips are ~1.5–3 s; allow a little slack. */
const MAX_LIVE_MS = 4000
const MAX_TIME_GAP_MS = 3000

/**
 * Pairs Apple Live Photos: a still (IMG_1234.HEIC/JPG) and its short motion clip (IMG_1234.MOV, or .MP4 in
 * Google Takeout) seen in the same folder of the same source. The clip is linked to the photo
 * (assets.live_photo_of) instead of appearing as a separate video; both stay ordinary files in the library.
 * When both have capture times they must agree within a few seconds. Idempotent.
 */
export function linkLivePhotos(library: Library): number {
  const db = library.db
  type Row = { asset_id: number; source_root: string; relative_path: string; mime_type: string; media_type: string; duration_ms: number | null; capture_time: string | null }
  const rows = db.all<Row>(
    `SELECT p.asset_id, p.source_root, p.relative_path, a.mime_type, a.media_type, a.duration_ms, a.capture_time
       FROM provenance p JOIN assets a ON a.id = p.asset_id
      WHERE a.live_photo_of IS NULL AND a.trashed_at IS NULL
        AND (a.media_type = 'photo' OR (a.media_type = 'video' AND (a.duration_ms IS NULL OR a.duration_ms <= ?)))`,
    [MAX_LIVE_MS]
  )
  const key = (r: Row): string => {
    const rel = r.relative_path.replace(/\\/g, '/')
    const dir = posix.dirname(rel)
    const base = posix.basename(rel)
    const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
    return `${r.source_root}\u0000${dir}\u0000${stem.toLowerCase()}`
  }
  const photos = new Map<string, Row>()
  for (const r of rows) if (r.media_type === 'photo' && PHOTO_MIME.has(r.mime_type)) photos.set(key(r), r)
  let linked = 0
  const now = new Date().toISOString()
  db.tx(() => {
    for (const v of rows) {
      if (v.media_type !== 'video' || !VIDEO_MIME.has(v.mime_type)) continue
      const p = photos.get(key(v))
      if (!p || p.asset_id === v.asset_id) continue
      if (p.capture_time && v.capture_time && Math.abs(Date.parse(`${p.capture_time.slice(0, 19)}Z`) - Date.parse(`${v.capture_time.slice(0, 19)}Z`)) > MAX_TIME_GAP_MS) continue
      linked += db.run('UPDATE assets SET live_photo_of = ?, updated_at = ? WHERE id = ? AND live_photo_of IS NULL', [p.asset_id, now, v.asset_id]).changes
    }
  })
  if (linked) library.logger.info('live_photos.linked', { linked })
  return linked
}
