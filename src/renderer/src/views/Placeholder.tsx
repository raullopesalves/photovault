import { Sparkles } from 'lucide-react'
import { t } from '../lib/i18n'

export function PageHeader(props: { title: string; subtitle?: string }) {
  return (
    <div className="drag pb-6 pt-14">
      <div className="mx-auto max-w-4xl px-8">
        <h1 className="font-[family-name:var(--font-display)] text-[26px] font-bold leading-8 tracking-[-0.015em]">{props.title}</h1>
        {props.subtitle && <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-muted">{props.subtitle}</p>}
      </div>
    </div>
  )
}

export function Placeholder(props: { title: string; body: string }) {
  return (
    <div className="drag flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-stone-200/70 text-ink-muted dark:bg-stone-800 dark:text-stone-400">
          <Sparkles className="size-6" strokeWidth={1.5} />
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">{props.title}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{props.body}</p>
        <div className="mt-4 text-xs uppercase tracking-wider text-ink-faint">{t('Coming soon')}</div>
      </div>
    </div>
  )
}
