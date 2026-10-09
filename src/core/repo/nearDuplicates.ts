import type { AssetOrigin, AssetSummary, NearDuplicateGroup, NearDuplicateMember, NearDuplicates } from '@shared/types'
import type { Library } from '../library/library'
import type { Database } from '../db/database'
import { colourDistance, hammingWords, hashWords } from '../media/phash'
import { assetSummaries } from './queries'

/**
 * Thresholds, calibrated on re-encoded / resized / recompressed / slightly cropped copies versus burst shots
 * and different scenes (see tests/nearDuplicates.test.ts): copies stay ≤ 3 (dHash) / ≤ 4 (pHash);
 * a burst shot with a 40 px camera move is 5–7 / 6–8 depending on the copy; different scenes are ≥ 18.
 */
export const NEAR_DUPLICATE = {
  maxPhash: 5,
  maxDhash: 6,
  /** Relative aspect-ratio difference allowed (crops and different shots usually differ more). */
  maxAspectDiff: 0.03,
  /** Largest allowed per-channel difference of the quadrant colours (recompression/resizing stay < 10). */
  maxColourDiff: 40,
  /** Videos must also have (almost) the same length. */
  maxDurationDiffMs: 1000
} as const

interface HashRow {
  asset_id: number
  dhash: string
  phash: string
  color: string | null
  capture_time_source: string | null
  media_type: 'photo' | 'video'
  width: number | null
  height: number | null
  duration_ms: number | null
  camera_model: string | null
  size_bytes: number
  capture_time: string | null
}

type Words = { p: [number, number]; d: [number, number] }
const wordsCache = new WeakMap<HashRow, Words>()
function words(r: HashRow): Words {
  let w = wordsCache.get(r)
  if (!w) {
    w = { p: hashWords(r.phash), d: hashWords(r.dhash) }
    wordsCache.set(r, w)
  }
  return w
}

/**
 * Two camera originals with different capture times are separate shots (a burst), however alike they look:
 * that is "similar", not "duplicate". Copies made by apps lose the camera time; edits keep the same one.
 */
function differentShots(a: HashRow, b: HashRow): boolean {
  return (
    !!a.camera_model &&
    !!b.camera_model &&
    a.capture_time_source === 'exif_original' &&
    b.capture_time_source === 'exif_original' &&
    !!a.capture_time &&
    !!b.capture_time &&
    a.capture_time !== b.capture_time
  )
}

export function isProbableDuplicate(a: HashRow, b: HashRow): { match: boolean; phash: number; dhash: number } {
  const wa = words(a)
  const wb = words(b)
  const phash = hammingWords(wa.p, wb.p)
  if (a.media_type !== b.media_type || phash > NEAR_DUPLICATE.maxPhash) return { match: false, phash, dhash: 64 }
  const dhash = hammingWords(wa.d, wb.d)
  if (dhash > NEAR_DUPLICATE.maxDhash) return { match: false, phash, dhash }
  if (colourDistance(a.color, b.color) > NEAR_DUPLICATE.maxColourDiff) return { match: false, phash, dhash }
  if (differentShots(a, b)) return { match: false, phash, dhash }
  if (a.width && a.height && b.width && b.height) {
    const ra = a.width / a.height
    const rb = b.width / b.height
    if (Math.abs(ra - rb) / Math.max(ra, rb) > NEAR_DUPLICATE.maxAspectDiff) return { match: false, phash, dhash }
  }
  if (a.media_type === 'video' && a.duration_ms !== null && b.duration_ms !== null && Math.abs(a.duration_ms - b.duration_ms) > NEAR_DUPLICATE.maxDurationDiffMs) {
    return { match: false, phash, dhash }
  }
  return { match: true, phash, dhash }
}

const cache = new WeakMap<Library, { key: string; groups: number[][] }>()

/**
 * Groups assets whose fingerprints are within the thresholds. Candidate pairs come from a 6-band index
 * on the pHash (bands of 10–11 bits): two hashes at distance ≤ 5 must share at least one identical band
 * (pigeonhole), so nothing is missed while comparing only a tiny fraction of all pairs. Pairs the user
 * dismissed never link.
 *
 * Groups are formed around the best copy ("star" clustering): every member must match the best copy
 * itself. Plain connected components would chain — a burst shot can be close to a recompressed copy
 * that is close to the original, without being a duplicate of the original.
 */
export function findNearDuplicateGroups(library: Library): number[][] {
  const key = nearDuplicateStamp(library.db)
  const cached = cache.get(library)
  if (cached && cached.key === key) return cached.groups
  const groups = computeNearDuplicateGroups(library.db)
  cache.set(library, { key, groups })
  return groups
}

/** Changes whenever anything that feeds the grouping changes (cache key). */
export function nearDuplicateStamp(db: Database): string {
  return JSON.stringify(
    db.get<{ n: number; t: string | null; d: number; h: number }>(
      `SELECT (SELECT COUNT(*) FROM asset_hashes) AS n, (SELECT MAX(created_at) FROM asset_hashes) AS t,
              (SELECT COUNT(*) FROM near_duplicate_dismissals) AS d, (SELECT COUNT(*) FROM assets WHERE trashed_at IS NULL) AS h`
    )
  )
}

/** True when findNearDuplicateGroups() would answer from its cache. */
export function nearDuplicatesCached(library: Library): boolean {
  return cache.get(library)?.key === nearDuplicateStamp(library.db)
}

/** Stores groups computed elsewhere (a worker thread with its own read-only connection). */
export function primeNearDuplicateGroups(library: Library, key: string, groups: number[][]): void {
  if (key === nearDuplicateStamp(library.db)) cache.set(library, { key, groups })
}

/** The grouping itself: read-only, so it can run on any connection to the catalogue. */
export function computeNearDuplicateGroups(db: Database): number[][] {
  const rows = db.all<HashRow>(
    `SELECT h.asset_id, h.dhash, h.phash, h.color, a.media_type, a.width, a.height, a.duration_ms, a.camera_model, a.size_bytes, a.capture_time,
            a.capture_time_source
       FROM asset_hashes h JOIN assets a ON a.id = h.asset_id
      WHERE h.flat = 0 AND h.phash IS NOT NULL AND h.dhash IS NOT NULL AND a.trashed_at IS NULL`
  )
  const dismissed = new Set(db.all<{ asset_a: number; asset_b: number }>('SELECT asset_a, asset_b FROM near_duplicate_dismissals').map((r) => `${r.asset_a}:${r.asset_b}`))

  // 6 bands over the 64 pHash bits: [0,11) [11,22) [22,33) [33,44) [44,54) [54,64).
  const BOUNDS = [0, 11, 22, 33, 44, 54, 64]
  const bands = new Map<number, number[]>()
  rows.forEach((r, i) => {
    const bits = BigInt(`0x${r.phash}`)
    for (let b = 0; b < 6; b++) {
      const lo = BOUNDS[b] as number
      const width = (BOUNDS[b + 1] as number) - lo
      const value = Number((bits >> BigInt(lo)) & ((1n << BigInt(width)) - 1n))
      const k = b * 4096 + value
      const list = bands.get(k)
      if (list) list.push(i)
      else bands.set(k, [i])
    }
  })

  const parent = rows.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number
      i = parent[i] as number
    }
    return i
  }
  for (const list of bands.values()) {
    if (list.length < 2) continue
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x] as number
        const j = list[y] as number
        if (find(i) === find(j)) continue
        const a = rows[i] as HashRow
        const b = rows[j] as HashRow
        const lo = Math.min(a.asset_id, b.asset_id)
        const hi = Math.max(a.asset_id, b.asset_id)
        if (dismissed.has(`${lo}:${hi}`)) continue
        if (isProbableDuplicate(a, b).match) parent[find(i)] = find(j)
      }
    }
  }
  const byRoot = new Map<number, HashRow[]>()
  rows.forEach((r, i) => {
    const root = find(i)
    const list = byRoot.get(root)
    if (list) list.push(r)
    else byRoot.set(root, [r])
  })
  const groups: number[][] = []
  for (const component of byRoot.values()) {
    if (component.length < 2) continue
    // Split each connected component into stars around its best remaining copy.
    let rest = rankMembers(component.map(toRankRow)).map((rr) => component.find((c) => c.asset_id === rr.id) as HashRow)
    while (rest.length > 1) {
      const seed = rest[0] as HashRow
      const members = [seed]
      const remaining: HashRow[] = []
      for (const other of rest.slice(1)) {
        const lo = Math.min(seed.asset_id, other.asset_id)
        const hi = Math.max(seed.asset_id, other.asset_id)
        if (!dismissed.has(`${lo}:${hi}`) && isProbableDuplicate(seed, other).match) members.push(other)
        else remaining.push(other)
      }
      if (members.length > 1) groups.push(members.map((m) => m.asset_id).sort((a, b) => a - b))
      rest = remaining
    }
  }
  return groups
}

function toRankRow(r: HashRow): MemberRow {
  return {
    id: r.asset_id,
    size_bytes: r.size_bytes,
    original_filename: '',
    camera_make: null,
    camera_model: r.camera_model,
    origin: null,
    origin_confidence: null,
    width: r.width,
    height: r.height,
    capture_time: r.capture_time
  }
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
  capture_time: string | null
}

/** Best copy: real camera data first, then most pixels, then largest file, then a known capture date. */
function rankMembers(rows: MemberRow[]): MemberRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(!!b.camera_model) - Number(!!a.camera_model) ||
      (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) ||
      b.size_bytes - a.size_bytes ||
      Number(!!b.capture_time) - Number(!!a.capture_time) ||
      a.id - b.id
  )
}

function bestReason(best: MemberRow, others: MemberRow[]): string {
  const reasons: string[] = []
  if (best.camera_model && others.some((o) => !o.camera_model)) reasons.push('has camera data')
  const px = (r: MemberRow): number => (r.width ?? 0) * (r.height ?? 0)
  if (others.every((o) => px(best) > px(o))) reasons.push('highest resolution')
  else if (others.every((o) => best.size_bytes > o.size_bytes)) reasons.push('largest file')
  if (best.capture_time && others.some((o) => !o.capture_time)) reasons.push('has the date taken')
  return reasons.length ? reasons.join(' · ') : 'equivalent copies — kept the first imported'
}

export function nearDuplicates(library: Library, offset: number, limit: number): NearDuplicates {
  const db = library.db
  const groups = findNearDuplicateGroups(library)
  const allIds = groups.flat()
  const meta = new Map<number, MemberRow>()
  const hiddenOf = new Map<number, boolean>()
  // Fetch in chunks to keep SQL parameter lists bounded.
  for (let i = 0; i < allIds.length; i += 500) {
    const chunk = allIds.slice(i, i + 500)
    for (const r of db.all<MemberRow & { hidden: number }>(
      `SELECT id, size_bytes, original_filename, camera_make, camera_model, origin, origin_confidence, width, height, capture_time, hidden
         FROM assets WHERE id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(chunk)]
    )) {
      meta.set(r.id, r)
      hiddenOf.set(r.id, r.hidden === 1)
    }
  }
  const visibleCount = (g: number[]): number => g.filter((id) => !hiddenOf.get(id)).length
  const ordered = [...groups].sort((a, b) => Number(visibleCount(a) <= 1) - Number(visibleCount(b) <= 1) || b.length - a.length || (b[0] as number) - (a[0] as number))
  const unresolved = ordered.filter((g) => visibleCount(g) > 1)
  const page = ordered.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(Math.max(limit, 1), 100))

  const summaries = new Map<number, AssetSummary>(assetSummaries(library, page.flat()).map((s) => [s.id, s]))
  const out: NearDuplicateGroup[] = page.map((g) => {
    const rows = rankMembers(g.map((id) => meta.get(id)).filter((r): r is MemberRow => !!r))
    const best = rows[0] as MemberRow
    const members: NearDuplicateMember[] = rows.map((r) => ({
      asset: summaries.get(r.id) as AssetSummary,
      sizeBytes: r.size_bytes,
      originalFilename: r.original_filename,
      camera: r.camera_model ? [r.camera_make, r.camera_model].filter(Boolean).join(' ') : null,
      origin: r.origin,
      originConfidence: r.origin_confidence
    }))
    return {
      key: String(g[0]),
      bestId: best.id,
      bestReason: bestReason(best, rows.slice(1)),
      resolved: visibleCount(g) <= 1,
      members
    }
  })
  const hashed = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM asset_hashes')?.n ?? 0
  const hashable = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM asset_thumbnails WHERE variant = 'thumb'")?.n ?? 0
  return {
    totalGroups: ordered.length,
    unresolvedGroups: unresolved.length,
    extraCopies: unresolved.reduce((s, g) => s + visibleCount(g) - 1, 0),
    hashed,
    hashable,
    groups: out
  }
}

/** "Not duplicates": remember every pair in the given set so they are never grouped again. */
export function dismissNearDuplicates(library: Library, assetIds: number[]): void {
  const ids = [...new Set(assetIds)].sort((a, b) => a - b)
  const now = new Date().toISOString()
  library.db.tx(() => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        library.db.run('INSERT OR IGNORE INTO near_duplicate_dismissals (asset_a, asset_b, created_at) VALUES (?, ?, ?)', [ids[i], ids[j], now])
      }
    }
  })
}

/** Keeps the best copy in every unresolved group visible and hides the rest. Returns how many were hidden. */
export function hideAllNearDuplicateExtras(library: Library): number {
  const groups = findNearDuplicateGroups(library)
  const db = library.db
  const toHide: number[] = []
  for (const g of groups) {
    const rows = rankMembers(
      db.all<MemberRow & { hidden: number }>(
        `SELECT id, size_bytes, original_filename, camera_make, camera_model, origin, origin_confidence, width, height, capture_time, hidden
           FROM assets WHERE id IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(g)]
      )
    )
    for (const r of rows.slice(1)) toHide.push(r.id)
  }
  const now = new Date().toISOString()
  let n = 0
  db.tx(() => {
    for (const id of toHide) n += db.run('UPDATE assets SET hidden = 1, hidden_at = ?, updated_at = ? WHERE id = ? AND hidden = 0', [now, now, id]).changes
  })
  return n
}
