/**
 * Last-resort capture date heuristic from file names produced by phones/apps, e.g.
 *   IMG_20240715_143211.jpg, PXL_20240715_143211123.jpg, Screenshot_2024-07-15-14-32-11.png,
 *   2024-07-15 14.32.11.jpg, IMG-20240715-WA0001.jpg (date only).
 * Returns a wall-clock ISO string (no zone) or null.
 */
const PATTERN =
  /(?<![0-9])((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[-_. T]?([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d))?/

export function dateFromFilename(filename: string, now = new Date()): string | null {
  const m = PATTERN.exec(filename)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  if (year < 1990 || probe.getTime() > now.getTime() + 86_400_000) return null
  const time = h !== undefined ? `${h}:${mi}:${s}` : '00:00:00'
  return `${y}-${mo}-${d}T${time}`
}
