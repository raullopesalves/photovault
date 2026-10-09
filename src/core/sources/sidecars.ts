/** Parsers for metadata files that travel next to media: XMP sidecars and Apple's iCloud export CSV. */

export interface XmpSidecar {
  /** Wall-clock ISO (no zone) or with offset, as written by the editor. */
  dateTaken: string | null
  latitude: number | null
  longitude: number | null
  rating: number | null
  description: string | null
}

function xmpValue(xml: string, name: string): string | null {
  // Attribute form: exif:DateTimeOriginal="2019-07-01T10:20:30"
  const attr = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(xml)
  if (attr?.[1]) return attr[1].trim()
  // Element form: <exif:DateTimeOriginal>…</exif:DateTimeOriginal> (possibly wrapping rdf:Alt/rdf:li)
  const el = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)
  if (!el?.[1]) return null
  const li = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(el[1])
  return (li?.[1] ?? el[1]).replace(/<[^>]+>/g, '').trim() || null
}

/** XMP GPS coordinates look like "46,30.5N" or "46,30,15N" (degrees, minutes[, seconds] + hemisphere). */
function xmpCoordinate(v: string | null): number | null {
  if (!v) return null
  const m = /^\s*(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?\s*([NSEW])\s*$/i.exec(v)
  if (m) {
    const val = Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3]) / 3600 : 0)
    return /[SW]/i.test(m[4] as string) ? -val : val
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function xmpDate(v: string | null): string | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v.trim())
  if (!m) return null
  const year = Number(m[1])
  if (year < 1826 || year > new Date().getFullYear() + 1) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`
}

export function parseXmpSidecar(xml: string): XmpSidecar {
  const dateTaken = xmpDate(xmpValue(xml, 'exif:DateTimeOriginal')) ?? xmpDate(xmpValue(xml, 'photoshop:DateCreated')) ?? xmpDate(xmpValue(xml, 'xmp:CreateDate'))
  let latitude = xmpCoordinate(xmpValue(xml, 'exif:GPSLatitude'))
  let longitude = xmpCoordinate(xmpValue(xml, 'exif:GPSLongitude'))
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) {
    latitude = null
    longitude = null
  }
  const rating = Number(xmpValue(xml, 'xmp:Rating'))
  return {
    dateTaken,
    latitude,
    longitude,
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    description: xmpValue(xml, 'dc:description')
  }
}

export interface ICloudRecord {
  /** UTC milliseconds of the original creation date. */
  createdUtcMs: number | null
  favorite: boolean
  hidden: boolean
  deleted: boolean
}

/** Minimal RFC-4180 CSV reader (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** Apple writes e.g. "Saturday July 13,2019 12:52 PM GMT" (and sometimes ISO). */
export function parseAppleDate(v: string): number | null {
  const s = v.trim()
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(GMT|UTC)?/i.exec(s)
  if (m) {
    const month = MONTHS.indexOf((m[1] as string).toLowerCase())
    if (month < 0) return null
    let hour = Number(m[4]) % 12
    if ((m[7] ?? '').toUpperCase() === 'PM') hour += 12
    if (!m[7]) hour = Number(m[4])
    return Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0))
  }
  const iso = Date.parse(s)
  return Number.isFinite(iso) ? iso : null
}

/** iCloud "Photo Details.csv": imgName, fileChecksum, favorite, hidden, deleted, originalCreationDate, viewCount, importDate. */
export function parseICloudDetails(text: string): Map<string, ICloudRecord> {
  const rows = parseCsv(text.replace(/^﻿/, ''))
  const out = new Map<string, ICloudRecord>()
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (name: string): number => header.indexOf(name.toLowerCase())
  const iName = col('imgName')
  if (iName < 0) return out
  const yes = (v: string | undefined): boolean => /^(yes|true|1)$/i.test((v ?? '').trim())
  for (const r of rows.slice(1)) {
    const name = r[iName]?.trim()
    if (!name) continue
    const date = r[col('originalCreationDate')]
    out.set(name.toLowerCase(), {
      createdUtcMs: date ? parseAppleDate(date) : null,
      favorite: yes(r[col('favorite')]),
      hidden: yes(r[col('hidden')]),
      deleted: yes(r[col('deleted')])
    })
  }
  return out
}
