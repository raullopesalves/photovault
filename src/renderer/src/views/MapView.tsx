import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { Layers, MapPin, X } from 'lucide-react'
import type { AssetQuery, MapCluster } from '@shared/types'
import { AssetGrid } from '../components/AssetGrid'
import { api, mediaUrl, n, plural } from '../lib/format'
import { NoMatches } from './PhotosView'
import { t } from '../lib/i18n'

type Box = [number, number, number, number]

const DETAIL_KEY = 'pv.map.detailed'
const VIEW_KEY = 'pv.map.view'

function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

/** Leaflet bounds → [south, west, north, east] in −180…180 (west > east when crossing the antimeridian). */
function boxOf(map: L.Map): Box {
  const b = map.getBounds()
  let west = b.getWest()
  let east = b.getEast()
  if (east - west >= 360) {
    west = -180
    east = 180
  } else {
    const wrap = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180
    west = wrap(west)
    east = wrap(east)
  }
  return [Math.max(-90, b.getSouth()), west, Math.min(90, b.getNorth()), east]
}

function pinIcon(c: MapCluster): L.DivIcon {
  const size = c.count === 1 ? 44 : c.count < 10 ? 50 : c.count < 100 ? 56 : 62
  return L.divIcon({
    className: 'pv-pin',
    iconSize: [size, size],
    html: `<div class="pv-pin-inner" style="width:${size}px;height:${size}px"><img src="${mediaUrl('thumb', c.coverId)}" alt="" loading="lazy" />${
      c.count > 1 ? `<span>${c.count > 999 ? `${Math.round(c.count / 100) / 10}k` : c.count}</span>` : ''
    }</div>`
  })
}

export function MapView(props: { version: number }) {
  const el = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const pins = useRef<L.LayerGroup | null>(null)
  const tiles = useRef<L.TileLayer | null>(null)
  const labels = useRef<L.LayerGroup | null>(null)
  const [view, setView] = useState<Box | null>(null)
  const [zoom, setZoom] = useState(2)
  const [selected, setSelected] = useState<Box | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<string | null>(null)
  const [detailed, setDetailed] = useState(() => load(DETAIL_KEY) === '1')
  // Offline mode (Settings) keeps the online map off, whatever was chosen before.
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    void api.getSettings().then((s) => setOffline(s.offline))
  }, [])
  const online = detailed && !offline
  const [located, setLocated] = useState<number | null>(null)
  const base: AssetQuery = { hidden: 'exclude' }

  useEffect(() => {
    void api.timeline({ ...base, located: true }).then((g) => setLocated(g.reduce((s, m) => s + m.count, 0)))
  }, [props.version])

  // Map + offline country outlines (no network needed).
  useEffect(() => {
    if (!el.current) return
    const map = L.map(el.current, { worldCopyJump: true, minZoom: 2, maxZoom: 18, zoomSnap: 1, preferCanvas: true, attributionControl: true })
    mapRef.current = map
    map.attributionControl.addAttribution('Place names: <a href="https://www.geonames.org">GeoNames</a> (CC BY 4.0)')
    let saved: { lat: number; lng: number; zoom: number } | null = null
    try {
      saved = JSON.parse(load(VIEW_KEY) ?? 'null')
    } catch {
      /* ignore */
    }
    map.setView(saved ? [saved.lat, saved.lng] : [30, 0], saved?.zoom ?? 2)
    pins.current = L.layerGroup().addTo(map)
    // Town names sit above the outlines and below the photo pins, and never catch the mouse.
    map.createPane('pv-labels').style.zIndex = '450'
    map.getPane('pv-labels')!.style.pointerEvents = 'none'
    labels.current = L.layerGroup([], { pane: 'pv-labels' }).addTo(map)
    void import('world-atlas/countries-50m.json').then((mod) => {
      const topo = (mod.default ?? mod) as unknown as Topology<{ countries: GeometryCollection }>
      const dark = document.documentElement.classList.contains('dark')
      L.geoJSON(feature(topo, topo.objects.countries), {
        interactive: false,
        style: { color: dark ? '#5f6368' : '#dadce0', weight: 0.8, fillColor: dark ? '#2d2e31' : '#f8f9fa', fillOpacity: 1 }
      })
        .addTo(map)
        .bringToBack()
    })
    const update = (): void => {
      setView(boxOf(map))
      setZoom(map.getZoom())
      const c = map.getCenter()
      save(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }))
    }
    map.on('moveend', update)
    update()
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Optional detailed map from OpenStreetMap (sends the visible area to tile.openstreetmap.org).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    save(DETAIL_KEY, detailed ? '1' : '0')
    if (online && !tiles.current) {
      tiles.current = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map)
    } else if (!online && tiles.current) {
      tiles.current.remove()
      tiles.current = null
    }
  }, [online, detailed])

  // Offline town names (bundled list), more of them as you zoom in; hidden over the detailed online map.
  useEffect(() => {
    const map = mapRef.current
    if (!view || !map || !labels.current) return
    labels.current.clearLayers()
    if (online) return
    let alive = true
    const minPopulation = [8e6, 8e6, 3e6, 1.2e6, 5e5, 2e5, 8e4, 3e4, 1.2e4, 5e3, 2e3][zoom] ?? 1000
    void api.mapPlaces({ south: view[0], west: view[1], north: view[2], east: view[3] }, minPopulation).then((towns) => {
      if (!alive || !labels.current) return
      const dark = document.documentElement.classList.contains('dark')
      const taken: Array<{ x: number; y: number }> = []
      for (const town of towns) {
        // Skip a name that would overlap a bigger town's (the list is biggest first).
        const p = map.latLngToContainerPoint([town.lat, town.lon])
        if (taken.some((q) => Math.abs(q.x - p.x) < 90 && Math.abs(q.y - p.y) < 22)) continue
        taken.push({ x: p.x, y: p.y })
        const big = town.population >= 1e6
        L.marker([town.lat, town.lon], {
          pane: 'pv-labels',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: '',
            iconSize: [0, 0],
            html: `<div style="position:absolute;left:-3px;top:-3px;display:flex;align-items:center;gap:4px;white-space:nowrap;font:${big ? 600 : 500} ${big ? 12 : 11}px system-ui,sans-serif;color:${dark ? '#dadce0' : '#3c4043'};text-shadow:0 0 3px ${dark ? '#202124' : '#f8f9fa'},0 0 3px ${dark ? '#202124' : '#f8f9fa'}"><span style="width:5px;height:5px;border-radius:50%;background:${dark ? '#9aa0a6' : '#80868b'};flex:none"></span>${town.name.replace(/[<>&]/g, '')}</div>`
          })
        }).addTo(labels.current)
      }
    })
    return () => {
      alive = false
    }
  }, [view, zoom, online])

  // Clusters for the visible area.
  useEffect(() => {
    if (!view) return
    let alive = true
    void api.mapClusters({ south: view[0], west: view[1], north: view[2], east: view[3], zoom }, base).then((clusters) => {
      if (!alive || !pins.current || !mapRef.current) return
      const map = mapRef.current
      pins.current.clearLayers()
      for (const c of clusters) {
        const m = L.marker([c.lat, c.lon], { icon: pinIcon(c), title: `${c.place ? `${c.place} · ` : ''}${plural(c.count, 'item')}` })
        m.on('click', () => {
          const [s, w, nn, e] = c.bounds
          const pad = 0.0005
          setSelected([s - pad, w - pad, nn + pad, e + pad])
          setSelectedPlace(c.place)
          if (c.count > 1 && map.getZoom() < 16 && (nn - s > 0.001 || e - w > 0.001)) map.fitBounds([[s, w], [nn, e]], { padding: [60, 60], maxZoom: 16 })
        })
        pins.current.addLayer(m)
      }
    })
    return () => {
      alive = false
    }
  }, [view, zoom, props.version])

  const panelBox = selected ?? view
  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <div ref={el} className="pv-map absolute inset-0" />
        <div className="no-drag absolute left-14 top-3 z-[500] flex items-center gap-2">
          <button
            onClick={() => setDetailed((d) => !d)}
            disabled={offline}
            title={
              offline
                ? t('Offline mode is on — the detailed map needs the internet.')
                : online
                ? t('Showing OpenStreetMap. Click to use the offline map (nothing is sent anywhere).')
                : t('Offline map. Click to show streets and places from OpenStreetMap (the visible area is requested from tile.openstreetmap.org).')
            }
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium shadow-md transition ${
              online ? 'bg-brass text-on-accent' : 'bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-60 dark:bg-stone-800 dark:text-stone-200'
            }`}
          >
            <Layers className="size-3.5" />
            {online ? t('Detailed map') : t('Offline map')}
          </button>
        </div>
        {located === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center">
            <div className="rounded-2xl bg-white/95 px-6 py-5 text-center shadow-xl dark:bg-stone-900/95">
              <MapPin className="mx-auto mb-2 size-6 text-ink-faint" />
              <div className="text-[14px] font-medium">{t('No photos with a location yet')}</div>
              <div className="mt-1 max-w-xs text-xs text-ink-muted">{t('Photos taken with location on, and Google Takeout or iCloud exports, appear here.')}</div>
            </div>
          </div>
        )}
      </div>
      <div className="flex w-[42%] min-w-[360px] max-w-[640px] flex-col border-l border-stone-200 dark:border-stone-800">
        {panelBox && (
          <AssetGrid
            key={JSON.stringify(panelBox)}
            version={props.version}
            query={{ ...base, bbox: panelBox }}
            title={selected ? (selectedPlace?.split(',')[0] ?? t('This place')) : t('In view')}
            subtitle={located !== null ? t('{located} items have a location', { located: n(located) }) : undefined}
            toolbar={
              selected ? (
                <button
                  onClick={() => setSelected(null)}
                  className="-ml-2.5 inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  <X className="size-3.5" />{' '}{t('Back to everything in view')}</button>
              ) : undefined
            }
            empty={<NoMatches title={t('Nothing here')} body={t('Move or zoom the map to see the photos taken in that area.')} />}
          />
        )}
      </div>
    </div>
  )
}
