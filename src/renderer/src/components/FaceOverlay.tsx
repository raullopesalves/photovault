import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { Check, UserPlus, UserX, X } from 'lucide-react'
import type { AssetFace, Person, PhotoEdits } from '@shared/types'
import { api } from '../lib/format'
import { t } from '../lib/i18n'

type Box = { x: number; y: number; w: number; h: number }

/** Face boxes are stored on the rotated, uncropped picture; the viewer may show a cropped / mirrored edit. */
function toShown(b: Box, edits: PhotoEdits | null): Box | null {
  let { x, y, w, h } = b
  const c = edits?.crop
  if (c) {
    x = (x - c.x) / c.w
    y = (y - c.y) / c.h
    w = w / c.w
    h = h / c.h
    if (x + w < 0 || y + h < 0 || x > 1 || y > 1) return null
  }
  if (edits?.flip) x = 1 - x - w
  return { x, y, w, h }
}
function fromShown(b: Box, edits: PhotoEdits | null): Box {
  let { x, y, w, h } = b
  if (edits?.flip) x = 1 - x - w
  const c = edits?.crop
  if (c) {
    x = c.x + x * c.w
    y = c.y + y * c.h
    w = w * c.w
    h = h * c.h
  }
  return { x, y, w, h }
}

/**
 * Faces on the photo in the viewer: boxes with names; click one to name it (existing or new person), remove
 * the name, or mark it as not a face. "Add a face" lets the user draw a box around a face the scan missed.
 */
export function FaceOverlay(props: {
  assetId: number
  edits: PhotoEdits | null
  version: number
  imageRef: RefObject<HTMLImageElement | null>
  containerRef: RefObject<HTMLDivElement | null>
  adding: boolean
  onAdded: () => void
  onMessage: (msg: string) => void
}) {
  const [faces, setFaces] = useState<AssetFace[]>([])
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [draft, setDraft] = useState<Box | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  const reload = (): Promise<void> => api.assetFaces(props.assetId).then(setFaces)
  useEffect(() => {
    void reload()
  }, [props.assetId, props.version])

  // Follow the picture (zoom, pan, window size) every frame while shown.
  useLayoutEffect(() => {
    let raf = 0
    const tick = (): void => {
      const img = props.imageRef.current
      const box = props.containerRef.current
      if (img && box) {
        const r = img.getBoundingClientRect()
        const c = box.getBoundingClientRect()
        setRect((prev) =>
          prev && prev.left === r.left - c.left && prev.top === r.top - c.top && prev.width === r.width && prev.height === r.height
            ? prev
            : { left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height }
        )
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])

  const local = (e: ReactPointerEvent): { x: number; y: number } | null => {
    if (!rect || !props.containerRef.current) return null
    const c = props.containerRef.current.getBoundingClientRect()
    return { x: (e.clientX - c.left - rect.left) / rect.width, y: (e.clientY - c.top - rect.top) / rect.height }
  }

  if (!rect) return null
  return (
    <div
      className={`absolute z-[2] ${props.adding ? 'cursor-crosshair' : 'pointer-events-none'}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onPointerDown={(e) => {
        if (!props.adding) return
        e.stopPropagation()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        start.current = local(e)
      }}
      onPointerMove={(e) => {
        if (!props.adding || !start.current) return
        e.stopPropagation()
        const p = local(e)
        if (!p) return
        const s = start.current
        setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
      }}
      onPointerUp={async (e) => {
        if (!props.adding || !start.current) return
        e.stopPropagation()
        start.current = null
        const d = draft
        setDraft(null)
        if (!d || d.w < 0.01 || d.h < 0.01) return
        const clamped = { x: Math.max(0, d.x), y: Math.max(0, d.y), w: Math.min(1 - Math.max(0, d.x), d.w), h: Math.min(1 - Math.max(0, d.y), d.h) }
        try {
          const f = await api.addFace(props.assetId, fromShown(clamped, props.edits))
          await reload()
          props.onAdded()
          if (f) setOpen(f.id)
        } catch (err) {
          props.onMessage(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('Could not add the face'))
        }
      }}
    >
      {faces.map((f) => {
        const b = toShown(f, props.edits)
        if (!b) return null
        return (
          <div key={f.id} className="absolute" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setOpen(open === f.id ? null : f.id)
              }}
              className={`pointer-events-auto absolute inset-0 rounded-md border-2 transition ${open === f.id ? 'border-accent-400' : 'border-white/80 hover:border-white'} shadow-[0_0_0_1px_rgba(0,0,0,0.35)]`}
              aria-label={f.personName ?? t('Unnamed face')}
            />
            <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-2 py-0.5 text-[11.5px] text-white">
              {f.personName ?? (f.personId ? t('Unnamed') : t('Who is this?'))}
            </div>
            {open === f.id && (
              <FacePopover
                face={f}
                onClose={() => setOpen(null)}
                onDone={async (msg) => {
                  setOpen(null)
                  await reload()
                  if (msg) props.onMessage(msg)
                }}
              />
            )}
          </div>
        )
      })}
      {draft && (
        <div
          className="absolute rounded-md border-2 border-dashed border-accent-400 bg-accent-400/10"
          style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}
        />
      )}
    </div>
  )
}

function FacePopover(props: { face: AssetFace; onClose: () => void; onDone: (msg?: string) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [text, setText] = useState('')
  useEffect(() => {
    void api.people().then(setPeople)
  }, [])
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    return (people ?? []).filter((p) => p.name && p.id !== props.face.personId && (!q || p.name.toLowerCase().includes(q))).slice(0, 8)
  }, [people, text])
  const exact = (people ?? []).find((p) => p.name?.toLowerCase() === text.trim().toLowerCase())

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-full z-10 mt-8 w-64 -translate-x-1/2 rounded-xl bg-stone-900/95 p-2 text-stone-100 shadow-2xl ring-1 ring-white/10 backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') props.onClose()
            if (e.key === 'Enter' && text.trim()) {
              if (exact) await api.moveFaces([props.face.id], { personId: exact.id })
              else await api.moveFaces([props.face.id], { newName: text.trim() })
              props.onDone(t('Tagged as {v0}', { v0: text.trim() }))
            }
          }}
          placeholder={props.face.personName ? t('Not {personName}? Type a name', { personName: props.face.personName }) : t('Who is this? Type a name')}
          className="h-8 min-w-0 flex-1 rounded-md bg-white/10 px-2 text-[12.5px] outline-none placeholder:text-stone-500 focus:ring-1 focus:ring-accent-400"
        />
        <button onClick={props.onClose} className="grid size-7 place-items-center rounded-md hover:bg-white/10" aria-label={t('Close')}>
          <X className="size-3.5" />
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {matches.map((p) => (
          <button
            key={p.id}
            onClick={async () => {
              await api.moveFaces([props.face.id], { personId: p.id })
              props.onDone(t('Tagged as {name}', { name: p.name }))
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-white/10"
          >
            {p.coverFaceId && <img src={`pv-media://face/${p.coverFaceId}`} alt="" className="size-6 rounded-full object-cover" />}
            <span className="truncate">{p.name}</span>
          </button>
        ))}
        {text.trim() && !exact && (
          <button
            onClick={async () => {
              await api.moveFaces([props.face.id], { newName: text.trim() })
              props.onDone(t('New person: {v0}', { v0: text.trim() }))
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-accent-300 hover:bg-white/10"
          >
            <UserPlus className="size-4" />{' '}{t('New person “')}{text.trim()}”
          </button>
        )}
      </div>
      <div className="mt-1 border-t border-white/10 pt-1">
        {props.face.personId !== null && (
          <button
            onClick={async () => {
              await api.moveFaces([props.face.id], null)
              props.onDone(props.face.personName ? t('Not {personName}', { personName: props.face.personName }) : t('Removed from that person'))
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-white/10"
          >
            <UserX className="size-4 text-stone-400" /> {props.face.personName ? t('Not {personName}', { personName: props.face.personName }) : t('Not this person')}
          </button>
        )}
        <button
          onClick={async () => {
            await api.deleteFace(props.face.id)
            props.onDone(t('Removed'))
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-white/10"
        >
          <X className="size-4 text-stone-400" />{' '}{t('Not a face')}</button>
        {props.face.manual && (
          <div className="flex items-center gap-1.5 px-2 pt-1 text-[11px] text-stone-500">
            <Check className="size-3" />{' '}{t('Marked by you')}</div>
        )}
      </div>
    </div>
  )
}
