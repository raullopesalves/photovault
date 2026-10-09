import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import type { AssetSummary } from '@shared/types'
import { mediaUrl } from '../lib/format'
import { t } from '../lib/i18n'

const SPEEDS = [3, 5, 8]

/**
 * Full-screen slideshow over any grid (timeline, album, person, memory): photos cross-fade, videos play to
 * the end. Space pauses, arrows step, Esc closes. Controls hide while the mouse is still.
 */
export function Slideshow(props: {
  total: number
  startIndex: number
  getSummary: (index: number) => AssetSummary | undefined
  ensure: (from: number, to: number) => void
  onClose: () => void
}) {
  const [index, setIndex] = useState(props.startIndex)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(() => {
    try {
      return Number(localStorage.getItem('pv.slideshow.speed')) || 5
    } catch {
      return 5
    }
  })
  const [controls, setControls] = useState(true)
  const [shown, setShown] = useState<Array<{ key: string; url: string; video: boolean }>>([])
  const idle = useRef<number | undefined>(undefined)
  const current = props.getSummary(index)

  useEffect(() => {
    props.ensure(index - 1, index + 3)
  })

  const next = (): void => setIndex((i) => (i + 1 < props.total ? i + 1 : 0))
  const prev = (): void => setIndex((i) => (i > 0 ? i - 1 : props.total - 1))

  // Swap in the new picture once it has loaded; keep the previous one underneath for the cross-fade.
  useEffect(() => {
    if (!current) return
    const video = current.mediaType === 'video'
    const url = video ? mediaUrl('original', current.id) : mediaUrl('preview', current.id, current.rev)
    if (video) return setShown((s) => [...s.slice(-1), { key: `${current.id}`, url, video }])
    const img = new Image()
    img.onload = () => setShown((s) => [...s.slice(-1), { key: `${current.id}`, url, video }])
    img.onerror = () => setShown((s) => [...s.slice(-1), { key: `${current.id}`, url: mediaUrl('thumb', current.id, current.rev), video }])
    img.src = url
    // Warm the next one.
    const n = props.getSummary(index + 1)
    if (n && n.mediaType === 'photo') new Image().src = mediaUrl('preview', n.id, n.rev)
  }, [current?.id])

  // Timer for photos (videos advance when they end).
  useEffect(() => {
    if (!playing || !current || current.mediaType === 'video') return
    const t = window.setTimeout(next, speed * 1000)
    return () => window.clearTimeout(t)
  }, [playing, speed, current?.id, shown.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
      else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
      wake()
    }
    window.addEventListener('keydown', onKey)
    document.documentElement.requestFullscreen?.().catch(() => undefined)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [])

  const wake = (): void => {
    setControls(true)
    window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => setControls(false), 2200)
  }
  useEffect(() => {
    wake()
    return () => window.clearTimeout(idle.current)
  }, [])

  const top = shown[shown.length - 1]
  return (
    <div className={`no-drag fixed inset-0 z-[60] bg-black ${controls ? '' : 'cursor-none'}`} onMouseMove={wake} onClick={wake}>
      {shown.map((s) =>
        s.video ? (
          <video
            key={s.key}
            src={s.url}
            autoPlay
            onEnded={() => playing && next()}
            className={`absolute inset-0 size-full object-contain transition-opacity duration-700 ${s === top ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : (
          <img
            key={s.key}
            src={s.url}
            alt=""
            className={`absolute inset-0 size-full object-contain transition-opacity duration-1000 animate-ken-burns ${s === top ? 'opacity-100' : 'opacity-0'}`}
          />
        )
      )}
      <div className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent pb-8 pt-16 text-white transition-opacity ${controls ? 'opacity-100' : 'opacity-0'}`}>
        <button onClick={prev} className="grid size-11 place-items-center rounded-full hover:bg-white/10" aria-label={t('Previous')}>
          <ChevronLeft className="size-6" />
        </button>
        <button onClick={() => setPlaying((p) => !p)} className="grid size-12 place-items-center rounded-full bg-white/15 hover:bg-white/25" aria-label={playing ? t('Pause') : t('Play')}>
          {playing ? <Pause className="size-5" /> : <Play className="size-5 fill-current" />}
        </button>
        <button onClick={next} className="grid size-11 place-items-center rounded-full hover:bg-white/10" aria-label={t('Next')}>
          <ChevronRight className="size-6" />
        </button>
        <div className="ml-4 flex items-center gap-1 rounded-full bg-white/10 p-1 text-[12px]">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSpeed(s)
                try {
                  localStorage.setItem('pv.slideshow.speed', String(s))
                } catch {
                  /* ignore */
                }
              }}
              className={`rounded-full px-2.5 py-1 ${speed === s ? 'bg-white text-black' : 'hover:bg-white/10'}`}
            >
              {s}s
            </button>
          ))}
        </div>
        <span className="ml-4 text-[12px] tabular-nums text-white/60">
          {index + 1} / {props.total}
        </span>
      </div>
      <button
        onClick={props.onClose}
        className={`absolute right-5 top-5 grid size-10 place-items-center rounded-full bg-black/40 text-white transition hover:bg-black/60 ${controls ? 'opacity-100' : 'opacity-0'}`}
        aria-label={t('Close slideshow')}
      >
        <X className="size-5" />
      </button>
    </div>
  )
}
