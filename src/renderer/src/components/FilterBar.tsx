import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PromptDialog } from './Dialog'
import { Album, Wand2, ArrowDownUp, Calendar, Camera, Check, ChevronDown, Film, Sparkles, FolderInput, Heart, Map as MapIcon, Play, SlidersHorizontal, Smartphone, Users, X } from 'lucide-react'
import { SearchBox, type SearchLabels } from './SearchBox'
import type { AssetQuery, Facets } from '@shared/types'
import { api, n, sourceTypeLabel } from '../lib/format'
import { kindLabel, originLabel } from '../lib/labels'
import { t } from '../lib/i18n'

type TypeValue = NonNullable<AssetQuery['types']>[number]
type CameraId = { make: string | null; model: string }

const TYPE_LABEL: Record<TypeValue, string> = { photo: t('Photos'), video: t('Videos'), loop: t('GIF-like loops'), animated: t('Animated images'), sticker: t('Stickers') }

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
export function FilterBar(props: {
  query: AssetQuery
  onChange: (q: AssetQuery) => void
  version: number
  /** What the view itself shows (Photos without screenshots, one album…): the filter counts are counted within it. */
  base?: AssetQuery
  hideFavorite?: boolean
  hideOrigin?: boolean
}) {
  const [facets, setFacets] = useState<Facets | null>(null)
  const [labels, setLabels] = useState<SearchLabels>({})
  const q = props.query

  const baseKey = JSON.stringify(props.base ?? {})
  useEffect(() => {
    void api.facets(props.base).then(setFacets)
  }, [props.version, baseKey])

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
          <Sparkles className="size-3" />{' '}{t('Looks like “')}{q.smartText}”
        </>
      ),
      remove: () => set({ ids: undefined, smartText: undefined, sort: q.sort === 'relevance' ? undefined : q.sort })
    })
  if (typeof q.personId === 'number' && props.base?.personId === undefined) badges.push({ key: 'person', label: <><Users className="size-3" />{' '}{labels.person || t('Person')}</>, remove: () => set({ personId: undefined }) })
  if (q.place) badges.push({ key: 'place', label: <><MapIcon className="size-3" />{' '}{q.place}</>, remove: () => set({ place: undefined }) })
  if (typeof q.albumId === 'number' && props.base?.albumId === undefined) badges.push({ key: 'album', label: <><Album className="size-3" />{' '}{labels.album || t('Album')}</>, remove: () => set({ albumId: undefined }) })
  if (q.favorite && !props.hideFavorite) badges.push({ key: 'fav', label: t('Favourites'), remove: () => set({ favorite: undefined }) })
  for (const t of q.types ?? []) badges.push({ key: `t:${t}`, label: TYPE_LABEL[t], remove: () => set({ types: toggle(q.types, t) }) })
  for (const y of q.years ?? []) badges.push({ key: `y:${y}`, label: y === 0 ? t('No date') : String(y), remove: () => set({ years: toggle(q.years, y) }) })
  for (const c of q.cameras ?? []) badges.push({ key: `c:${c.make}|${c.model}`, label: cameraLabel(c), remove: () => set({ cameras: toggle(q.cameras, c, sameCamera) }) })
  for (const o of q.origins ?? []) badges.push({ key: `o:${o}`, label: t('From: {v0}', { v0: originLabel(o) }), remove: () => set({ origins: toggle(q.origins, o) }) })
  for (const s of q.sourceTypes ?? []) badges.push({ key: `s:${s}`, label: t('Source: {v0}', { v0: sourceTypeLabel(s) }), remove: () => set({ sourceTypes: toggle(q.sourceTypes, s) }) })

  const clearAll = (): void => {
    set({
      text: undefined,
      ids: undefined,
      smartText: undefined,
      sort: q.sort === 'relevance' ? undefined : q.sort,
      personId: undefined,
      place: undefined,
      albumId: undefined,
      favorite: undefined,
      types: undefined,
      years: undefined,
      cameras: undefined,
      origins: undefined,
      sourceTypes: undefined
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox query={q} onChange={props.onChange} onLabels={(l) => setLabels((old) => ({ ...old, ...l }))} version={props.version} />

        <button
          onClick={() =>
            set({ sort: q.ids ? (q.sort === 'relevance' ? 'taken' : 'relevance') : q.sort === 'added' ? undefined : 'added' })
          }
          title={
            q.sort === 'relevance'
              ? t('Best matches first. Click to order by date taken.')
              : q.sort === 'added'
                ? t('Showing the newest imports first. Click to order by date taken.')
                : q.ids
                  ? t('Ordered by date taken. Click to show the best matches first.')
                  : t('Ordered by date taken. Click to show the newest imports first.')
          }
          className={`${chipBase} ${q.sort === 'added' || q.sort === 'relevance' ? chipOn : chipOff}`}
        >
          <ArrowDownUp className="size-3.5" />
          {q.sort === 'relevance' ? t('Best match') : q.sort === 'added' ? t('Recently added') : t('Date taken')}
        </button>

        {!props.hideFavorite && (
          <button onClick={() => set({ favorite: q.favorite ? undefined : true })} className={`${chipBase} ${q.favorite ? chipOn : chipOff}`}>
            <Heart className={`size-3.5 ${q.favorite ? 'fill-current' : ''}`} />{t('Favourites')}{facets ? ` ${n(facets.favorites)}` : ''}
          </button>
        )}

        {!q.types?.length || (q.types.length === 1 && q.types[0] === 'video') ? (
          <button onClick={() => set({ types: q.types?.includes('video') ? undefined : ['video'] })} className={`${chipBase} ${q.types?.includes('video') ? chipOn : chipOff}`}>
            <Play className={`size-3.5 ${q.types?.includes('video') ? 'fill-current' : ''}`} />
            {t('Videos')}
            {facets ? <span className="font-mono text-[12px] opacity-75">{n(facets.videos)}</span> : null}
          </button>
        ) : null}

        <FiltersMenu
          sections={[
            {
              key: 'type',
              icon: <Film className="size-3.5" />,
              label: t('Type'),
              options: typeOptions.map((o) => ({
                key: o.value,
                label: o.value === 'photo' || o.value === 'video' ? TYPE_LABEL[o.value] : kindLabel(o.value, true),
                count: o.count,
                checked: q.types?.includes(o.value) ?? false,
                onToggle: () => set({ types: toggle(q.types, o.value) })
              }))
            },
            {
              key: 'year',
              icon: <Calendar className="size-3.5" />,
              label: t('Year'),
              options: (facets?.years ?? []).map((y) => ({
                key: String(y.year),
                label: y.year === 0 ? t('No date') : String(y.year),
                count: y.count,
                checked: q.years?.includes(y.year) ?? false,
                onToggle: () => set({ years: toggle(q.years, y.year) })
              }))
            },
            ...((facets?.cameras.length ?? 0) > 0
              ? [
                  {
                    key: 'camera',
                    icon: <Camera className="size-3.5" />,
                    label: t('Camera'),
                    options: (facets?.cameras ?? []).map((c) => ({
                      key: `${c.make}|${c.model}`,
                      label: cameraLabel(c),
                      count: c.count,
                      checked: q.cameras?.some((x) => sameCamera(x, c)) ?? false,
                      onToggle: () => set({ cameras: toggle(q.cameras, { make: c.make, model: c.model }, sameCamera) })
                    }))
                  }
                ]
              : []),
            ...(!props.hideOrigin && (facets?.origins.length ?? 0) > 0
              ? [
                  {
                    key: 'origin',
                    icon: <Smartphone className="size-3.5" />,
                    label: t('Origin'),
                    options: (facets?.origins ?? []).map((o) => ({
                      key: o.origin,
                      label: originLabel(o.origin),
                      count: o.count,
                      checked: q.origins?.includes(o.origin) ?? false,
                      onToggle: () => set({ origins: toggle(q.origins, o.origin) })
                    }))
                  }
                ]
              : []),
            ...((facets?.sources.length ?? 0) > 1
              ? [
                  {
                    key: 'source',
                    icon: <FolderInput className="size-3.5" />,
                    label: t('Source'),
                    options: (facets?.sources ?? []).map((src) => ({
                      key: src.type,
                      label: sourceTypeLabel(src.type),
                      count: src.count,
                      checked: q.sourceTypes?.includes(src.type) ?? false,
                      onToggle: () => set({ sourceTypes: toggle(q.sourceTypes, src.type) })
                    }))
                  }
                ]
              : [])
          ]}
        />
      </div>

      {badges.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 animate-fade-in">
          {badges.map((b) => (
            <span
              key={b.key}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-50 pl-3 pr-1 text-[12.5px] font-medium text-accent-600 ring-1 ring-accent-100 dark:bg-accent-500/15 dark:text-accent-400 dark:ring-accent-500/20"
            >
              {b.label}
              <button onClick={b.remove} aria-label={t('Remove filter')} className="grid size-5 place-items-center rounded-full hover:bg-accent-100 dark:hover:bg-accent-500/25">
                <X className="size-3" />
              </button>
            </span>
          ))}
          {badges.some((b) => b.key !== 'smart') && (
            <button
              onClick={() => setSaving(true)}
              className="ml-1 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-500/10"
              title={t('Save these filters as an album that fills itself')}
            >
              <Wand2 className="size-3.5" />{' '}{t('Save as smart album')}</button>
          )}
          {badges.length > 1 && (
            <button
              onClick={clearAll}
              className="ml-1 h-7 rounded-full px-2.5 text-[12.5px] font-medium text-stone-500 hover:bg-stone-200/60 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >{t('Clear all')}</button>
          )}
        </div>
      )}
      {saving && (
        <PromptDialog
          title={t('Save as smart album')}
          label={t('It shows everything matching these filters — now and whenever new photos match.')}
          placeholder={t('Album name')}
          confirm={t('Save')}
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            setSaving(false)
            await api.createSmartAlbum(name, q)
            setSaved(name)
            window.setTimeout(() => setSaved(null), 2500)
          }}
        />
      )}
      {saved && <div className="mt-2 text-[12.5px] text-emerald-600 dark:text-emerald-400">{t('Saved “')}{saved}{t('” — find it in Albums.')}</div>}
    </div>
  )
}

const chipBase = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition'
const chipOff = 'bg-stone-200/60 text-stone-700 hover:bg-stone-200 dark:bg-stone-800/80 dark:text-stone-300 dark:hover:bg-stone-800'
const chipOn = 'bg-stone-900 text-white dark:bg-white dark:text-stone-900'

interface Option {
  key: string
  label: string
  count?: number
  checked: boolean
  onToggle: () => void
}

/** One "Filters" chip for every filter: a panel with each filter's values side by side, ticked values counted on the chip. */
function FiltersMenu(props: { sections: Array<{ key: string; icon: ReactNode; label: string; options: Option[] }> }) {
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
  // Opening the panel moves focus to its first option; closing it (Escape) returns it to the chip.
  const panel = useRef<HTMLDivElement>(null)
  const chip = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('[role="checkbox"]')?.focus({ preventScroll: true })
    return () => {
      if (!document.activeElement || document.activeElement === document.body || panel.current?.contains(document.activeElement)) chip.current?.focus({ preventScroll: true })
    }
  }, [open])
  const selected = props.sections.reduce((sum, sec) => sum + sec.options.filter((o) => o.checked).length, 0)
  return (
    <div ref={ref} className="relative">
      <button ref={chip} onClick={() => setOpen((o) => !o)} className={`${chipBase} ${selected ? chipOn : chipOff}`} aria-expanded={open} aria-haspopup="dialog">
        <SlidersHorizontal className="size-3.5" />
        {t('Filters')}
        {selected > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-white/25 px-1 font-mono text-[10.5px] tabular-nums dark:bg-stone-900/20">{selected}</span>}
        <ChevronDown className={`size-3.5 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label={t('Filters')}
          className="absolute right-0 top-full z-20 mt-1.5 grid w-[612px] grid-cols-3 gap-x-1 gap-y-3 rounded-[14px] border border-line bg-card p-2 shadow-[0_6px_20px_rgba(26,30,27,0.12)] animate-pop"
        >
          {props.sections.map((sec) => (
            <section key={sec.key} className="flex min-w-0 flex-col">
              <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-1.5 text-[11px] font-[650] uppercase leading-[14px] tracking-[0.07em] text-ink-muted">
                {sec.icon}
                {sec.label}
              </div>
              <div className="scroll-thin max-h-56 overflow-y-auto">
                {sec.options.length === 0 && <div className="px-2.5 py-1.5 text-[12.5px] text-ink-muted">{t('Nothing yet')}</div>}
                {sec.options.map((o) => (
                  <button
                    key={o.key}
                    role="checkbox"
                    aria-checked={o.checked}
                    onClick={o.onToggle}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-shelf"
                  >
                    <span className={`grid size-4 shrink-0 place-items-center rounded border transition ${o.checked ? 'border-brass bg-brass text-on-accent' : 'border-line-strong bg-card'}`}>
                      {o.checked && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.count !== undefined && <span className="font-mono text-[12px] tabular-nums text-ink-muted">{n(o.count)}</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

