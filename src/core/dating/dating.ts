import type { Library } from '../library/library'
import { wallToSortMs } from '../media/metadata'
import { findNearDuplicateGroups } from '../repo/nearDuplicates'

/** Bump when the rules change: automatic (estimated / borrowed) dates are recomputed from scratch. */
export const DATING_VERSION = 1

/** Capture-time sources that come from the file or the export itself (trusted as donors and anchors). */
const RECORDED = new Set(['exif_original', 'exif_digitized', 'xmp', 'quicktime', 'takeout', 'filename'])
/** Sources produced by this module; recomputed on every run, never used as evidence for other items. */
const AUTOMATIC = new Set(['estimated', 'duplicate'])

/**
 * Android names saved files after their MediaStore id ("1000040770.jpg"). Ids are handed out in order,
 * so they track the moment a file was saved on the phone.
 */
const MEDIA_ID_NAME = /^(1\d{9})\.[a-z0-9]{2,5}$/i

const DAY = 86_400_000
/** Neighbouring anchors further apart than this give no estimate (too uncertain). */
const MAX_BRACKET = 30 * DAY
/** An anchor this far from the median of its neighbours is out of sequence (e.g. an old photo saved later). */
const OUTLIER = 14 * DAY

export interface DatingResult {
  borrowed: number
  estimated: number
}

function wallFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19)
}

function dayLabel(wall: string): string {
  const d = new Date(`${wall.slice(0, 19)}Z`)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

function setDate(library: Library, id: number, wall: string, source: string, evidence: string[]): void {
  const sortTime = wallToSortMs(wall)
  library.db.run(
    `UPDATE assets SET capture_time = ?, capture_offset_minutes = NULL, capture_time_source = ?, sort_time = ?, sort_day = ?,
            sort_time_source = ?, date_evidence = ?, updated_at = ? WHERE id = ?`,
    [wall, source, sortTime, new Date(sortTime).toISOString().slice(0, 10), source, JSON.stringify(evidence), new Date().toISOString(), id]
  )
}

/** Back to undated: the item returns to the "No date" section at its file-date position. */
function clearDate(library: Library, id: number): void {
  library.db.run(
    `UPDATE assets SET capture_time = NULL, capture_offset_minutes = NULL, capture_time_source = NULL,
            sort_time = COALESCE(fallback_sort_time, sort_time),
            sort_day = strftime('%Y-%m-%d', COALESCE(fallback_sort_time, sort_time) / 1000, 'unixepoch'),
            sort_time_source = 'file_modified', date_evidence = NULL, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  )
}

/**
 * Fills in dates for items that have none, from two kinds of indirect evidence, and never touches recorded
 * or manual dates:
 *   1. A visually identical copy (probable duplicate) with a recorded capture date — e.g. a WhatsApp copy of a
 *      camera photo gets the photo's date. Source 'duplicate'.
 *   2. Android media-id file names: interpolate between the nearest dated neighbours by id. Source 'estimated'.
 *      Only when both neighbours exist, are in order, and are at most 30 days apart; anchors out of sequence
 *      are ignored. The date means "saved on the phone", which for received media is roughly when it arrived.
 * Idempotent: automatic dates are cleared and recomputed each run.
 */
export function runDating(library: Library, opts: { force?: boolean } = {}): DatingResult & { skipped: boolean } {
  const db = library.db
  const result: DatingResult & { skipped: boolean } = { borrowed: 0, estimated: 0, skipped: false }

  // Skip when nothing that feeds the pass changed since the last run (it is a whole-library pass).
  const stamp = JSON.stringify([
    DATING_VERSION,
    db.get<Record<string, number | string>>(
      `SELECT (SELECT COUNT(*) FROM assets) AS a, (SELECT COUNT(*) FROM asset_hashes) AS h,
              (SELECT COUNT(*) FROM near_duplicate_dismissals) AS d,
              (SELECT COUNT(*) FROM assets WHERE capture_time IS NOT NULL AND capture_time_source NOT IN ('estimated', 'duplicate')) AS r,
              (SELECT COUNT(*) || '/' || COALESCE(MAX(updated_at), '') FROM assets WHERE capture_time_source = 'manual') AS m`
    )
  ])
  const last = db.get<{ value: string }>("SELECT value FROM library_meta WHERE key = 'dating_stamp'")?.value
  if (!opts.force && last === stamp) {
    result.skipped = true
    return result
  }

  db.tx(() => {
    for (const r of db.all<{ id: number }>("SELECT id FROM assets WHERE capture_time_source IN ('estimated', 'duplicate')")) clearDate(library, r.id)

    type Row = { id: number; capture_time: string | null; capture_time_source: string | null; original_filename: string }
    const all = new Map<number, Row>(db.all<Row>('SELECT id, capture_time, capture_time_source, original_filename FROM assets').map((r) => [r.id, r]))

    // 1. Borrow from visually identical copies.
    for (const group of findNearDuplicateGroups(library)) {
      const members = group.map((id) => all.get(id)).filter((m): m is Row => !!m)
      const donors = members.filter((m) => m.capture_time && (RECORDED.has(m.capture_time_source ?? '') || m.capture_time_source === 'manual'))
      if (donors.length === 0) continue
      // Prefer the camera's own record; among several, the earliest is the original moment.
      const donor = [...donors].sort((a, b) => Number(b.capture_time_source === 'exif_original') - Number(a.capture_time_source === 'exif_original') || (a.capture_time as string).localeCompare(b.capture_time as string))[0] as Row
      for (const m of members) {
        if (m.capture_time) continue
        const wall = donor.capture_time as string
        setDate(library, m.id, wall, 'duplicate', [`Same picture as “${donor.original_filename}”, which records ${dayLabel(wall)}`])
        m.capture_time = wall
        m.capture_time_source = 'duplicate'
        result.borrowed++
      }
    }

    // 2. Interpolate along Android media ids.
    const names = new Map<number, string[]>()
    for (const p of db.all<{ asset_id: number; original_filename: string }>('SELECT asset_id, original_filename FROM provenance')) {
      const list = names.get(p.asset_id) ?? []
      list.push(p.original_filename)
      names.set(p.asset_id, list)
    }
    type Seq = { id: number; num: number; name: string; t: number | null; wall: string | null }
    const seq: Seq[] = []
    for (const r of all.values()) {
      const name = [r.original_filename, ...(names.get(r.id) ?? [])].find((n) => MEDIA_ID_NAME.test(n))
      if (!name) continue
      const num = Number(MEDIA_ID_NAME.exec(name)?.[1])
      const anchor = r.capture_time && RECORDED.has(r.capture_time_source ?? '')
      seq.push({ id: r.id, num, name, t: anchor ? wallToSortMs(r.capture_time as string) : null, wall: anchor ? r.capture_time : null })
    }
    seq.sort((a, b) => a.num - b.num)
    let anchors = seq.filter((s) => s.t !== null)
    // Drop anchors that disagree with their neighbourhood (an old photo edited or re-saved gets a new id).
    anchors = anchors.filter((a, i) => {
      const around = [...anchors.slice(Math.max(0, i - 4), i), ...anchors.slice(i + 1, i + 5)].map((x) => x.t as number).sort((x, y) => x - y)
      if (around.length < 2) return true
      const median = around[Math.floor(around.length / 2)] as number
      return Math.abs((a.t as number) - median) <= OUTLIER
    })
    let ai = 0
    for (const s of seq) {
      if (s.t !== null || all.get(s.id)?.capture_time) continue
      while (ai < anchors.length && (anchors[ai] as Seq).num < s.num) ai++
      const before = anchors[ai - 1]
      const after = anchors[ai]
      if (!before || !after || after.num === before.num) continue
      const span = (after.t as number) - (before.t as number)
      if (span < 0 || span > MAX_BRACKET) continue
      const est = (before.t as number) + ((s.num - before.num) / (after.num - before.num)) * span
      const wall = wallFromMs(est)
      const precision = span <= DAY ? 'same day as its neighbours' : span <= 7 * DAY ? 'within a week' : 'within a month'
      setDate(library, s.id, wall, 'estimated', [
        `Estimated from neighbouring files on the same phone: “${before.name}” (${dayLabel(before.wall as string)}) and “${after.name}” (${dayLabel(after.wall as string)})`,
        `Precision: ${precision}`,
        'Based on the phone’s media number in the file name, which follows the moment a file was saved — for received media, roughly when it arrived'
      ])
      result.estimated++
    }
    db.run("INSERT OR REPLACE INTO library_meta (key, value) VALUES ('dating_stamp', ?)", [stamp])
  })
  library.logger.info('dating.run', { ...result })
  return result
}

/** Sets (or, with null, removes) the date of items by hand. Manual dates are never overwritten automatically. */
export function setManualDates(library: Library, assetIds: number[], wall: string | null): void {
  const today = new Date().toISOString().slice(0, 10)
  library.db.tx(() => {
    for (const id of assetIds) {
      if (wall === null) {
        // Only inferred or hand-set dates can be removed; a date recorded in the file can be corrected but not erased.
        const src = library.db.get<{ s: string | null }>('SELECT capture_time_source AS s FROM assets WHERE id = ?', [id])?.s
        if (src === 'manual' || (src && AUTOMATIC.has(src))) clearDate(library, id)
      } else {
        setDate(library, id, wall, 'manual', [`Set by you on ${today}`])
      }
    }
  })
  library.logger.info('dating.manual', { count: assetIds.length, wall })
}
