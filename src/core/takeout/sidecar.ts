/** Normalised view of a Google Photos Takeout JSON sidecar. The full JSON is always preserved alongside. */
export interface TakeoutSidecar {
  title: string | null
  description: string | null
  /** UTC seconds. */
  photoTakenTime: number | null
  creationTime: number | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  favorited: boolean
  people: string[]
  url: string | null
}

export interface TakeoutAlbum {
  title: string
  description: string | null
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function timestamp(v: unknown): number | null {
  const ts = obj(v)?.timestamp
  const n = typeof ts === 'string' ? Number(ts) : typeof ts === 'number' ? ts : Number.NaN
  // Google writes 0 for unknown; also reject absurd values.
  return Number.isFinite(n) && n > 0 && n < Date.now() / 1000 + 86_400 ? n : null
}

function geo(v: unknown): { latitude: number; longitude: number; altitude: number | null } | null {
  const g = obj(v)
  if (!g) return null
  const lat = typeof g.latitude === 'number' ? g.latitude : Number.NaN
  const lon = typeof g.longitude === 'number' ? g.longitude : Number.NaN
  // Takeout uses 0.0/0.0 for "no location".
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const alt = typeof g.altitude === 'number' && Number.isFinite(g.altitude) && g.altitude !== 0 ? g.altitude : null
  return { latitude: lat, longitude: lon, altitude: alt }
}

/** Returns null when the JSON is not per-photo Google metadata (e.g. album metadata, print orders). */
export function parseTakeoutSidecar(json: unknown): TakeoutSidecar | null {
  const o = obj(json)
  if (!o) return null
  const photoTakenTime = timestamp(o.photoTakenTime)
  const creationTime = timestamp(o.creationTime)
  if (photoTakenTime === null && creationTime === null && !('geoData' in o)) return null
  if (typeof o.title !== 'string' && !('photoTakenTime' in o)) return null
  const location = geo(o.geoData) ?? geo(o.geoDataExif)
  const people = Array.isArray(o.people)
    ? o.people.map((p) => obj(p)?.name).filter((n): n is string => typeof n === 'string' && n.length > 0)
    : []
  return {
    title: typeof o.title === 'string' ? o.title : null,
    description: typeof o.description === 'string' && o.description.trim() ? o.description.trim() : null,
    photoTakenTime,
    creationTime,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    altitude: location?.altitude ?? null,
    favorited: o.favorited === true,
    people,
    url: typeof o.url === 'string' ? o.url : null
  }
}

/** Album folders carry a metadata.json with the album title (year folders "Photos from 2019" do not). */
export function parseTakeoutAlbum(json: unknown): TakeoutAlbum | null {
  const o = obj(json)
  if (!o || typeof o.title !== 'string' || !o.title.trim()) return null
  if ('photoTakenTime' in o) return null
  return { title: o.title.trim(), description: typeof o.description === 'string' && o.description.trim() ? o.description.trim() : null }
}

/** Folder structure that identifies a Google Photos Takeout (localised folder names included). */
export function looksLikeTakeoutPath(path: string): boolean {
  return /(^|\/)Takeout\/Google (Photos|Fotos|Foto|Zdjęcia|Фото)(\/|$)/i.test(path.replace(/\\/g, '/'))
}
