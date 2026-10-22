import { useMemo, useRef, useState } from 'react'
import type { TimelineGroup } from '@shared/types'
import { monthLabel, n } from '../lib/format'
import { t } from '../lib/i18n'

export const RAIL_W = 44

interface Span {
  month: string
  /** Fraction of the rail where this month starts and ends (0 = top). */
  from: number
  to: number
  count: number
}

/**
 * The thin rail on the timeline's right edge: years sized by their share of the library (with a floor so a quiet
 * year stays clickable), a tick per month sized by its count, and a brass marker for where you are. Drag or click
 * to jump; Up/Down move a month, Page Up/Down a year.
 */
export function DateRail(props: { groups: TimelineGroup[]; current: string | null; onJump: (month: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ y: number; span: Span } | null>(null)
  const dragging = useRef(false)

  const { years, spans, max } = useMemo(() => {
    const total = props.groups.reduce((s, g) => s + g.count, 0) || 1
    const byYear = new Map<string, TimelineGroup[]>()
    for (const g of props.groups) {
      const y = g.month === 'undated' ? 'undated' : g.month.slice(0, 4)
      byYear.set(y, [...(byYear.get(y) ?? []), g])
    }
    // Each year's share of the rail, never less than 3.5 % so it can be hit.
    const floor = 0.035
    const raw = [...byYear.entries()].map(([year, gs]) => ({ year, gs, n: gs.reduce((s, g) => s + g.count, 0) }))
    const weights = raw.map((r) => Math.max(r.n / total, floor))
    const sum = weights.reduce((a, b) => a + b, 0)
    const spans: Span[] = []
    let at = 0
    const years = raw.map((r, i) => {
      const share = (weights[i] as number) / sum
      const from = at
      let inner = from
      for (const g of r.gs) {
        const part = r.n ? (g.count / r.n) * share : share / r.gs.length
        spans.push({ month: g.month, from: inner, to: inner + part, count: g.count })
        inner += part
      }
      at += share
      return { year: r.year, from, share, months: r.gs }
    })
    return { years, spans, max: Math.max(1, ...props.groups.map((g) => g.count)) }
  }, [props.groups])

  const spanAt = (clientY: number): { y: number; span: Span } | null => {
    const el = ref.current
    if (!el || spans.length === 0) return null
    const r = el.getBoundingClientRect()
    const f = Math.min(0.9999, Math.max(0, (clientY - r.top) / r.height))
    const span = spans.find((s) => f >= s.from && f < s.to) ?? (spans[spans.length - 1] as Span)
    return { y: clientY - r.top, span }
  }

  const jumpTo = (clientY: number): void => {
    const hit = spanAt(clientY)
    if (!hit) return
    setHover(hit)
    props.onJump(hit.span.month)
  }

  const currentSpan = spans.find((s) => s.month === props.current) ?? null
  const index = currentSpan ? spans.indexOf(currentSpan) : -1
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!spans.length) return
    const step = (d: number): void => {
      e.preventDefault()
      const next = spans[Math.min(spans.length - 1, Math.max(0, (index < 0 ? 0 : index) + d))]
      if (next) props.onJump(next.month)
    }
    if (e.key === 'ArrowDown') step(1)
    else if (e.key === 'ArrowUp') step(-1)
    else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      const y = currentSpan?.month.slice(0, 4)
      const order = years.map((yr) => yr.year)
      const yi = Math.max(0, order.indexOf(y ?? order[0] ?? ''))
      const target = years[Math.min(years.length - 1, Math.max(0, yi + (e.key === 'PageDown' ? 1 : -1)))]
      if (target?.months[0]) props.onJump(target.months[0].month)
    }
  }

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={t('Jump to a date')}
      aria-valuetext={props.current ? monthLabel(props.current) : undefined}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, spans.length - 1)}
      aria-valuenow={Math.max(0, index)}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        jumpTo(e.clientY)
      }}
      onPointerMove={(e) => (dragging.current ? jumpTo(e.clientY) : setHover(spanAt(e.clientY)))}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => !dragging.current && setHover(null)}
      className="no-drag relative h-full cursor-ns-resize select-none font-mono text-[11px] leading-none text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-brass-ink"
      style={{ width: RAIL_W }}
    >
      {years.map((y) => (
        <div key={y.year} className="absolute inset-x-0 border-t border-line" style={{ top: `${y.from * 100}%`, height: `${y.share * 100}%` }}>
          {y.share * (ref.current?.clientHeight ?? 600) >= 18 && <span className="absolute right-0.5 top-1">{y.year === 'undated' ? '—' : y.year}</span>}
        </div>
      ))}
      {spans.map((s) => (
        <i
          key={s.month}
          className="absolute left-0.5 h-0.5 rounded-[1px] bg-line-strong opacity-55"
          style={{ top: `${((s.from + s.to) / 2) * 100}%`, width: s.count ? Math.max(2, Math.round((s.count / max) * 10)) : 0 }}
        />
      ))}
      {currentSpan && (
        <div
          className="absolute left-0 -mt-px h-[3px] w-[14px] rounded-full bg-brass transition-[top] duration-[var(--dur-base)] ease-[var(--ease-standard)]"
          style={{ top: `${currentSpan.from * 100}%` }}
        />
      )}
      {hover && (
        <div
          className="pointer-events-none absolute right-[calc(100%+6px)] z-20 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-[7px] font-sans text-[12px] font-semibold leading-none text-on-ink shadow-[0_6px_20px_rgba(26,30,27,0.18)]"
          style={{ top: hover.y }}
        >
          {hover.span.month === 'undated' ? t('No date') : monthLabel(hover.span.month)}
          <span className="ml-1.5 font-mono font-normal opacity-75">{n(hover.span.count)}</span>
        </div>
      )}
    </div>
  )
}
