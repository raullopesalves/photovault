import type { AssetOrigin, AssetSummary, NearDuplicateGroup, NearDuplicateMember, NearDuplicates } from '@shared/types'
import type { Library } from '../library/library'
import { colourDistance, hammingWords, hashWords } from '../media/phash'
import { wallToSortMs } from '../media/metadata'
import { assetSummaries } from './queries'

/**
 * "Similar photos": separate shots of the same moment — bursts and repeated takes — as opposed to copies of
 * one shot (probable duplicates). Members must have their own recorded capture time, follow each other
 * within a few seconds, and look alike (looser fingerprint limits than duplicates).
 */
export const SIMILAR = {
  maxPhash: 12,
  maxDhash: 14,
  maxColourDiff: 60,
  maxAspectDiff: 0.03,
  /** Max gap between consecutive shots, and max length of a whole series. */
  maxGapMs: 10_000,
  maxSeriesMs: 120_000
} as const

const RECORDED = new Set(['exif_original', 'exif_digitized', 'xmp', 'quicktime', 'takeout', 'icloud', 'manual'])

interface Row {
  id: number
  phash: string
  dhash: string
  color: string | null
  sharpness: number | null
  width: number | null
  height: number | null
  size_bytes: number
  capture_time: string
  t: number
}

function alike(a: Row, b: Row): boolean {
  if (hammingWords(hashWords(a.phash), hashWords(b.phash)) > SIMILAR.maxPhash) return false
  if (hammingWords(hashWords(a.dhash), hashWords(b.dhash)) > SIMILAR.maxDhash) return false
  if (colourDistance(a.color, b.color) > SIMILAR.maxColourDiff) return false
  if (a.width && a.height && b.width && b.height) {
    const ra = a.width / a.height
    const rb = b.width / b.height
    if (Math.abs(ra - rb) / Math.max(ra, rb) > SIMILAR.maxAspectDiff) return false
  }
  return true
}

const cache = new WeakMap<Library, { key: string; groups: number[][] }>()

export function findSimilarGroups(library: Library): number[][] {
  const db = library.db
  const key = JSON.stringify(
    db.get(
      `SELECT (SELECT COUNT(*) FROM asset_hashes) AS n, (SELECT MAX(created_at) FROM asset_hashes) AS t,
              (SELECT COUNT(*) FROM near_duplicate_dismissals) AS d, (SELECT COUNT(*) FROM assets WHERE trashed_at IS NULL) AS a`
    )
  )
  const cached = cache.get(library)
  if (cached && cached.key === key) return cached.groups

  const rows = db
    .all<Omit<Row, 't'> & { capture_time_source: string }>(
      `SELECT a.id, h.phash, h.dhash, h.color, h.sharpness, a.width, a.height, a.size_bytes, a.capture_time, a.capture_time_source
         FROM assets a JOIN asset_hashes h ON h.asset_id = a.id
        WHERE a.media_type = 'photo' AND a.trashed_at IS NULL AND a.live_photo_of IS NULL AND h.flat = 0
          AND h.phash IS NOT NULL AND a.capture_time IS NOT NULL`
    )
    .filter((r) => RECORDED.has(r.capture_time_source))
    .map((r) => ({ ...r, t: wallToSortMs(r.capture_time) }))
    .sort((a, b) => a.t - b.t || a.id - b.id)
  const dismissed = new Set(db.all<{ asset_a: number; asset_b: number }>('SELECT asset_a, asset_b FROM near_duplicate_dismissals').map((r) => `${r.asset_a}:${r.asset_b}`))
  const isDismissed = (a: number, b: number): boolean => dismissed.has(`${Math.min(a, b)}:${Math.max(a, b)}`)

  const groups: number[][] = []
  let current: Row[] = []
  const flush = (): void => {
    if (current.length > 1) groups.push(current.map((r) => r.id))
    current = []
  }
  for (const r of rows) {
    const last = current[current.length - 1]
    const first = current[0]
    if (
      last &&
      first &&
      r.t - last.t <= SIMILAR.maxGapMs &&
      r.t - first.t <= SIMILAR.maxSeriesMs &&
      r.capture_time !== last.capture_time && // copies of one shot share a time: those are duplicates, not similar
      (alike(r, last) || alike(r, first)) &&
      !current.some((m) => isDismissed(m.id, r.id))
    ) {
      current.push(r)
    } else {
      flush()
      current = [r]
    }
  }
  flush()
  cache.set(library, { key, groups })
  return groups
}

interface MemberRow {
  id: number
  size_bytes: number
  original_filename: string
  camera_make: string | null
  camera_model: string | null
  origin: AssetOrigin | null
  origin_confidence: 'certain' | 'probable' | null
  width: number | null
  height: number | null
  sharpness: number | null
  hidden: number
}

export function similarPhotos(library: Library, offset: number, limit: number): NearDuplicates {
  const db = library.db
  const groups = findSimilarGroups(library)
  const ids = groups.flat()
  const meta = new Map<number, MemberRow>()
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of db.all<MemberRow>(
      `SELECT a.id, a.size_bytes, a.original_filename, a.camera_make, a.camera_model, a.origin, a.origin_confidence, a.width, a.height, h.sharpness, a.hidden
         FROM assets a LEFT JOIN asset_hashes h ON h.asset_id = a.id WHERE a.id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(ids.slice(i, i + 500))]
    ))
      meta.set(r.id, r)
  }
  const visible = (g: number[]): number => g.filter((id) => meta.get(id)?.hidden !== 1).length
  const ordered = [...groups].sort((a, b) => Number(visible(a) <= 1) - Number(visible(b) <= 1) || b.length - a.length)
  const unresolved = ordered.filter((g) => visible(g) > 1)
  const page = ordered.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(Math.max(limit, 1), 100))
  const summaries = new Map<number, AssetSummary>(assetSummaries(library, page.flat()).map((s) => [s.id, s]))
  const out: NearDuplicateGroup[] = page.map((g) => {
    // Best shot: sharpest; then most pixels; then largest file.
    const rows = g
      .map((id) => meta.get(id))
      .filter((r): r is MemberRow => !!r)
      .sort(
        (a, b) =>
          (b.sharpness ?? 0) - (a.sharpness ?? 0) ||
          (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) ||
          b.size_bytes - a.size_bytes ||
          a.id - b.id
      )
    const best = rows[0] as MemberRow
    const sharpest = rows.length > 1 && (best.sharpness ?? 0) > (rows[1]?.sharpness ?? 0) * 1.05
    const members: NearDuplicateMember[] = rows.map((r) => ({
      asset: summaries.get(r.id) as AssetSummary,
      sizeBytes: r.size_bytes,
      originalFilename: r.original_filename,
      camera: r.camera_model ? [r.camera_make, r.camera_model].filter(Boolean).join(' ') : null,
      origin: r.origin,
      originConfidence: r.origin_confidence
    }))
    return {
      key: `s${g[0]}`,
      bestId: best.id,
      bestReason: sharpest ? 'sharpest shot' : 'all about equally sharp — keep any',
      resolved: visible(g) <= 1,
      members
    }
  })
  return {
    totalGroups: ordered.length,
    unresolvedGroups: unresolved.length,
    extraCopies: unresolved.reduce((s, g) => s + visible(g) - 1, 0),
    hashed: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM asset_hashes WHERE sharpness IS NOT NULL')?.n ?? 0,
    hashable: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM asset_thumbnails WHERE variant = 'thumb'")?.n ?? 0,
    groups: out
  }
}
