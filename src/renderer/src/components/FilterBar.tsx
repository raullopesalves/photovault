import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PromptDialog } from './Dialog'
import { Wand2, ArrowDownUp, Calendar, Camera, Check, ChevronDown, Film, LoaderCircle, Sparkles, FolderInput, Heart, Search, Smartphone, X } from 'lucide-react'
import type { AssetQuery, Facets } from '@shared/types'
import { api, n, sourceTypeLabel } from '../lib/format'
import { kindLabel, originLabel } from '../lib/labels'

type TypeValue = NonNullable<AssetQuery['types']>[number]
type CameraId = { make: string | null; model: string }

const TYPE_LABEL: Record<TypeValue, string> = { photo: 'Photos', video: 'Videos', loop: 'GIF-like loops', animated: 'Animated images', sticker: 'Stickers' }

function cameraLabel(c: CameraId): string {
  return c.make && !c.model.toLowerCase().startsWith(c.make.toLowerCase()) ? `${c.make} ${c.model}` : c.model
}

const sameCamera = (a: CameraId, b: CameraId): boolean => a.model === b.model && (a.make ?? null) === (b.make ?? null)

function toggle<T>(list: T[] | undefined, value: T, eq: (a: T, b: T) => boolean = (a, b) => a === b): T[] | undefined {
  const cur = list ?? []
  const next = cur.some((x) => eq(x, value)) ? cur.filter((x) => !eq(x, value)) : [...cur, value]
  return next.length ? next : undefined
}

/**
 * Search field + multi-select filter menus, with the active filters shown as removable badges underneath.
 * Within one menu any ticked value matches (OR); different menus combine (AND).
 */
export function FilterBar(props: { query: AssetQuery; onChange: (q: AssetQuery) => void; version: number; hideFavorite?: boolean }) {
  const [facets, setFacets] = useState<Facets | null>(null)
  const [text, setText] = useState(props.query.text ?? props.query.smartText ?? '')
  const [smart, setSmart] = useState(props.query.smartText !== undefined)
  const [smartReady, setSmartReady] = useState(false)
  const [searching, setSearching] = useState(false)
  const q = props.query

  useEffect(() => {
    void api.facets().then(setFacets)
    void api.smartSearchStatus().then((s) => setSmartReady(!!s && s.enabled && s.indexed > 0))
  }, [props.version])

  // Keep the field in sync when the query is cleared from outside (badges, "Clear all").
  useEffect(() => {
    const current = q.text ?? q.smartText ?? ''
    if (current !== text.trim()) setText(current)
  }, [q.text, q.smartText])

  // Debounce typing so every keystroke doesn't re-query the library.
  useEffect(() => {
    const value = text.trim()
    const t = setTimeout(
      () => {
        if (!smart) {
          if ((q.text ?? '') !== value || q.smartText !== undefined)
            props.onChange({ ...q, text: value || undefined, ids: undefined, smartText: undefined, sort: q.sort === 'relevance' ? undefined : q.sort })
          return
        }
        if ((q.smartText ?? '') === value && q.text === undefined) return
        if (!value) return props.onChange({ ...q, text: undefined, ids: undefined, smartText: undefined, sort: q.sort === 'relevance' ? undefined : q.sort })
        setSearching(true)
        void api
          .smartSearch(value)
          .then((ids) => props.onChange({ ...q, text: undefined, ids, smartText: value, sort: q.sort === 'taken' ? 'taken' : 'relevance' }))
          .finally(() => setSearching(false))
      },
      smart ? 450 : 220
    )
    return () => clearTimeout(t)
  }, [text, smart])

  const set = (patch: Partial<AssetQuery>): void => props.onChange({ ...q, ...patch })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const typeOptions: Array<{ value: TypeValue; count?: number }> = [
    { value: 'photo' },
    { value: 'video', count: facets?.videos },
    ...(facets?.kinds ?? [])
      .filter((k) => k.kind === 'loop' || k.kind === 'animated' || k.kind === 'sticker')
      .map((k) => ({ value: k.kind as TypeValue, count: k.count }))
  ]

  const badges: Array<{ key: string; label: ReactNode; remove: () => void }> = []
  if (q.text) badges.push({ key: 'text', label: <>“{q.text}”</>, remove: () => set({ text: undefined }) })
  if (q.smartText !== undefined)
    badges.push({
      key: 'smart',
      label: (
        <>
          <Sparkles className="size-3" /> Looks like “{q.smartText}”
        </>
      ),
      remove: () => set({ ids: undefined, smartText: undefined, sort: q.sort === 'relevance' ? undefined : q.sort })
    })
  if (q.favorite && !props.hideFavorite) badges.push({ key: 'fav', label: 'Favourites', remove: () => set({ favorite: undefined }) })
  for (const t of q.types ?? []) badges.push({ key: `t:${t}`, label: TYPE_LABEL[t], remove: () => set({ types: toggle(q.types, t) }) })
  for (const y of q.years ?? []) badges.push({ key: `y:${y}`, label: y === 0 ? 'No date' : String(y), remove: () => set({ years: toggle(q.years, y) }) })
  for (const c of q.cameras ?? []) badges.push({ key: `c:${c.make}|${c.model}`, label: cameraLabel(c), remove: () => set({ cameras: toggle(q.cameras, c, sameCamera) }) })
  for (const o of q.origins ?? []) badges.push({ key: `o:${o}`, label: `From: ${originLabel(o)}`, remove: () => set({ origins: toggle(q.origins, o) }) })
  for (const s of q.sourceTypes ?? []) badges.push({ key: `s:${s}`, label: `Source: ${sourceTypeLabel(s)}`, remove: () => set({ sourceTypes: toggle(q.sourceTypes, s) }) })

  const clearAll = (): void => {
    setText('')
    set({ text: undefined, ids: undefined, smartText: undefined, sort: q.sort === 'relevance' ? undefined : q.sort, favorite: undefined, types: undefined, years: undefined, cameras: undefined, origins: undefined, sourceTypes: undefined })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 w-72 items-center gap-2 rounded-lg bg-stone-200/60 px-2.5 text-stone-500 ring-accent-500 focus-within:bg-white focus-within:ring-2 dark:bg-stone-800/80 dark:focus-within:bg-stone-900">
          <Search className="size-3.5 shrink-0" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setText('')}
            placeholder={smart ? 'Describe it: beach at sunset, dog, cake…' : 'Search names, cameras, albums, years'}
            className="min-w-0 flex-1 select-text bg-transparent text-[13px] text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100"
          />
          {searching && <LoaderCircle className="size-3.5 shrink-0 animate-spin" />}
          {smartReady && (
            <button
              onClick={() => setSmart((s) => !s)}
              title={smart ? 'Smart search: finds photos by what they show. Click to search names instead.' : 'Search by what photos show (on-device AI)'}
              aria-label="Smart search"
              aria-pressed={smart}
              className={`grid size-6 shrink-0 place-items-center rounded-md transition ${smart ? 'bg-accent-500 text-white' : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'}`}
            >
              <Sparkles className="size-3.5" />
            </button>
          )}
          {text && (
            <button onClick={() => setText('')} aria-label="Clear search" className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
              <X className="size-3.5" />
            </button>
          )}
        </label>

        <button
          onClick={() =>
            set({ sort: q.ids ? (q.sort === 'relevance' ? 'taken' : 'relevance') : q.sort === 'added' ? undefined : 'added' })
          }
          title={
            q.sort === 'relevance'
              ? 'Best matches first. Click to order by date taken.'
              : q.sort === 'added'
                ? 'Showing the newest imports first. Click to order by date taken.'
                : q.ids
                  ? 'Ordered by date taken. Click to show the best matches first.'
                  : 'Ordered by date taken. Click to show the newest imports first.'
          }
          className={`${chipBase} ${q.sort === 'added' || q.sort === 'relevance' ? chipOn : chipOff}`}
        >
          <ArrowDownUp className="size-3.5" />
          {q.sort === 'relevance' ? 'Best match' : q.sort === 'added' ? 'Recently added' : 'Date taken'}
        </button>

        {!props.hideFavorite && (
          <button onClick={() => set({ favorite: q.favorite ? undefined : true })} className={`${chipBase} ${q.favorite ? chipOn : chipOff}`}>
            <Heart className={`size-3.5 ${q.favorite ? 'fill-current' : ''}`} />
            Favourites{facets ? ` ${n(facets.favorites)}` : ''}
          </button>
        )}

        <Menu
          icon={<Film className="size-3.5" />}
          label="Type"
          selected={q.types?.length ?? 0}
          options={typeOptions.map((o) => ({
            key: o.value,
            label: o.value === 'photo' || o.value === 'video' ? TYPE_LABEL[o.value] : kindLabel(o.value, true),
            count: o.count,
            checked: q.types?.includes(o.value) ?? false,
            onToggle: () => set({ types: toggle(q.types, o.value) })
          }))}
        />

        <Menu
          icon={<Calendar className="size-3.5" />}
          label="Year"
          selected={q.years?.length ?? 0}
          options={(facets?.years ?? []).map((y) => ({
            key: String(y.year),
            label: y.year === 0 ? 'No date' : String(y.year),
            count: y.count,
            checked: q.years?.includes(y.year) ?? false,
            onToggle: () => set({ years: toggle(q.years, y.year) })
          }))}
        />

        {(facets?.cameras.length ?? 0) > 0 && (
          <Menu
            icon={<Camera className="size-3.5" />}
            label="Camera"
            selected={q.cameras?.length ?? 0}
            options={(facets?.cameras ?? []).map((c) => ({
              key: `${c.make}|${c.model}`,
              label: cameraLabel(c),
              count: c.count,
              checked: q.cameras?.some((x) => sameCamera(x, c)) ?? false,
              onToggle: () => set({ cameras: toggle(q.cameras, { make: c.make, model: c.model }, sameCamera) })
            }))}
          />
        )}

        {(facets?.origins.length ?? 0) > 0 && (
          <Menu
            icon={<Smartphone className="size-3.5" />}
            label="Origin"
            selected={q.origins?.length ?? 0}
            options={(facets?.origins ?? []).map((o) => ({
              key: o.origin,
              label: originLabel(o.origin),
              count: o.count,
              checked: q.origins?.includes(o.origin) ?? false,
              onToggle: () => set({ origins: toggle(q.origins, o.origin) })
            }))}
          />
        )}

        {(facets?.sources.length ?? 0) > 1 && (
          <Menu
            icon={<FolderInput className="size-3.5" />}
            label="Source"
            selected={q.sourceTypes?.length ?? 0}
            options={(facets?.sources ?? []).map((s) => ({
              key: s.type,
              label: sourceTypeLabel(s.type),
              count: s.count,
              checked: q.sourceTypes?.includes(s.type) ?? false,
              onToggle: () => set({ sourceTypes: toggle(q.sourceTypes, s.type) })
            }))}
          />
        )}
      </div>

      {badges.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 animate-fade-in">
          {badges.map((b) => (
            <span
              key={b.key}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-50 pl-3 pr-1 text-[12.5px] font-medium text-accent-600 ring-1 ring-accent-100 dark:bg-accent-500/15 dark:text-accent-400 dark:ring-accent-500/20"
            >
              {b.label}
              <button onClick={b.remove} aria-label="Remove filter" className="grid size-5 place-items-center rounded-full hover:bg-accent-100 dark:hover:bg-accent-500/25">
                <X className="size-3" />
              </button>
            </span>
          ))}
          {badges.some((b) => b.key !== 'smart') && (
            <button
              onClick={() => setSaving(true)}
              className="ml-1 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-500/10"
              title="Save these filters as an album that fills itself"
            >
              <Wand2 className="size-3.5" /> Save as smart album
            </button>
          )}
          {badges.length > 1 && (
            <button
              onClick={clearAll}
              className="ml-1 h-7 rounded-full px-2.5 text-[12.5px] font-medium text-stone-500 hover:bg-stone-200/60 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              Clear all
            </button>
          )}
        </div>
      )}
      {saving && (
        <PromptDialog
          title="Save as smart album"
          label="It shows everything matching these filters — now and whenever new photos match."
          placeholder="Album name"
          confirm="Save"
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            setSaving(false)
            await api.createSmartAlbum(name, q)
            setSaved(name)
            window.setTimeout(() => setSaved(null), 2500)
          }}
        />
      )}
      {saved && <div className="mt-2 text-[12.5px] text-emerald-600 dark:text-emerald-400">Saved “{saved}” — find it in Albums.</div>}
    </div>
  )
}

const chipBase = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition'
const chipOff = 'bg-stone-200/60 text-stone-700 hover:bg-stone-200 dark:bg-stone-800/80 dark:text-stone-300 dark:hover:bg-stone-800'
const chipOn = 'bg-stone-900 text-white dark:bg-white dark:text-stone-900'

/** A dropdown of checkboxes. Stays open while ticking several values; closes on outside click or Escape. */
function Menu(props: {
  icon: ReactNode
  label: string
  selected: number
  options: Array<{ key: string; label: string; count?: number; checked: boolean; onToggle: () => void }>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const active = props.selected > 0
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={`${chipBase} ${active ? chipOn : chipOff}`} aria-expanded={open}>
        {props.icon}
        {props.label}
        {active && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-white/25 px-1 text-[10.5px] tabular-nums dark:bg-stone-900/20">{props.selected}</span>}
        <ChevronDown className={`size-3.5 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="scroll-thin absolute left-0 top-full z-20 mt-1.5 max-h-80 min-w-52 overflow-y-auto rounded-xl bg-white p-1.5 shadow-xl shadow-stone-950/15 ring-1 ring-stone-200 animate-rise-in dark:bg-stone-800 dark:ring-white/10">
          {props.options.length === 0 && <div className="px-3 py-2 text-[12.5px] text-stone-400">Nothing yet</div>}
          {props.options.map((o) => (
            <button
              key={o.key}
              role="menuitemcheckbox"
              aria-checked={o.checked}
              onClick={o.onToggle}
              className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] text-stone-800 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-700/70"
            >
              <span
                className={`grid size-4 shrink-0 place-items-center rounded border transition ${
                  o.checked ? 'border-accent-500 bg-accent-500 text-white' : 'border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900'
                }`}
              >
                {o.checked && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="flex-1">{o.label}</span>
              {o.count !== undefined && <span className="text-[12px] tabular-nums text-stone-400">{n(o.count)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
