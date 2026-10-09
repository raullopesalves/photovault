import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Crop, FlipHorizontal2, LoaderCircle, RotateCcw, RotateCw, SlidersHorizontal, Sparkles, Undo2, X } from 'lucide-react'
import type { PhotoEdits } from '@shared/types'
import { api } from '../lib/format'

type Tab = 'crop' | 'adjust' | 'filters'
type Box = NonNullable<PhotoEdits['crop']>
const FULL: Box = { x: 0, y: 0, w: 1, h: 1 }

const FILTER_LIST: Array<{ id: PhotoEdits['filter'] | undefined; label: string }> = [
  { id: undefined, label: 'None' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'fade', label: 'Fade' },
  { id: 'bw', label: 'B&W' },
  { id: 'sepia', label: 'Sepia' }
]
const ASPECTS: Array<{ label: string; ratio: number | 'original' | null }> = [
  { label: 'Free', ratio: null },
  { label: 'Original', ratio: 'original' },
  { label: 'Square', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 }
]
const SLIDERS: Array<{ key: 'light' | 'contrast' | 'color' | 'warmth'; label: string }> = [
  { key: 'light', label: 'Light' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'color', label: 'Colour' },
  { key: 'warmth', label: 'Warmth' }
]

/**
 * Non-destructive photo editor: crop, rotate, flip, light/contrast/colour/warmth and filters. Previews are
 * rendered by the main process with the same code as the saved result; saving only stores instructions.
 */
export function Editor(props: { assetId: number; onClose: (saved: boolean) => void }) {
  const [tab, setTab] = useState<Tab>('adjust')
  const [rotation, setRotation] = useState(0)
  const [edits, setEdits] = useState<PhotoEdits>({})
  const [saved, setSaved] = useState<{ rotation: number; edits: PhotoEdits | null } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filterThumbs, setFilterThumbs] = useState<Record<string, string>>({})
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    void api.editState(props.assetId).then((s) => {
      setSaved(s)
      setRotation(s.rotation)
      setEdits(s.edits ?? {})
    })
  }, [props.assetId])

  // Live preview (debounced). In the crop tab the whole picture is shown, with the crop box on top.
  useEffect(() => {
    if (!saved) return
    let alive = true
    const t = window.setTimeout(() => {
      void api.editPreview(props.assetId, rotation, edits, { skipCrop: tab === 'crop', size: 1600 }).then((url) => alive && setPreview(url))
    }, 90)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [saved, rotation, JSON.stringify(edits), tab === 'crop'])

  // Small previews for the filter buttons (current adjustments, crop included).
  useEffect(() => {
    if (tab !== 'filters' || !saved) return
    let alive = true
    void (async () => {
      const out: Record<string, string> = {}
      for (const f of FILTER_LIST) {
        out[f.id ?? 'none'] = await api.editPreview(props.assetId, rotation, { ...edits, filter: f.id }, { size: 160 })
        if (!alive) return
        setFilterThumbs({ ...out })
      }
    })()
    return () => {
      alive = false
    }
  }, [tab, saved, rotation, edits.crop, edits.light, edits.contrast, edits.color, edits.warmth, edits.flip])

  const set = (patch: Partial<PhotoEdits>): void => setEdits((e) => ({ ...e, ...patch }))
  const changed = !!saved && (rotation !== saved.rotation || JSON.stringify(clean(edits)) !== JSON.stringify(clean(saved.edits ?? {})))

  const rotate = (deg: number): void => {
    setRotation((r) => (r + deg + 360) % 360)
    // Keep the crop on the same part of the picture.
    const c = edits.crop
    if (c) set({ crop: deg === 90 ? { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w } })
  }

  const save = async (next: { rotation: number; edits: PhotoEdits | null }): Promise<void> => {
    setBusy(true)
    try {
      await api.saveEdits(props.assetId, next.rotation, next.edits)
      props.onClose(true)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose(false)
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && changed) void save({ rotation, edits: clean(edits) })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tabBtn = (t: Tab, label: string, icon: React.ReactNode): React.ReactNode => (
    <button
      onClick={() => setTab(t)}
      className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11.5px] font-medium transition ${tab === t ? 'bg-white/10 text-white' : 'text-stone-400 hover:text-stone-200'}`}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className="no-drag fixed inset-0 z-50 flex bg-stone-950 text-stone-100 animate-fade-in">
      <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-10">
        {preview ? (
          tab === 'crop' ? (
            <CropView src={preview} box={edits.crop ?? FULL} onBox={(b) => set({ crop: b })} aspect={null} onNatural={setNatural} />
          ) : (
            <img src={preview} alt="" className="max-h-full max-w-full select-none object-contain" draggable={false} />
          )
        ) : (
          <LoaderCircle className="size-6 animate-spin text-stone-500" />
        )}
      </div>

      <aside className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-stone-900">
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <div className="text-[15px] font-semibold">Edit</div>
          <button onClick={() => props.onClose(false)} className="grid size-8 place-items-center rounded-full hover:bg-white/10" aria-label="Cancel">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex gap-1 px-4">
          {tabBtn('crop', 'Crop & rotate', <Crop className="size-4" />)}
          {tabBtn('adjust', 'Adjust', <SlidersHorizontal className="size-4" />)}
          {tabBtn('filters', 'Filters', <Sparkles className="size-4" />)}
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5">
          {tab === 'crop' && (
            <div className="space-y-5">
              <div className="flex gap-2">
                <ToolBtn onClick={() => rotate(-90)} label="Rotate left">
                  <RotateCcw className="size-4" />
                </ToolBtn>
                <ToolBtn onClick={() => rotate(90)} label="Rotate right">
                  <RotateCw className="size-4" />
                </ToolBtn>
                <ToolBtn onClick={() => set({ flip: !edits.flip })} label="Flip" active={!!edits.flip}>
                  <FlipHorizontal2 className="size-4" />
                </ToolBtn>
              </div>
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">Aspect ratio</div>
                <div className="flex flex-wrap gap-1.5">
                  {ASPECTS.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => {
                        if (a.ratio === null || !natural) return set({ crop: edits.crop })
                        const ratio = a.ratio === 'original' ? natural.w / natural.h : a.ratio
                        set({ crop: fitAspect(edits.crop ?? FULL, ratio, natural) })
                      }}
                      className="rounded-full bg-white/10 px-3 py-1 text-[12px] hover:bg-white/20"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-xs leading-relaxed text-stone-500">Drag the corners or the frame. The parts outside are only hidden; the original stays complete.</div>
              {edits.crop && (
                <button onClick={() => set({ crop: undefined })} className="text-[12.5px] font-medium text-accent-400 hover:text-accent-300">
                  Reset crop
                </button>
              )}
            </div>
          )}
          {tab === 'adjust' && (
            <div className="space-y-6">
              {SLIDERS.map((s) => (
                <label key={s.key} className="block">
                  <div className="mb-1.5 flex justify-between text-[12.5px]">
                    <span>{s.label}</span>
                    <span className="tabular-nums text-stone-500">{Math.round((edits[s.key] ?? 0) * 100)}</span>
                  </div>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={Math.round((edits[s.key] ?? 0) * 100)}
                    onChange={(e) => set({ [s.key]: Number(e.target.value) / 100 })}
                    onDoubleClick={() => set({ [s.key]: undefined })}
                    className="w-full accent-accent-500"
                  />
                </label>
              ))}
              <div className="text-xs text-stone-500">Double-click a slider to reset it.</div>
            </div>
          )}
          {tab === 'filters' && (
            <div className="grid grid-cols-3 gap-3">
              {FILTER_LIST.map((f) => {
                const key = f.id ?? 'none'
                const on = (edits.filter ?? undefined) === f.id
                return (
                  <button key={key} onClick={() => set({ filter: f.id })} className="flex flex-col items-center gap-1.5">
                    <div className={`size-20 overflow-hidden rounded-lg bg-stone-800 ${on ? 'ring-2 ring-accent-500' : ''}`}>
                      {filterThumbs[key] && <img src={filterThumbs[key]} alt="" className="size-full object-cover" />}
                    </div>
                    <span className={`text-[12px] ${on ? 'text-white' : 'text-stone-400'}`}>{f.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-white/10 p-4">
          {saved && (saved.rotation !== 0 || saved.edits) && (
            <button
              disabled={busy}
              onClick={() => void save({ rotation: 0, edits: null })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-medium text-stone-300 hover:bg-white/10 disabled:opacity-50"
            >
              <Undo2 className="size-3.5" /> Revert to original
            </button>
          )}
          <div className="flex gap-2">
            <button onClick={() => props.onClose(false)} className="h-10 flex-1 rounded-lg bg-white/10 text-[13px] font-medium hover:bg-white/15">
              Cancel
            </button>
            <button
              disabled={!changed || busy}
              onClick={() => void save({ rotation, edits: clean(edits) })}
              className="h-10 flex-1 rounded-lg bg-white text-[13px] font-semibold text-stone-900 hover:bg-stone-200 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div className="text-center text-[11px] text-stone-500">Your original file is never changed.</div>
        </div>
      </aside>
    </div>
  )
}

function clean(e: PhotoEdits): PhotoEdits | null {
  const out: PhotoEdits = {}
  for (const [k, v] of Object.entries(e)) {
    if (v === undefined || v === null || v === false || v === 0) continue
    ;(out as Record<string, unknown>)[k] = v
  }
  return Object.keys(out).length ? out : null
}

/** Largest box of the given pixel aspect ratio inside `box`, centred on it. */
function fitAspect(box: Box, ratio: number, natural: { w: number; h: number }): Box {
  const pxW = box.w * natural.w
  const pxH = box.h * natural.h
  let w = pxW
  let h = pxW / ratio
  if (h > pxH) {
    h = pxH
    w = pxH * ratio
  }
  const fw = w / natural.w
  const fh = h / natural.h
  return { x: box.x + (box.w - fw) / 2, y: box.y + (box.h - fh) / 2, w: fw, h: fh }
}

function ToolBtn(props: { onClick: () => void; label: string; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      title={props.label}
      aria-label={props.label}
      className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-2.5 text-[11px] transition ${props.active ? 'bg-accent-500 text-white' : 'bg-white/10 hover:bg-white/15'}`}
    >
      {props.children}
      {props.label}
    </button>
  )
}

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

/** The whole picture with a draggable crop frame (box in fractions of the picture). */
function CropView(props: { src: string; box: Box; onBox: (b: Box) => void; aspect: number | null; onNatural: (n: { w: number; h: number }) => void }) {
  const img = useRef<HTMLImageElement>(null)
  const drag = useRef<{ handle: Handle; x: number; y: number; box: Box } | null>(null)
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const measure = (): void => {
    const el = img.current
    if (!el) return
    const p = el.parentElement?.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (p) setRect({ left: r.left - p.left, top: r.top - p.top, width: r.width, height: r.height })
  }
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const down = (handle: Handle) => (e: ReactPointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { handle, x: e.clientX, y: e.clientY, box: props.box }
  }
  const move = (e: ReactPointerEvent): void => {
    const d = drag.current
    if (!d || !rect) return
    const dx = (e.clientX - d.x) / rect.width
    const dy = (e.clientY - d.y) / rect.height
    const b = { ...d.box }
    const MIN = 0.05
    if (d.handle === 'move') {
      b.x = Math.min(1 - b.w, Math.max(0, d.box.x + dx))
      b.y = Math.min(1 - b.h, Math.max(0, d.box.y + dy))
    } else {
      let x1 = d.box.x
      let y1 = d.box.y
      let x2 = d.box.x + d.box.w
      let y2 = d.box.y + d.box.h
      if (d.handle.includes('w')) x1 = Math.min(x2 - MIN, Math.max(0, x1 + dx))
      if (d.handle.includes('e')) x2 = Math.max(x1 + MIN, Math.min(1, x2 + dx))
      if (d.handle.includes('n')) y1 = Math.min(y2 - MIN, Math.max(0, y1 + dy))
      if (d.handle.includes('s')) y2 = Math.max(y1 + MIN, Math.min(1, y2 + dy))
      Object.assign(b, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
    }
    props.onBox(b)
  }
  const up = (): void => {
    drag.current = null
  }

  const b = props.box
  return (
    <div className="relative flex size-full items-center justify-center" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <img
        ref={img}
        src={props.src}
        alt=""
        draggable={false}
        onLoad={(e) => {
          props.onNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          measure()
        }}
        className="max-h-full max-w-full select-none object-contain"
      />
      {rect && (
        <div className="pointer-events-none absolute" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          {/* Dim the parts that will be cropped away. */}
          <div
            className="pointer-events-auto absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
            onPointerDown={down('move')}
          >
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className="border border-white/25" />
              ))}
            </div>
            {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
              <div
                key={h}
                onPointerDown={down(h)}
                className={`absolute size-5 rounded-sm border-[3px] border-white bg-white/20 ${h.includes('n') ? '-top-2.5' : '-bottom-2.5'} ${h.includes('w') ? '-left-2.5' : '-right-2.5'} ${
                  h === 'nw' || h === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
