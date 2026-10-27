import type { ReactNode } from 'react'
import { n } from '../lib/format'

/**
 * The sticky title row of a browsing page (People, Memories, Albums, Tidy up, the Guide): title-1 with a small
 * subtitle and optional actions on the right, aligned with the photo grids' titles (px-7) so moving between pages
 * does not shift the title.
 */
export function ViewHeader(props: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="drag sticky top-0 z-10 flex items-end justify-between gap-4 bg-mat/85 px-7 pb-4 pr-40 pt-5 backdrop-blur-xl">
      <div className="min-w-0">
        <h1 className="font-[family-name:var(--font-display)] text-[26px] font-bold leading-8 tracking-[-0.015em]">{props.title}</h1>
        {props.subtitle && <div className="mt-0.5 max-w-2xl text-[12.5px] leading-[18px] text-ink-muted">{props.subtitle}</div>}
      </div>
      {props.actions && <div className="no-drag flex shrink-0 items-center gap-2">{props.actions}</div>}
    </div>
  )
}

/** A section's title on a browsing page: title-2 like a month header, with an icon, a count and a short note. */
export function SectionTitle(props: { title: string; icon?: ReactNode; count?: number; subtitle?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[19px] font-[650] leading-6 tracking-[-0.01em]">
        {props.icon && <span className="text-ink-muted">{props.icon}</span>}
        {props.title}
        {props.count !== undefined && <span className="ml-0.5 text-[13px] font-normal tabular-nums text-ink-muted">{n(props.count)}</span>}
      </h2>
      {props.subtitle && <p className="mt-1 max-w-2xl text-[12.5px] leading-[18px] text-ink-muted">{props.subtitle}</p>}
    </div>
  )
}
