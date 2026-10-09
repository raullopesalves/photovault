import { Sparkles } from 'lucide-react'

export function PageHeader(props: { title: string; subtitle?: string }) {
  return (
    <div className="drag pb-6 pt-14">
      <div className="mx-auto max-w-4xl px-8">
        <h1 className="font-[family-name:var(--font-display)] text-[26px] font-semibold tracking-tight">{props.title}</h1>
        {props.subtitle && <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-stone-500 dark:text-stone-400">{props.subtitle}</p>}
      </div>
    </div>
  )
}

export function Placeholder(props: { title: string; body: string }) {
  return (
    <div className="drag flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-stone-200/70 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          <Sparkles className="size-6" strokeWidth={1.5} />
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">{props.title}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-stone-500 dark:text-stone-400">{props.body}</p>
        <div className="mt-4 text-xs uppercase tracking-wider text-stone-400">Coming soon</div>
      </div>
    </div>
  )
}
