import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarHeart, Plane, PartyPopper, Sparkles } from 'lucide-react'
import type { Memory } from '@shared/types'
import { AssetGrid } from '../components/AssetGrid'
import { api, mediaUrl, n } from '../lib/format'
import { PageHeader } from './Placeholder'

const SECTIONS: Array<{ kind: Memory['kind']; title: string; icon: React.ReactNode; empty?: string }> = [
  { kind: 'on_this_day', title: 'On this day', icon: <CalendarHeart className="size-4" />, empty: 'No photos from this day in earlier years.' },
  { kind: 'trip', title: 'Trips', icon: <Plane className="size-4" /> },
  { kind: 'event', title: 'Big days', icon: <PartyPopper className="size-4" /> }
]

export function MemoriesView(props: { version: number }) {
  const [list, setList] = useState<Memory[] | null>(null)
  const [open, setOpen] = useState<Memory | null>(null)

  useEffect(() => {
    void api.memories().then(setList)
  }, [props.version])

  if (open) {
    return (
      <AssetGrid
        version={props.version}
        query={{ ids: open.ids, hidden: 'exclude' }}
        title={
          <span className="flex items-center gap-2">
            <button
              onClick={() => setOpen(null)}
              className="no-drag grid size-8 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              aria-label="All memories"
            >
              <ArrowLeft className="size-4" />
            </button>
            {open.title}
          </span>
        }
        subtitle={open.subtitle}
        empty={<div className="mt-16 text-center text-stone-500">These photos are no longer in the library.</div>}
      />
    )
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="Memories" subtitle="Found in your own photos: the same day in earlier years, trips away from home, and days you took a lot of pictures." />
      <div className="mx-auto max-w-5xl space-y-10 px-8 pb-12">
        {list === null && <div className="skeleton h-48 rounded-2xl" />}
        {list?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-stone-300 py-14 text-center text-[13.5px] text-stone-500 dark:border-stone-700 dark:text-stone-400">
            <Sparkles className="mx-auto mb-2 size-6" />
            Memories appear once the library has photos with dates (and, for trips, locations).
          </div>
        )}
        {list &&
          list.length > 0 &&
          SECTIONS.map((s) => {
            const items = list.filter((m) => m.kind === s.kind)
            if (items.length === 0 && !s.empty) return null
            return (
              <section key={s.kind}>
                <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
                  {s.icon} {s.title}
                </h2>
                {items.length === 0 ? (
                  <div className="text-[13px] text-stone-500 dark:text-stone-400">{s.empty}</div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                    {items.map((m) => (
                      <MemoryCard key={m.key} memory={m} onOpen={() => setOpen(m)} />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
      </div>
    </div>
  )
}

function MemoryCard(props: { memory: Memory; onOpen: () => void }) {
  const m = props.memory
  const [first, ...rest] = m.coverIds
  return (
    <button onClick={props.onOpen} className="group overflow-hidden rounded-2xl bg-white text-left shadow-sm shadow-stone-900/5 transition hover:shadow-md dark:bg-stone-900">
      <div className="grid aspect-[4/3] grid-cols-3 grid-rows-2 gap-0.5 overflow-hidden bg-stone-200 dark:bg-stone-800">
        {first !== undefined && (
          <img src={mediaUrl('thumb', first)} alt="" className="col-span-2 row-span-2 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        )}
        {rest.slice(0, 2).map((id) => (
          <img key={id} src={mediaUrl('thumb', id)} alt="" className="size-full object-cover" />
        ))}
      </div>
      <div className="px-4 py-3">
        <div className="truncate text-[14px] font-semibold">{m.title}</div>
        <div className="truncate text-xs text-stone-500 dark:text-stone-400">
          {m.subtitle} · {n(m.count)} photos
        </div>
      </div>
    </button>
  )
}
