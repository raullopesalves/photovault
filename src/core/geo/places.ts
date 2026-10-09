import data from './places.json'

/**
 * Offline place names: the nearest town or city (GeoNames "cities5000", CC BY 4.0 — 64k places with at least
 * 5,000 inhabitants) and its country. Used for trip names, the map, the viewer and search ("lisbon").
 */
export interface Place {
  city: string
  country: string
  countryCode: string
  km: number
}

type Row = [string, string, number, number, number]
const rows = (data as unknown as { rows: Row[] }).rows

let grid: Map<string, number[]> | null = null
const key = (lat: number, lon: number): string => `${Math.floor(lat)}:${Math.floor(lon)}`

function index(): Map<string, number[]> {
  if (grid) return grid
  grid = new Map()
  rows.forEach((r, i) => {
    const k = key(r[2], r[3])
    const list = grid!.get(k)
    if (list) list.push(i)
    else grid!.set(k, [i])
  })
  return grid
}

const regionNames = new Map<string, Intl.DisplayNames>()
/** Country name from its ISO code, in English (stored place names) or another language (display). */
export function countryName(code: string, lang = 'en'): string {
  try {
    let names = regionNames.get(lang)
    if (!names) regionNames.set(lang, (names = new Intl.DisplayNames([lang], { type: 'region' })))
    return names.of(code) ?? code
  } catch {
    return code
  }
}

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

/** The nearest town or city within `maxKm` (default 30 km), or null (at sea, in the wilderness…). */
export function nearestPlace(lat: number, lon: number, maxKm = 30): Place | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const g = index()
  let best: Row | null = null
  let bestKm = maxKm
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const i of g.get(key(lat + dy, lon + dx)) ?? []) {
        const r = rows[i] as Row
        const d = km(lat, lon, r[2], r[3])
        if (d < bestKm) {
          bestKm = d
          best = r
        }
      }
    }
  }
  return best ? { city: best[0], country: countryName(best[1]), countryCode: best[1], km: Math.round(bestKm * 10) / 10 } : null
}

/** "Lisbon, Portugal" (or null). */
export function placeLabel(lat: number, lon: number): string | null {
  const p = nearestPlace(lat, lon)
  return p ? `${p.city}, ${p.country}` : null
}

export const PLACES_ATTRIBUTION = 'Place names: GeoNames (CC BY 4.0)'
