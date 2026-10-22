import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Album, LoaderCircle, Map as MapIcon, Search, Sparkles, Users, X } from 'lucide-react'
import type { AlbumSummary, AssetQuery, Person } from '@shared/types'
import { api, mediaUrl, n } from '../lib/format'
import { t } from '../lib/i18n'

/** Labels for the filters a search result sets, shown as badges by the filter bar. */
export interface SearchLabels {
  person?: string
  album?: string
}

interface Row {
  key: string
  group: string
  icon: ReactNode
  title: ReactNode
  meta?: string
  pick: () => void
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/**
 * One search box for everything. Typing filters by name, camera, album and year as before; the panel also offers
 * people, places, smart search ("photos that look like …") and albums. Ctrl K focuses it from anywhere.
 */
export function SearchBox(props: { query: AssetQuery; onChange: (q: AssetQuery) => void; onLabels: (l: SearchLabels) => void; version: number }) {
  const q = props.query
  const [text, setText] = useState(q.text ?? q.smartText ?? '')
  const [mode, setMode] = useState<'name' | 'smart'>(q.smartText !== undefined ? 'smart' : 'name')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const [smartReady, setSmartReady] = useState(false)
  const [people, setPeople] = useState<Person[]>([])
  const [albums, setAlbums] = useState<AlbumSummary[]>([])
  const [places, setPlaces] = useState<Array<{ place: string; count: number }>>([])
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.smartSearchStatus().then((s) => setSmartReady(!!s && s.enabled && s.indexed > 0))
    void api.people().then(setPeople).catch(() => setPeople([]))
    void api.albums().then(setAlbums)
    void api.libraryPlaces().then(setPlaces)
  }, [props.version])

  // Ctrl K (Cmd K) focuses the search from anywhere in the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  // Keep the field in sync when the query is cleared from outside (badges, "Clear all").
  useEffect(() => {
    const current = q.text ?? q.smartText ?? ''
    if (current !== text.trim() && !(current === '' && open)) setText(current)
    if (q.smartText === undefined && mode === 'smart') setMode('name')
  }, [q.text, q.smartText])

  // Name search follows the typing (debounced so every keystroke doesn't re-query the library).
  useEffect(() => {
    if (mode !== 'name') return
    const value = text.trim()
    const timer = setTimeout(() => {
      if ((q.text ?? '') !== value || q.smartText !== undefined)
        props.onChange({ ...q, text: value || undefined, ids: undefined, smartText: undefined, sort: q.sort === 'relevance' ? undefined : q.sort })
    }, 220)
    return () => clearTimeout(timer)
  }, [text, mode])

  const value = text.trim()
  const done = (patch: Partial<AssetQuery>, labels?: SearchLabels): void => {
    setOpen(false)
    setText('')
    setMode('name')
    props.onChange({ ...q, text: undefined, ids: undefined, smartText: undefined, sort: q.sort === 'relevance' ? undefined : q.sort, ...patch })
    if (labels) props.onLabels(labels)
  }

  const rows = useMemo<Row[]>(() => {
    if (!value) return []
    const f = fold(value)
    const out: Row[] = [
      {
        key: 'text',
        group: '',
        icon: <Search className="size-4" />,
        title: t('Names, cameras and dates matching “{v0}”', { v0: value }),
        pick: () => setOpen(false)
      }
    ]
    for (const p of people.filter((p) => p.name && fold(p.name).includes(f)).slice(0, 3))
      out.push({
        key: `p${p.id}`,
        group: t('People'),
        icon: <Users className="size-4" />,
        title: p.name,
        meta: n(p.photos),
        pick: () => done({ personId: p.id }, { person: p.name ?? '' })
      })
    for (const pl of places.filter((pl) => fold(pl.place).includes(f)).slice(0, 3))
      out.push({ key: `l${pl.place}`, group: t('Places'), icon: <MapIcon className="size-4" />, title: pl.place, meta: n(pl.count), pick: () => done({ place: pl.place }) })
    if (smartReady)
      out.push({
        key: 'smart',
        group: t('Things'),
        icon: <Sparkles className="size-4" />,
        title: t('Photos that look like “{v0}”', { v0: value }),
        pick: () => {
          setOpen(false)
          setMode('smart')
          setSearching(true)
          void api
            .smartSearch(value)
            .then((ids) => props.onChange({ ...q, text: undefined, ids, smartText: value, sort: q.sort === 'taken' ? 'taken' : 'relevance' }))
            .finally(() => setSearching(false))
        }
      })
    for (const a of albums.filter((a) => fold(a.name).includes(f)).slice(0, 3))
      out.push({
        key: `a${a.id}`,
        group: t('Albums'),
        icon: a.coverAssetId && a.coverThumb === 'ready' ? <img src={mediaUrl('thumb', a.coverAssetId, '')} alt="" className="size-6 rounded-[2px] object-cover" /> : <Album className="size-4" />,
        title: a.name,
        meta: n(a.count),
        pick: () => done({ albumId: a.id }, { album: a.name })
      })
    return out
  }, [value, people, places, albums, smartReady, q])

  useEffect(() => setActive(0), [value])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault()
      setOpen(true)
      setActive((a) => (a + 1) % rows.length)
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault()
      setActive((a) => (a - 1 + rows.length) % rows.length)
    } else if (e.key === 'Enter' && open && rows[active]) {
      e.preventDefault()
      rows[active].pick()
    } else if (e.key === 'Escape') {
      if (open) setOpen(false)
      else {
        setText('')
        setMode('name')
      }
    }
  }

  const showPanel = open && rows.length > 1
  return (
    <div ref={box} className="relative w-[320px] max-w-full">
      <label
        className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-ink-muted transition-[background-color,border-color,box-shadow] duration-[var(--dur-quick)] ${
          showPanel ? 'border-line-strong bg-card shadow-[0_6px_20px_rgba(26,30,27,0.10)]' : 'border-transparent bg-shelf focus-within:border-line-strong focus-within:bg-card'
        }`}
      >
        {mode === 'smart' ? <Sparkles className="size-4 shrink-0 text-brass-ink" /> : <Search className="size-4 shrink-0" />}
        <input
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setMode('name')
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('Search photos, people, places')}
          aria-label={t('Search')}
          aria-expanded={showPanel}
          aria-controls="search-results"
          role="combobox"
          className="min-w-0 flex-1 select-text bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-muted"
        />
        {searching && <LoaderCircle className="size-3.5 shrink-0 animate-spin" />}
        {text ? (
          <button
            onClick={() => {
              setText('')
              setMode('name')
            }}
            aria-label={t('Clear search')}
            className="text-ink-muted hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <span className="rounded-[4px] border border-line px-1.5 py-[3px] font-mono text-[11px] leading-none">Ctrl K</span>
        )}
      </label>
      {showPanel && (
        <div
          id="search-results"
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-[14px] border border-line bg-card p-1.5 shadow-[0_6px_20px_rgba(26,30,27,0.12)] animate-pop"
        >
          {rows.map((r, i) => (
            <div key={r.key}>
              {r.group && r.group !== rows[i - 1]?.group && (
                <div className="px-2 pb-1 pt-2 text-[11px] font-[650] uppercase leading-[14px] tracking-[0.07em] text-ink-muted">{r.group}</div>
              )}
              <button
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={r.pick}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[14px] text-ink ${i === active ? 'bg-shelf' : ''}`}
              >
                <span className="grid size-6 shrink-0 place-items-center text-ink-muted">{r.icon}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                {r.meta && <span className="font-mono text-[12px] tabular-nums text-ink-muted">{r.meta}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
