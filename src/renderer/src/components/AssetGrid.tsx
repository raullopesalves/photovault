import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Album, CalendarClock, Check, Eye, EyeOff, Heart, HeartOff, ImageMinus, ImageUp, Minus, MapPin, MoreHorizontal, Play, Plus, RotateCcw, RotateCw, FolderOutput, Printer, Share2, Tag, Trash2, UserX, X } from 'lucide-react'
import type { AlbumSummary, AssetQuery, AssetSummary, TimelineGroup } from '@shared/types'
import { api, monthLabel, n, plural } from '../lib/format'
import { Tile } from './Tile'
import { Lightbox } from './Lightbox'
import { Slideshow } from './Slideshow'
import { DateDialog, PrintDialog, PromptDialog, ShareDialog } from './Dialog'
import { LocationPicker } from './LocationPicker'
import { BinDeleteDialog } from './BinDelete'
import { t } from '../lib/i18n'

const PAGE = 240
const ZOOM_SIZES = [116, 168, 236, 320]
const GAP = 4
const PAD_X = 28
const MONTH_H = 60

type Row = { kind: 'header'; month: string; count: number; start: number } | { kind: 'tiles'; start: number; count: number }

interface CacheEntry {
  gen: number
  items: AssetSummary[]
}

function loadZoom(): number {
  try {
    const raw = localStorage.getItem('pv.zoom')
    const v = raw === null ? Number.NaN : Number(raw)
    return Number.isInteger(v) && v >= 0 && v < ZOOM_SIZES.length ? v : 1
  } catch {
    return 1
  }
}

/** Lazily fetched, page-cached view of a (filtered) timeline, ordered exactly like its month groups. */
function usePages(version: number, query: AssetQuery | undefined, queryKey: string) {
  const cache = useRef(new Map<number, CacheEntry>())
  const inflight = useRef(new Set<string>())
  const gen = useRef(0)
  const queryRef = useRef(query)
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const lastKey = useRef(queryKey)

  // New data (version) keeps stale pages visible until refetched; a new query starts from scratch.
  useMemo(() => {
    gen.current++
    queryRef.current = query
    if (lastKey.current !== queryKey) {
      cache.current.clear()
      lastKey.current = queryKey
    }
  }, [version, queryKey])

  const ensure = useCallback((from: number, to: number) => {
    const first = Math.floor(Math.max(0, from) / PAGE)
    const last = Math.floor(Math.max(0, to) / PAGE)
    for (let p = first; p <= last; p++) {
      const entry = cache.current.get(p)
      const g = gen.current
      const key = `${g}:${p}`
      if ((entry && entry.gen === g) || inflight.current.has(key)) continue
      inflight.current.add(key)
      void api
        .assetsPage(p * PAGE, PAGE, queryRef.current)
        .then((items) => {
          if (g !== gen.current && cache.current.get(p)?.gen === gen.current) return
          cache.current.set(p, { gen: g, items })
          rerender()
        })
        .finally(() => inflight.current.delete(key))
    }
  }, [])

  const get = useCallback((index: number): AssetSummary | undefined => cache.current.get(Math.floor(index / PAGE))?.items[index % PAGE], [])
  return { ensure, get }
}

export function AssetGrid(props: {
  version: number
  query?: AssetQuery
  title: ReactNode
  subtitle?: ReactNode
  /** Rendered under the title (search, filters). */
  toolbar?: ReactNode
  /** Extra buttons next to the zoom control. */
  actions?: ReactNode
  /** Shown instead of the grid when nothing matches. */
  empty: ReactNode
  /** Inside an album: enables "Remove from album" and "Use as cover". */
  albumId?: number
  /** On a person's page: enables "Not this person". */
  personId?: number
  /** 'bin': the selection bar offers Restore / Delete permanently instead of the usual actions. */
  mode?: 'normal' | 'bin'
}) {
  const queryKey = JSON.stringify(props.query ?? {})
  const [groups, setGroups] = useState<TimelineGroup[] | null>(null)
  const [zoom, setZoom] = useState(loadZoom)
  const [width, setWidth] = useState(0)
  const [headerH, setHeaderH] = useState(64)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [slideshow, setSlideshow] = useState<number | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null)
  const [selected, setSelected] = useState<Map<number, number>>(new Map()) // assetId -> index
  const anchor = useRef<number | null>(null)
  const pages = usePages(props.version, props.query, queryKey)

  useEffect(() => {
    let alive = true
    void api.timeline(props.query).then((g) => alive && setGroups(g))
    return () => {
      alive = false
    }
  }, [props.version, queryKey])

  // A different filter is a different list: drop the selection and go back to the top.
  useEffect(() => {
    setSelected(new Map())
    anchor.current = null
    scrollEl?.scrollTo(0, 0)
  }, [queryKey])

  useLayoutEffect(() => {
    if (!scrollEl) return
    const ro = new ResizeObserver(() => setWidth(scrollEl.clientWidth))
    ro.observe(scrollEl)
    setWidth(scrollEl.clientWidth)
    return () => ro.disconnect()
  }, [scrollEl])

  useLayoutEffect(() => {
    if (!headerEl) return
    const ro = new ResizeObserver(() => setHeaderH(headerEl.offsetHeight))
    ro.observe(headerEl)
    setHeaderH(headerEl.offsetHeight)
    return () => ro.disconnect()
  }, [headerEl])

  useEffect(() => {
    try {
      localStorage.setItem('pv.zoom', String(zoom))
    } catch {
      /* per-viewer convenience only */
    }
  }, [zoom])

  const target = ZOOM_SIZES[zoom] as number
  const inner = Math.max(0, width - PAD_X * 2)
  const cols = Math.max(2, Math.floor((inner + GAP) / (target + GAP)))
  const tile = inner > 0 ? (inner - GAP * (cols - 1)) / cols : target
  const total = useMemo(() => (groups ?? []).reduce((s, d) => s + d.count, 0), [groups])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    let offset = 0
    for (const d of groups ?? []) {
      out.push({ kind: 'header', month: d.month, count: d.count, start: offset })
      for (let i = 0; i < d.count; i += cols) out.push({ kind: 'tiles', start: offset + i, count: Math.min(cols, d.count - i) })
      offset += d.count
    }
    return out
  }, [groups, cols])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? MONTH_H : tile + GAP),
    overscan: 4,
    scrollMargin: headerH
  })

  useEffect(() => {
    virtualizer.measure()
  }, [tile, rows, headerH, virtualizer])

  const items = virtualizer.getVirtualItems()
  let firstIdx = Number.POSITIVE_INFINITY
  let lastIdx = -1
  for (const vi of items) {
    const r = rows[vi.index]
    if (r?.kind === 'tiles') {
      firstIdx = Math.min(firstIdx, r.start)
      lastIdx = Math.max(lastIdx, r.start + r.count - 1)
    }
  }
  useEffect(() => {
    if (lastIdx >= 0) pages.ensure(firstIdx, lastIdx)
  })

  // Ctrl/Cmd + wheel zooms the grid, like other photo apps.
  useEffect(() => {
    const el = scrollEl
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setZoom((z) => Math.min(ZOOM_SIZES.length - 1, Math.max(0, z + (e.deltaY < 0 ? 1 : -1))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scrollEl])

  /** Adds (or, with remove, drops) a contiguous timeline range — fetching ids for parts not loaded yet. */
  const selectRange = useCallback(
    async (from: number, to: number, remove = false) => {
      const ids = await api.assetIdsInRange(props.query, from, to - from + 1)
      setSelected((prev) => {
        const next = new Map(prev)
        ids.forEach((id, k) => (remove ? next.delete(id) : next.set(id, from + k)))
        return next
      })
    },
    [queryKey]
  )

  const toggle = useCallback(
    (index: number, shift: boolean) => {
      const asset = pages.get(index)
      if (!asset) return
      if (shift && anchor.current !== null && anchor.current !== index) {
        // Shift-click: everything between the last clicked photo and this one, even if not loaded yet.
        const [a, b] = anchor.current < index ? [anchor.current, index] : [index, anchor.current]
        void selectRange(a, b)
      } else {
        setSelected((prev) => {
          const next = new Map(prev)
          if (next.has(asset.id)) next.delete(asset.id)
          else next.set(asset.id, index)
          return next
        })
      }
      anchor.current = index
    },
    [pages, selectRange]
  )

  const clearSelection = useCallback(() => {
    setSelected(new Map())
    anchor.current = null
  }, [])

  useEffect(() => {
    if (openIndex !== null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape' && selected.size > 0) clearSelection()
      // Ctrl/Cmd+A: select everything in this view (all filters applied).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && total > 0) {
        e.preventDefault()
        void selectRange(0, total - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected.size, openIndex, clearSelection, selectRange, total])

  const selecting = selected.size > 0
  const showEmpty = groups !== null && total === 0

  return (
    <div className="relative h-full">
      <div ref={setScrollEl} className="scroll-thin h-full overflow-y-auto">
        <header
          ref={setHeaderEl}
          className="drag sticky top-0 z-10 bg-stone-50/80 px-7 pb-3 pr-40 pt-5 backdrop-blur-xl dark:bg-stone-950/75"
        >
          <div className="flex min-h-[40px] items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate font-[family-name:var(--font-display)] text-[22px] font-semibold tracking-tight">{props.title}</h1>
              {props.subtitle && <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{props.subtitle}</div>}
            </div>
            <div className="no-drag flex shrink-0 items-center gap-3">
              {props.actions}
              {groups !== null && total > 0 && props.mode !== 'bin' && (
                <button
                  onClick={() => setSlideshow(selected.size ? Math.min(...selected.values()) : 0)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-stone-600 transition hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800"
                  title={t('Slideshow')}
                >
                  <Play className="size-3.5 fill-current" />{' '}{t('Slideshow')}</button>
              )}
              {groups !== null && total > 0 && <span className="text-xs tabular-nums text-stone-500 dark:text-stone-400">{plural(total, 'item')}</span>}
              <div className="flex items-center rounded-lg bg-stone-200/60 p-0.5 dark:bg-stone-800/80">
                <button
                  aria-label={t('Smaller thumbnails')}
                  disabled={zoom === 0}
                  onClick={() => setZoom((z) => Math.max(0, z - 1))}
                  className="grid size-7 place-items-center rounded-md text-stone-600 transition hover:bg-white disabled:opacity-30 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  <Minus className="size-3.5" />
                </button>
                <button
                  aria-label={t('Larger thumbnails')}
                  disabled={zoom === ZOOM_SIZES.length - 1}
                  onClick={() => setZoom((z) => Math.min(ZOOM_SIZES.length - 1, z + 1))}
                  className="grid size-7 place-items-center rounded-md text-stone-600 transition hover:bg-white disabled:opacity-30 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
          {props.toolbar && <div className="no-drag mt-3">{props.toolbar}</div>}
        </header>

        {showEmpty ? (
          <div className="px-7 py-10">{props.empty}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize() + 96, position: 'relative' }}>
            {items.map((vi) => {
              const row = rows[vi.index]
              if (!row) return null
              const top = vi.start - headerH
              if (row.kind === 'header') {
                return (
                  <div key={vi.key} className="group/month absolute inset-x-0 flex items-end px-7 pb-2.5" style={{ top, height: MONTH_H }}>
                    {(() => {
                      // Select the whole month: all its items are selected when every loaded one is.
                      let all = true
                      for (let i = row.start; i < row.start + row.count && all; i++) {
                        const a = pages.get(i)
                        if (!a || !selected.has(a.id)) all = false
                      }
                      return (
                        <button
                          onClick={() => void selectRange(row.start, row.start + row.count - 1, all)}
                          title={all ? t('Deselect this month') : t('Select this month')}
                          aria-label={all ? t('Deselect this month') : t('Select this month')}
                          className={`-ml-6 mr-1.5 mb-[3px] grid size-[18px] place-items-center rounded-full transition ${
                            all
                              ? 'bg-accent-500 text-white opacity-100'
                              : `border-2 border-stone-400 text-transparent hover:border-accent-500 dark:border-stone-500 ${selecting ? 'opacity-100' : 'opacity-0 group-hover/month:opacity-100'}`
                          }`}
                        >
                          <Check className="size-3" strokeWidth={3} />
                        </button>
                      )
                    })()}
                    <span className="font-[family-name:var(--font-display)] text-[17px] font-semibold tracking-tight text-stone-800 dark:text-stone-100">
                      {props.query?.sort === 'added' ? t('Added {v0}', { v0: monthLabel(row.month) }) : monthLabel(row.month)}
                    </span>
                    <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">{n(row.count)}</span>
                    {row.month === 'undated' && (
                      <span className="ml-3 truncate text-xs text-stone-500 dark:text-stone-400">{t('No date in the files and none could be inferred — sorted by file date. Recognise some? Select them and use “Set date”.')}</span>
                    )}
                  </div>
                )
              }
              return (
                <div key={vi.key} className="absolute flex" style={{ top, left: PAD_X, gap: GAP, height: tile }}>
                  {Array.from({ length: row.count }, (_, i) => {
                    const index = row.start + i
                    const asset = pages.get(index)
                    return (
                      <Tile
                        key={asset ? `a${asset.id}` : `s${index}`}
                        asset={asset}
                        size={tile}
                        selected={asset ? selected.has(asset.id) : false}
                        selecting={selecting}
                        onOpen={() => setOpenIndex(index)}
                        onToggle={(shift) => toggle(index, shift)}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selecting && props.mode === 'bin' && <BinSelectionBar ids={[...selected.keys()]} onDone={clearSelection} />}
      {selecting && props.mode !== 'bin' && (
        <SelectionBar
          ids={[...selected.keys()]}
          allFavorite={[...selected.values()].every((i) => pages.get(i)?.favorite)}
          allHidden={[...selected.values()].every((i) => pages.get(i)?.hidden)}
          albumId={props.albumId}
          personId={props.personId}
          onDone={clearSelection}
        />
      )}

      {openIndex !== null && (
        <Lightbox
          key="lightbox"
          index={openIndex}
          total={total}
          getSummary={pages.get}
          ensure={pages.ensure}
          version={props.version}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
      {slideshow !== null && (
        <Slideshow total={total} startIndex={slideshow} getSummary={pages.get} ensure={pages.ensure} onClose={() => setSlideshow(null)} />
      )}
    </div>
  )
}

const barBtnClass =
  'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium text-white/90 transition hover:bg-white/15 hover:text-white disabled:opacity-40'

function BinSelectionBar(props: { ids: number[]; onDone: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const count = props.ids.length
  return (
    <>
      <div className="no-drag fixed bottom-6 left-[calc(50%+114px)] z-30 -translate-x-1/2 animate-rise-in">
        <div className="flex items-center gap-1 rounded-full bg-stone-900/95 py-1.5 pl-2 pr-1.5 shadow-2xl shadow-stone-950/30 backdrop-blur dark:bg-stone-800/95 dark:ring-1 dark:ring-white/10">
          <button onClick={props.onDone} className="grid size-8 place-items-center rounded-full text-white/70 hover:bg-white/15 hover:text-white" aria-label={t('Clear selection')}>
            <X className="size-4" />
          </button>
          <span className="whitespace-nowrap px-2 text-[13px] font-semibold tabular-nums text-white">{n(count)}{' '}{t('selected')}</span>
          <div className="mx-1 h-5 w-px bg-white/15" />
          <button
            className={barBtnClass}
            onClick={async () => {
              await api.restoreFromBin(props.ids)
              props.onDone()
            }}
          >
            <RotateCcw className="size-4" />{' '}{t('Restore')}</button>
          <button className={`${barBtnClass} text-red-300 hover:text-red-200`} onClick={() => setDeleting(true)}>
            <Trash2 className="size-4" />{' '}{t('Delete permanently')}</button>
        </div>
      </div>
      {deleting && (
        <BinDeleteDialog
          ids={props.ids}
          count={count}
          onClose={(deleted) => {
            setDeleting(false)
            if (deleted) props.onDone()
          }}
        />
      )}
    </>
  )
}

function SelectionBar(props: { ids: number[]; allFavorite: boolean; allHidden: boolean; albumId?: number; personId?: number; onDone: () => void }) {
  const [picker, setPicker] = useState(false)
  const [naming, setNaming] = useState(false)
  const [dating, setDating] = useState(false)
  const [more, setMore] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  // Close the More menu on any click outside it (a backdrop would be clipped by the bar's transform).
  useEffect(() => {
    if (!more) return
    const close = (e: MouseEvent): void => {
      if (!moreRef.current?.contains(e.target as Node)) setMore(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMore(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [more])
  const [sharing, setSharing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [undo, setUndo] = useState<(() => Promise<void>) | null>(null)
  const count = props.ids.length

  const flash = (msg: string, undoAction?: () => Promise<void>): void => {
    setToast(msg)
    setUndo(() => undoAction ?? null)
    setTimeout(
      () => {
        setToast(null)
        setUndo(null)
        props.onDone()
      },
      undoAction ? 5000 : 1100
    )
  }

  const barBtn =
    'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium text-white/90 transition hover:bg-white/15 hover:text-white disabled:opacity-40'

  return (
    <>
      <div className="no-drag fixed bottom-6 left-[calc(50%+114px)] z-30 -translate-x-1/2 animate-rise-in">
        {toast ? (
          <div className="flex items-center gap-3 rounded-full bg-stone-900/95 py-2 pl-5 pr-2 text-[13px] font-medium text-white shadow-2xl backdrop-blur dark:bg-stone-800/95">
            {toast}
            {undo && (
              <button
                onClick={async () => {
                  const u = undo
                  setUndo(null)
                  setToast(t('Undone'))
                  await u()
                }}
                className="rounded-full px-3 py-1 text-accent-400 hover:bg-white/10"
              >{t('Undo')}</button>
            )}
            {!undo && <span className="w-3" />}
          </div>
        ) : (
          <div className="relative flex items-center gap-1 rounded-full bg-stone-900/95 py-1.5 pl-2 pr-1.5 shadow-2xl shadow-stone-950/30 backdrop-blur dark:bg-stone-800/95 dark:ring-1 dark:ring-white/10">
            <button onClick={props.onDone} className="grid size-8 place-items-center rounded-full text-white/70 hover:bg-white/15 hover:text-white" aria-label={t('Clear selection')}>
              <X className="size-4" />
            </button>
            <span className="whitespace-nowrap px-2 text-[13px] font-semibold tabular-nums text-white">{n(count)}{' '}{t('selected')}</span>
            <div className="mx-1 h-5 w-px bg-white/15" />
            <button
              className={barBtn}
              onClick={async () => {
                await api.setFavorites(props.ids, !props.allFavorite)
                flash(props.allFavorite ? t('Removed from favourites') : t('{count} added to favourites', { count: plural(count, 'item') }))
              }}
            >
              {props.allFavorite ? <HeartOff className="size-4" /> : <Heart className="size-4" />}
              {props.allFavorite ? t('Unfavourite') : t('Favourite')}
            </button>
            <button className={barBtn} onClick={() => setPicker((p) => !p)}>
              <Album className="size-4" />{' '}{t('Add to album')}</button>
            <button className={barBtn} onClick={() => setSharing(true)} title={t('Prepare copies to send (chat, email…)')}>
              <Share2 className="size-4" />{' '}{t('Share')}</button>
            <button
              className={barBtn}
              title={props.allHidden ? t('Show in the Photos timeline again') : t('Remove from the Photos timeline (nothing is deleted)')}
              onClick={async () => {
                await api.setHidden(props.ids, !props.allHidden)
                flash(props.allHidden ? t('{count} shown in Photos', { count: plural(count, 'item') }) : t('{count} hidden from Photos', { count: plural(count, 'item') }))
              }}
            >
              {props.allHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              {props.allHidden ? t('Unhide') : t('Hide')}
            </button>
            <button
              className={barBtn}
              title={t('Move to the Bin — restore it from there, or delete permanently')}
              onClick={async () => {
                const ids = props.ids
                await api.moveToBin(ids)
                flash(t('{length} moved to Bin', { length: plural(ids.length, 'item') }), async () => {
                  await api.restoreFromBin(ids)
                })
              }}
            >
              <Trash2 className="size-4" />{' '}{t('Bin')}</button>
            <div className="relative" ref={moreRef}>
              <button className={barBtn} onClick={() => setMore((m) => !m)} aria-label={t('More actions')}>
                <MoreHorizontal className="size-4" />{' '}{t('More')}</button>
              {more && (
                <>
                  <div className="absolute bottom-12 right-0 z-20 w-56 rounded-xl bg-stone-900/95 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur dark:bg-stone-800/95">
                    {[
                      { label: t('Set date…'), icon: <CalendarClock className="size-4" />, run: () => setDating(true) },
                      { label: t('Set location…'), icon: <MapPin className="size-4" />, run: () => setPlacing(true) },
                      { label: t('Add tags…'), icon: <Tag className="size-4" />, run: () => setTagging(true) },
                      {
                        label: t('Rotate'),
                        icon: <RotateCw className="size-4" />,
                        run: async () => {
                          await api.rotate(props.ids, 90)
                          flash(t('{count} rotated', { count: plural(count, 'item') }))
                        }
                      },
                      { label: t('Print or photo book…'), icon: <Printer className="size-4" />, run: () => setPrinting(true) },
                      {
                        label: t('Export originals…'),
                        icon: <FolderOutput className="size-4" />,
                        run: async () => {
                          const off = api.onExportProgress((p) => setToast(t('Exporting {done} of {total}…', { done: n(p.done), total: n(p.total) })))
                          try {
                            const r = await api.exportOriginals(props.ids)
                            if (!r) return
                            flash(r.failed > 0 ? t('Exported {exported} · {failed} failed', { exported: n(r.exported), failed: n(r.failed) }) : t('{exported} exported', { exported: plural(r.exported, 'file') }))
                          } catch (err) {
                            flash(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('Export failed'))
                          } finally {
                            off()
                          }
                        }
                      }
                    ].map((a) => (
                      <button
                        key={a.label}
                        onClick={() => {
                          setMore(false)
                          void a.run()
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-white/90 hover:bg-white/10"
                      >
                        <span className="text-white/60">{a.icon}</span>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {props.personId !== undefined && (
              <button
                className={barBtn}
                title={t('These photos are not of this person (they will not be added back automatically)')}
                onClick={async () => {
                  const n = await api.removeFromPerson(props.personId as number, props.ids)
                  flash(n ? t('Removed from this person') : t('Nothing to remove'))
                }}
              >
                <UserX className="size-4" />{' '}{t('Not this person')}</button>
            )}
            {props.albumId !== undefined && (
              <>
                {count === 1 && (
                  <button
                    className={barBtn}
                    onClick={async () => {
                      await api.updateAlbum(props.albumId as number, { coverAssetId: props.ids[0] as number })
                      flash(t('Album cover updated'))
                    }}
                  >
                    <ImageUp className="size-4" />{' '}{t('Use as cover')}</button>
                )}
                <button
                  className={barBtn}
                  onClick={async () => {
                    await api.removeFromAlbum(props.albumId as number, props.ids)
                    flash(t('{count} removed from album', { count: plural(count, 'item') }))
                  }}
                >
                  <ImageMinus className="size-4" />{' '}{t('Remove from album')}</button>
              </>
            )}
            {picker && (
              <AlbumPicker
                excludeId={props.albumId}
                onClose={() => setPicker(false)}
                onNew={() => {
                  setPicker(false)
                  setNaming(true)
                }}
                onPick={async (album) => {
                  setPicker(false)
                  const added = await api.addToAlbum(album.id, props.ids)
                  flash(added === 0 ? t('Already in “{name}”', { name: album.name }) : t('{added} added to “{name}”', { added: plural(added, 'item'), name: album.name }))
                }}
              />
            )}
          </div>
        )}
      </div>
      {dating && (
        <DateDialog
          title={t('Set date for {count}', { count: plural(count, 'item') })}
          label={t('Use this when you recognise when photos were taken. Hand-set dates are marked as set by you and are never overwritten automatically.')}
          onClose={() => setDating(false)}
          onSubmit={async (wall) => {
            setDating(false)
            await api.setDates(props.ids, wall)
            flash(t('Date set for {count}', { count: plural(count, 'item') }))
          }}
        />
      )}
      {printing && (
        <PrintDialog
          count={count}
          title={t('Photos')}
          onClose={() => setPrinting(false)}
          onMake={async (layout, title) => {
            setPrinting(false)
            const off = api.onExportProgress((p) => setToast(t('Preparing the PDF… {done} of {total}', { done: n(p.done), total: n(p.total) })))
            try {
              const r = await api.photoBook(props.ids, title, layout)
              if (r) flash(t('PDF ready: {pages} pages', { pages: n(r.pages) }))
              else setToast(null)
            } catch (err) {
              flash(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('Export failed'))
            } finally {
              off()
            }
          }}
        />
      )}
      {sharing && (
        <ShareDialog
          count={count}
          onClose={() => setSharing(false)}
          onShare={async (opts) => {
            setSharing(false)
            setToast(t('Preparing {count}…', { count: plural(count, 'copy', 'copies') }))
            const r = await api.share(props.ids, opts)
            flash(r.failed ? t('{files} ready · {failed} failed', { files: plural(r.files, 'copy', 'copies'), failed: n(r.failed) }) : t('{files} ready in the folder that opened', { files: plural(r.files, 'copy', 'copies') }))
          }}
        />
      )}
      {tagging && (
        <PromptDialog
          title={t('Add tags to {count}', { count: plural(count, 'item') })}
          label={t('Separate several tags with commas. Tags are searchable.')}
          placeholder={t('e.g. beach, family')}
          confirm={t('Add tags')}
          onClose={() => setTagging(false)}
          onSubmit={async (value) => {
            setTagging(false)
            const tags = value.split(',').map((t) => t.trim()).filter(Boolean)
            if (!tags.length) return
            await api.setTags(props.ids, tags, [])
            flash(t('Tagged {count}', { count: plural(count, 'item') }))
          }}
        />
      )}
      {placing && (
        <LocationPicker
          title={count === 1 ? t('Where was this taken?') : t('Where were these {count} taken?', { count: n(count) })}
          initial={null}
          onClose={() => setPlacing(false)}
          onPick={async (loc) => {
            setPlacing(false)
            await api.setLocation(props.ids, loc)
            flash(t('Location set for {count}', { count: plural(count, 'item') }))
          }}
        />
      )}
      {naming && (
        <PromptDialog
          title={t('New album')}
          label={t('Create an album with the {count}.', { count: plural(count, 'selected item') })}
          placeholder={t('Album name')}
          confirm={t('Create')}
          onClose={() => setNaming(false)}
          onSubmit={async (name) => {
            setNaming(false)
            const album = await api.createAlbum(name, props.ids)
            flash(t('Created “{name}”', { name: album.name }))
          }}
        />
      )}
    </>
  )
}

function AlbumPicker(props: { excludeId?: number; onPick: (a: AlbumSummary) => void; onNew: () => void; onClose: () => void }) {
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void api.albums().then((a) => setAlbums(a.filter((x) => x.id !== props.excludeId)))
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) props.onClose()
    }
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', close)
    }
  }, [])
  return (
    <div
      ref={ref}
      className="absolute bottom-full left-1/2 mb-3 w-72 -translate-x-1/2 overflow-hidden rounded-xl bg-white p-1.5 shadow-2xl shadow-stone-950/20 ring-1 ring-stone-200 animate-rise-in dark:bg-stone-800 dark:ring-white/10"
    >
      <button onClick={props.onNew} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium text-accent-600 hover:bg-stone-100 dark:text-accent-400 dark:hover:bg-stone-700/70">
        <Plus className="size-4" />{' '}{t('New album…')}</button>
      <div className="scroll-thin max-h-72 overflow-y-auto">
        {albums === null && <div className="skeleton m-2 h-4 w-40 rounded" />}
        {albums?.map((a) => (
          <button
            key={a.id}
            onClick={() => props.onPick(a)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-700/70"
          >
            <span className="size-8 shrink-0 overflow-hidden rounded-md bg-stone-200 dark:bg-stone-700">
              {a.coverAssetId && a.coverThumb === 'ready' && <img src={`pv-media://thumb/${a.coverAssetId}`} alt="" className="size-full object-cover" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-stone-900 dark:text-stone-100">{a.name}</span>
              <span className="block text-[11.5px] text-stone-500 dark:text-stone-400">{plural(a.count, 'item')}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
