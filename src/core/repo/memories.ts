import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { Memory } from '@shared/types'
import countriesTopo from 'world-atlas/countries-110m.json'
import type { Library } from '../library/library'
import { nearestPlace } from '../geo/places'

/**
 * Memories, all computed from the catalogue on demand (no extra storage):
 *   - On this day: photos taken on today's date in earlier years (±1 day when that day is thin);
 *   - Trips: runs of consecutive days with photos far (> 100 km) from home, named after the country;
 *   - Events: busy days at home (many photos taken that day).
 * Only the user's own photos count (camera or unknown origin): forwarded WhatsApp images say little about
 * the user's own life. Hidden and binned items never appear.
 */

interface Row {
  id: number
  t: number
  day: string
  lat: number | null
  lon: number | null
  favorite: number
}

type Ring = Array<[number, number]>
let countries: Array<{ name: string; bbox: [number, number, number, number]; polygons: Ring[][] }> | null = null

function loadCountries(): NonNullable<typeof countries> {
  if (countries) return countries
  const topo = countriesTopo as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>
  const fc = feature(topo, topo.objects.countries)
  countries = fc.features.map((f) => {
    const g = f.geometry as { type: string; coordinates: unknown }
    const polygons = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Ring[][]
    let [minX, minY, maxX, maxY] = [180, 90, -180, -90]
    for (const poly of polygons)
      for (const [x, y] of poly[0] ?? []) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    return { name: (f.properties as { name?: string } | null)?.name ?? '', bbox: [minX, minY, maxX, maxY], polygons }
  })
  return countries
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number]
    const [xj, yj] = ring[j] as [number, number]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Country containing the point (offline, Natural Earth 1:110m), or null at sea / near borders. */
export function countryAt(lat: number, lon: number): string | null {
  for (const c of loadCountries()) {
    const [x1, y1, x2, y2] = c.bbox
    if (lon < x1 || lon > x2 || lat < y1 || lat > y2) continue
    for (const poly of c.polygons) {
      if (poly[0] && inRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lon, lat, hole))) return c.name
    }
  }
  return null
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

function ownPhotos(library: Library): Row[] {
  return library.db.all<Row>(
    `SELECT a.id, a.sort_time AS t, a.sort_day AS day, a.latitude AS lat, a.longitude AS lon, a.favorite
       FROM assets a
      WHERE a.trashed_at IS NULL AND a.hidden = 0 AND a.live_photo_of IS NULL AND a.undated = 0
        AND a.capture_time IS NOT NULL AND a.capture_time_source NOT IN ('estimated', 'duplicate')
        AND (a.origin IS NULL OR a.origin = 'camera')
      ORDER BY a.sort_time`
  )
}

/** Cover: favourites first, then spread across the memory. */
function covers(rows: Row[], n = 4): number[] {
  const fav = rows.filter((r) => r.favorite)
  const pick = [...fav.slice(0, n)]
  for (let i = 0; pick.length < n && i < n; i++) {
    const r = rows[Math.floor(((i + 0.5) * rows.length) / n)]
    if (r && !pick.some((p) => p.id === r.id)) pick.push(r)
  }
  return pick.map((r) => r.id)
}

const fmtDay = (day: string, opts: Intl.DateTimeFormatOptions): string => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })

export function memories(library: Library, today = new Date()): Memory[] {
  const rows = ownPhotos(library)
  const out: Memory[] = []

  // --- On this day ------------------------------------------------------------------------------------
  const md = (d: Date): string => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const thisYear = today.getFullYear()
  const exact = new Set([md(today)])
  const near = new Set([-1, 0, 1].map((k) => md(new Date(today.getTime() + k * 86_400_000))))
  const byYear = new Map<number, Row[]>()
  for (const r of rows) {
    const y = Number(r.day.slice(0, 4))
    if (y >= thisYear || !near.has(r.day.slice(5))) continue
    const list = byYear.get(y) ?? []
    list.push(r)
    byYear.set(y, list)
  }
  for (const [year, list] of [...byYear].sort((a, b) => b[0] - a[0])) {
    const onDay = list.filter((r) => exact.has(r.day.slice(5)))
    const use = onDay.length >= 3 ? onDay : list
    if (use.length < 3) continue
    const ago = thisYear - year
    out.push({
      key: `day-${year}`,
      kind: 'on_this_day',
      title: `${ago} year${ago === 1 ? '' : 's'} ago`,
      subtitle: fmtDay((use[0] as Row).day, { day: 'numeric', month: 'long', year: 'numeric' }),
      count: use.length,
      coverIds: covers(use),
      ids: use.map((r) => r.id),
      start: (use[0] as Row).day
    })
  }

  // --- Home: the most photographed place (0.25° cell) ---------------------------------------------------
  const cells = new Map<string, { n: number; lat: number; lon: number }>()
  for (const r of rows) {
    if (r.lat === null || r.lon === null) continue
    const k = `${Math.round(r.lat * 4)}:${Math.round(r.lon * 4)}`
    const c = cells.get(k) ?? { n: 0, lat: 0, lon: 0 }
    c.n++
    c.lat += r.lat
    c.lon += r.lon
    cells.set(k, c)
  }
  const top = [...cells.values()].sort((a, b) => b.n - a.n)[0]
  const home = top ? { lat: top.lat / top.n, lon: top.lon / top.n } : null

  // --- Days, then trips (consecutive away days) and events (busy days) ------------------------------
  const days = new Map<string, Row[]>()
  for (const r of rows) {
    const list = days.get(r.day) ?? []
    list.push(r)
    days.set(r.day, list)
  }
  const dayList = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const awayOf = (list: Row[]): { lat: number; lon: number } | null => {
    if (!home) return null
    const far = list.filter((r) => r.lat !== null && r.lon !== null && km(home, { lat: r.lat, lon: r.lon as number }) > 100)
    return far.length > 0 && far.length >= list.filter((r) => r.lat !== null).length / 2 ? { lat: far[0]!.lat as number, lon: far[0]!.lon as number } : null
  }
  const dayNum = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000)

  let trip: { days: Array<[string, Row[]]>; where: { lat: number; lon: number } } | null = null
  const trips: Memory[] = []
  const flushTrip = (): void => {
    if (!trip) return
    const all = trip.days.flatMap(([, l]) => l)
    if (all.length >= 10 && (trip.days.length >= 2 || all.length >= 25)) {
      const located = all.filter((r) => r.lat !== null && r.lon !== null)
      // Name it after the city if one dominates, else the country; list the main towns.
      const countries = new Map<string, number>()
      const cities = new Map<string, number>()
      const sample = located.filter((_, i) => i % Math.max(1, Math.floor(located.length / 60)) === 0)
      for (const r of sample) {
        const p = nearestPlace(r.lat as number, r.lon as number)
        const c = p?.country ?? countryAt(r.lat as number, r.lon as number)
        if (c) countries.set(c, (countries.get(c) ?? 0) + 1)
        if (p) cities.set(p.city, (cities.get(p.city) ?? 0) + 1)
      }
      const topCities = [...cities].sort((a, b) => b[1] - a[1])
      const country = [...countries].sort((a, b) => b[1] - a[1])[0]?.[0]
      const cityTrip = topCities[0] && topCities[0][1] >= sample.length * 0.6 ? topCities[0][0] : null
      const towns = topCities.filter(([, n]) => n >= Math.max(2, sample.length * 0.08)).slice(0, 3).map(([c]) => c)
      const first = trip.days[0]![0]
      const last = trip.days[trip.days.length - 1]![0]
      trips.push({
        key: `trip-${first}`,
        kind: 'trip',
        title: cityTrip ? `Trip to ${cityTrip}` : country ? `Trip to ${country}` : 'Trip',
        places: towns,
        subtitle:
          first === last
            ? fmtDay(first, { day: 'numeric', month: 'long', year: 'numeric' })
            : `${fmtDay(first, { day: 'numeric', month: 'short' })} – ${fmtDay(last, { day: 'numeric', month: 'short', year: 'numeric' })}`,
        count: all.length,
        coverIds: covers(all),
        ids: all.map((r) => r.id),
        start: first
      })
    }
    trip = null
  }
  const events: Memory[] = []
  for (const [day, list] of dayList) {
    const where = awayOf(list)
    if (where) {
      const prev = trip?.days[trip.days.length - 1]?.[0]
      if (trip && prev && dayNum(day) - dayNum(prev) <= 2) trip.days.push([day, list])
      else {
        flushTrip()
        trip = { days: [[day, list]], where }
      }
      continue
    }
    flushTrip()
    if (list.length >= 25) {
      events.push({
        key: `event-${day}`,
        kind: 'event',
        title: fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' }),
        subtitle: `${day.slice(0, 4)} · a busy day`,
        count: list.length,
        coverIds: covers(list),
        ids: list.map((r) => r.id),
        start: day
      })
    }
  }
  flushTrip()
  out.push(...trips.sort((a, b) => (a.start < b.start ? 1 : -1)))
  out.push(...events.sort((a, b) => b.count - a.count).slice(0, 40).sort((a, b) => (a.start < b.start ? 1 : -1)))
  return out
}
