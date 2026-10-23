import { useEffect, useRef, useState } from 'react'
import { ModalPanel } from './Modal'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { Layers, MapPin, X } from 'lucide-react'
import { t } from '../lib/i18n'

/**
 * Pick a place on a map (click to drop the pin, or type coordinates). Offline country outlines by default;
 * "Detailed map" loads OpenStreetMap tiles for streets and towns.
 */
export function LocationPicker(props: {
  title: string
  initial: { lat: number; lon: number } | null
  onPick: (loc: { lat: number; lon: number }) => void
  onRemove?: () => void
  onClose: () => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const tiles = useRef<L.TileLayer | null>(null)
  const [pos, setPos] = useState(props.initial)
  const [text, setText] = useState(props.initial ? `${props.initial.lat.toFixed(5)}, ${props.initial.lon.toFixed(5)}` : '')
  const [detailed, setDetailed] = useState(() => {
    try {
      return localStorage.getItem('pv.map.detailed') === '1'
    } catch {
      return false
    }
  })

  const place = (lat: number, lon: number, pan = false): void => {
    setPos({ lat, lon })
    setText(`${lat.toFixed(5)}, ${lon.toFixed(5)}`)
    const icon = L.divIcon({ className: 'pv-pin', iconSize: [28, 28], iconAnchor: [14, 28], html: '<div class="pv-drop"></div>' })
    if (!marker.current) marker.current = L.marker([lat, lon], { icon }).addTo(map.current as L.Map)
    else marker.current.setLatLng([lat, lon])
    if (pan) map.current?.setView([lat, lon], Math.max(map.current.getZoom(), 12))
  }

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { worldCopyJump: true, minZoom: 2, maxZoom: 18 })
    map.current = m
    m.setView(props.initial ? [props.initial.lat, props.initial.lon] : [39.5, -8], props.initial ? 12 : 5)
    void import('world-atlas/countries-50m.json').then((mod) => {
      const topo = (mod.default ?? mod) as unknown as Topology<{ countries: GeometryCollection }>
      const dark = document.documentElement.classList.contains('dark')
      L.geoJSON(feature(topo, topo.objects.countries), {
        interactive: false,
        style: { color: dark ? '#57534e' : '#d6d3d1', weight: 0.8, fillColor: dark ? '#292524' : '#fafaf9', fillOpacity: 1 }
      })
        .addTo(m)
        .bringToBack()
    })
    m.on('click', (e: L.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng))
    if (props.initial) place(props.initial.lat, props.initial.lon)
    return () => {
      m.remove()
      map.current = null
      marker.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    try {
      localStorage.setItem('pv.map.detailed', detailed ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (detailed && !tiles.current) {
      tiles.current = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(m)
    } else if (!detailed && tiles.current) {
      tiles.current.remove()
      tiles.current = null
    }
  }, [detailed])

  const parsed = (() => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text)
    if (!m) return null
    const lat = Number(m[1])
    const lon = Number(m[2])
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
  })()

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/50 backdrop-blur-sm animate-fade-in" onClick={props.onClose}>
      <ModalPanel className="flex h-[78vh] w-[860px] max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-white text-stone-900 shadow-2xl dark:bg-stone-900 dark:text-stone-100" onClick={(e) => e.stopPropagation()} aria-label={props.title}>
        <div className="flex items-center gap-3 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
          <MapPin className="size-4 text-stone-400" />
          <div className="flex-1 text-[15px] font-semibold">{props.title}</div>
          <button onClick={props.onClose} className="grid size-8 place-items-center rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label={t('Close')}>
            <X className="size-4" />
          </button>
        </div>
        <div className="relative flex-1">
          <div ref={el} className="pv-map absolute inset-0" />
          <button
            onClick={() => setDetailed((d) => !d)}
            className={`absolute left-14 top-3 z-[500] inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium shadow-md ${
              detailed ? 'bg-accent-500 text-on-accent' : 'bg-white text-stone-700 dark:bg-stone-800 dark:text-stone-200'
            }`}
            title={detailed ? t('OpenStreetMap (the visible area is requested from tile.openstreetmap.org)') : t('Offline map — click for streets and towns')}
          >
            <Layers className="size-3.5" /> {detailed ? t('Detailed map') : t('Offline map')}
          </button>
        </div>
        <div className="flex items-center gap-2 border-t border-stone-100 px-5 py-3 dark:border-stone-800">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && parsed && place(parsed.lat, parsed.lon, true)}
            placeholder={t('Click the map, or type latitude, longitude')}
            className="h-9 w-72 rounded-lg bg-stone-100 px-3 text-[13px] outline-none ring-accent-500 focus:ring-2 dark:bg-stone-800"
          />
          {parsed && (!pos || parsed.lat !== pos.lat || parsed.lon !== pos.lon) && (
            <button onClick={() => place(parsed.lat, parsed.lon, true)} className="h-9 rounded-lg px-3 text-[12.5px] font-medium text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-500/10">{t('Go')}</button>
          )}
          <div className="flex-1" />
          {props.onRemove && (
            <button onClick={props.onRemove} className="h-9 rounded-lg px-3 text-[13px] font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">{t('Remove location')}</button>
          )}
          <button onClick={props.onClose} className="h-9 rounded-lg px-4 text-[13px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800">{t('Cancel')}</button>
          <button
            disabled={!pos}
            onClick={() => pos && props.onPick(pos)}
            className="h-9 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white hover:bg-stone-800 disabled:opacity-40 dark:bg-white dark:text-stone-900"
          >{t('Save location')}</button>
        </div>
      </ModalPanel>
    </div>
  )
}
