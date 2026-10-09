import exifr from 'exifr'
import sharp from './sharp'
import type { CaptureTimeSource, MediaType } from '@shared/types'
import { dateFromFilename } from './filenameDate'
import { isSharpDecodable } from './formats'
import { readVideoInfo, readVideoInfoFromBuffer } from './video'

/** Normalised metadata extracted from one physical file. Stored as JSON on import items. */
export interface ExtractedMetadata {
  width: number | null
  height: number | null
  orientation: number | null
  durationMs: number | null
  /** Videos: whether there is a sound track. */
  hasAudio: boolean | null
  /** Images: number of frames (>1 means animated GIF/WebP). */
  frames: number | null
  captureTime: string | null
  captureOffsetMinutes: number | null
  captureTimeSource: CaptureTimeSource | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  /** Selected raw tags, preserved verbatim for later use. */
  raw: Record<string, string | number | number[]>
}

export function emptyMetadata(): ExtractedMetadata {
  return {
    width: null,
    height: null,
    orientation: null,
    durationMs: null,
    hasAudio: null,
    frames: null,
    captureTime: null,
    captureOffsetMinutes: null,
    captureTimeSource: null,
    latitude: null,
    longitude: null,
    altitude: null,
    cameraMake: null,
    cameraModel: null,
    lensModel: null,
    raw: {}
  }
}

const RAW_KEYS = [
  'Make',
  'Model',
  'LensModel',
  'Software',
  'DateTimeOriginal',
  'CreateDate',
  'ModifyDate',
  'OffsetTimeOriginal',
  'OffsetTimeDigitized',
  'OffsetTime',
  'SubSecTimeOriginal',
  'ExposureTime',
  'FNumber',
  'ISO',
  'FocalLength',
  'FocalLengthIn35mmFormat',
  'Flash',
  'Orientation',
  'ExifImageWidth',
  'ExifImageHeight',
  'ImageWidth',
  'ImageHeight',
  'GPSLatitude',
  'GPSLatitudeRef',
  'GPSLongitude',
  'GPSLongitudeRef',
  'GPSAltitude',
  'GPSDateStamp',
  'GPSTimeStamp',
  'DateCreated'
] as const

const EXIF_DATE = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/

/** Parses EXIF "YYYY:MM:DD HH:MM:SS" (or ISO-like XMP) into a wall-clock ISO string, rejecting placeholder dates. */
export function parseExifDate(value: unknown, subsec?: unknown): { wall: string; offsetMinutes: number | null } | null {
  if (typeof value !== 'string') return null
  const m = EXIF_DATE.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s, frac] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  if (year < 1826 || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 60) return null
  const probe = Date.UTC(year, month - 1, day)
  if (probe > Date.now() + 2 * 86_400_000) return null
  const fraction = frac ?? (typeof subsec === 'string' || typeof subsec === 'number' ? String(subsec).trim() : '')
  const ms = /^\d+$/.test(fraction) ? `.${fraction.padEnd(3, '0').slice(0, 3)}` : ''
  // XMP dates may carry their own zone suffix.
  const zone = /([+-])(\d{2}):?(\d{2})$|Z$/.exec(value.trim().slice(19))
  let offsetMinutes: number | null = null
  if (zone) offsetMinutes = zone[0] === 'Z' ? 0 : (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3]))
  return { wall: `${y}-${mo}-${d}T${h}:${mi}:${s}${ms}`, offsetMinutes }
}

export function parseOffset(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\0/g, '').trim()
  return t.length > 0 ? t : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function pickRaw(tags: Record<string, unknown>): ExtractedMetadata['raw'] {
  const raw: ExtractedMetadata['raw'] = {}
  for (const key of RAW_KEYS) {
    const v = tags[key]
    if (typeof v === 'string') raw[key] = v.replace(/\0/g, '').slice(0, 256)
    else if (typeof v === 'number' && Number.isFinite(v)) raw[key] = v
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) raw[key] = v as number[]
  }
  return raw
}

/** Formats UTC ms as a local wall-clock ISO string for this machine's zone, returning the offset used. */
export function utcToLocalWall(ms: number): { wall: string; offsetMinutes: number } {
  const offsetMinutes = -new Date(ms).getTimezoneOffset()
  const wall = new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 19)
  return { wall, offsetMinutes }
}

/**
 * Capture-time precedence (first match wins):
 *   1. EXIF DateTimeOriginal (+ OffsetTimeOriginal, SubSecTimeOriginal)
 *   2. EXIF CreateDate / DateTimeDigitized
 *   3. XMP DateCreated
 *   4. QuickTime container creation time (videos; UTC, shown in this machine's zone)
 *   5. Filename pattern (IMG_20240715_143211 etc.)
 *   6. EXIF ModifyDate (IFD0 DateTime – often rewritten by editing software)
 * Filesystem times are never treated as capture time; they are only a sort fallback.
 */
export type MetadataInput =
  | { path: string }
  /** A whole file in memory (small archive entries), or its head plus a captured `moov` box (videos). */
  | { buffer: Buffer; moov?: Buffer | null }

export async function extractMetadata(input: MetadataInput, filename: string, mediaType: MediaType, mime: string): Promise<ExtractedMetadata> {
  const source = 'path' in input ? input.path : input.buffer
  const meta = emptyMetadata()
  let tags: Record<string, unknown> = {}

  if (mediaType === 'photo') {
    try {
      const parsed = (await exifr.parse(source, {
        tiff: true,
        exif: true,
        gps: true,
        xmp: true,
        ihdr: true,
        icc: false,
        iptc: false,
        jfif: false,
        interop: false,
        translateValues: false,
        reviveValues: false,
        mergeOutput: true
      })) as Record<string, unknown> | undefined
      tags = parsed ?? {}
    } catch {
      tags = {}
    }

    meta.cameraMake = str(tags.Make)
    meta.cameraModel = str(tags.Model)
    meta.lensModel = str(tags.LensModel)
    meta.orientation = num(tags.Orientation)
    meta.latitude = num(tags.latitude)
    meta.longitude = num(tags.longitude)
    if (meta.latitude === 0 && meta.longitude === 0) {
      meta.latitude = null
      meta.longitude = null
    }
    const alt = num(tags.GPSAltitude)
    if (alt !== null) {
      const ref = tags.GPSAltitudeRef
      const below = ref === 1 || (ref instanceof Uint8Array && ref[0] === 1)
      meta.altitude = below ? -alt : alt
    }
    meta.raw = pickRaw(tags)

    const candidates: Array<[CaptureTimeSource, unknown, unknown, unknown]> = [
      ['exif_original', tags.DateTimeOriginal, tags.OffsetTimeOriginal, tags.SubSecTimeOriginal],
      ['exif_digitized', tags.CreateDate, tags.OffsetTimeDigitized, tags.SubSecTimeDigitized],
      ['xmp', tags.DateCreated, undefined, undefined]
    ]
    for (const [source, value, offset, subsec] of candidates) {
      const parsed = parseExifDate(value, subsec)
      if (parsed) {
        meta.captureTime = parsed.wall
        meta.captureOffsetMinutes = parseOffset(offset) ?? parsed.offsetMinutes
        meta.captureTimeSource = source
        break
      }
    }

    // Dimensions: prefer decoding the header with sharp (already orientation-aware), fall back to EXIF.
    if (isSharpDecodable(mime)) {
      try {
        const m = await sharp(source, { failOn: 'none' }).metadata()
        meta.width = m.autoOrient?.width ?? m.width ?? null
        // For multi-page images libvips reports the full strip height; use the page height.
        meta.height = m.pageHeight ?? m.autoOrient?.height ?? m.height ?? null
        meta.frames = m.pages ?? 1
      } catch {
        // Corrupt or truncated image; leave dimensions unknown.
      }
    }
    if (meta.width === null) {
      let w = num(tags.ExifImageWidth) ?? num(tags.ImageWidth)
      let h = num(tags.ExifImageHeight) ?? num(tags.ImageHeight)
      if (w !== null && h !== null && meta.orientation !== null && meta.orientation >= 5) [w, h] = [h, w]
      meta.width = w
      meta.height = h
    }
  } else {
    const info =
      'path' in input ? await readVideoInfo(input.path) : await readVideoInfoFromBuffer(input.moov ?? input.buffer)
    if (info) {
      meta.width = info.width
      meta.height = info.height
      meta.durationMs = info.durationMs
      meta.hasAudio = info.hasAudio
      for (const [k, v] of Object.entries(info.tags)) meta.raw[`Video${k[0]?.toUpperCase()}${k.slice(1)}`] = v
      if (info.createdUtcMs !== null) {
        const { wall, offsetMinutes } = utcToLocalWall(info.createdUtcMs)
        meta.captureTime = wall
        meta.captureOffsetMinutes = offsetMinutes
        meta.captureTimeSource = 'quicktime'
        meta.raw.QuickTimeCreationUtc = new Date(info.createdUtcMs).toISOString()
      }
    }
  }

  if (!meta.captureTime) {
    const fromName = dateFromFilename(filename)
    if (fromName) {
      meta.captureTime = fromName
      meta.captureTimeSource = 'filename'
    }
  }
  if (!meta.captureTime) {
    const modified = parseExifDate(tags.ModifyDate)
    if (modified) {
      meta.captureTime = modified.wall
      meta.captureOffsetMinutes = parseOffset(tags.OffsetTime)
      meta.captureTimeSource = 'exif_modified'
    }
  }
  return meta
}

/** Wall-clock ISO string -> ms "as if UTC" (the timeline encoding). */
export function wallToSortMs(wall: string): number {
  const ms = Date.parse(`${wall.length === 19 || wall.length === 23 ? wall : wall.slice(0, 19)}Z`)
  return Number.isFinite(ms) ? ms : 0
}

/** Local wall-clock encoding of a filesystem timestamp, for the sort fallback. */
export function localSortMs(date: Date): number {
  return date.getTime() - date.getTimezoneOffset() * 60_000
}
