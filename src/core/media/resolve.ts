import type { TakeoutSidecar } from '../takeout/sidecar'
import { utcToLocalWall, type ExtractedMetadata } from './metadata'

export interface ResolvedMetadata extends ExtractedMetadata {
  description: string | null
  favorite: boolean
  /** The export says the user hid this item (iCloud "hidden"). */
  hidden: boolean
}

/** iCloud export details normalised to the same shape as a Takeout sidecar. */
export function icloudAsSidecar(r: { createdUtcMs: number | null; favorite: boolean; hidden: boolean }): TakeoutSidecar & { kind: 'icloud'; hidden: boolean } {
  return {
    kind: 'icloud',
    title: null,
    description: null,
    photoTakenTime: r.createdUtcMs === null ? null : Math.round(r.createdUtcMs / 1000),
    creationTime: null,
    latitude: null,
    longitude: null,
    altitude: null,
    favorited: r.favorite,
    people: [],
    url: null,
    hidden: r.hidden
  }
}

/** Embedded sources trusted over a Takeout sidecar: the camera's own wall-clock record. */
const CAMERA_TIME_SOURCES = new Set(['exif_original', 'exif_digitized', 'xmp'])

function wallWithOffset(utcMs: number, offsetMinutes: number | null): { wall: string; offsetMinutes: number } {
  if (offsetMinutes === null) return utcToLocalWall(utcMs)
  return { wall: new Date(utcMs + offsetMinutes * 60_000).toISOString().slice(0, 19), offsetMinutes }
}

/**
 * Combines what the file says about itself with what an export sidecar says about it.
 *
 * Capture time
 *   1. EXIF/XMP capture time in the file (camera wall clock – most faithful)
 *   2. Takeout photoTakenTime (UTC; reliable for videos, screenshots and files whose EXIF was stripped)
 *   3. QuickTime container time, filename pattern, EXIF ModifyDate (weaker embedded hints)
 *   A Takeout UTC time is shown in the photo's EXIF offset if known, else in this machine's zone.
 *
 * Location: embedded GPS first; otherwise Takeout geoData (which also holds locations added in Google Photos).
 * Description and favourite come only from the sidecar.
 * Nothing is discarded: both inputs are stored verbatim (asset raw tags + provenance sidecar JSON).
 */
export function resolveMetadata(embedded: ExtractedMetadata, sidecar: (TakeoutSidecar & { kind?: 'takeout' | 'icloud'; hidden?: boolean }) | null): ResolvedMetadata {
  const out: ResolvedMetadata = { ...embedded, raw: { ...embedded.raw }, description: (embedded.raw.XmpDescription as string | undefined) ?? null, favorite: false, hidden: false }
  if (!sidecar) return out

  const embeddedIsCamera = embedded.captureTimeSource !== null && CAMERA_TIME_SOURCES.has(embedded.captureTimeSource)
  if (!embeddedIsCamera && sidecar.photoTakenTime !== null) {
    const { wall, offsetMinutes } = wallWithOffset(sidecar.photoTakenTime * 1000, embedded.captureOffsetMinutes)
    out.captureTime = wall
    out.captureOffsetMinutes = offsetMinutes
    out.captureTimeSource = sidecar.kind === 'icloud' ? 'icloud' : 'takeout'
  }
  if (sidecar.photoTakenTime !== null) {
    out.raw[sidecar.kind === 'icloud' ? 'ICloudCreationUtc' : 'TakeoutPhotoTakenTimeUtc'] = new Date(sidecar.photoTakenTime * 1000).toISOString()
  }
  out.hidden = sidecar.hidden === true

  if ((out.latitude === null || out.longitude === null) && sidecar.latitude !== null && sidecar.longitude !== null) {
    out.latitude = sidecar.latitude
    out.longitude = sidecar.longitude
    out.altitude = sidecar.altitude
    out.raw.LocationSource = 'takeout'
  }
  out.description = sidecar.description ?? out.description
  out.favorite = sidecar.favorited
  return out
}
