import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Eye, EyeOff, LoaderCircle, Trash2 } from 'lucide-react'
import type { AssetKind, AssetQuery, AssetSummary, Facets } from '@shared/types'
import { api, mediaUrl, n, plural } from '../lib/format'
import { isClutterOrigin, kindIcon, kindLabel, originIcon, originLabel } from '../lib/labels'
import { AssetGrid } from '../components/AssetGrid'
import { ConfirmDialog } from '../components/Dialog'
import { NoMatches } from './PhotosView'

interface Group {
  key: string
  title: string
  icon: ReactNode
  query: AssetQuery
  count: number
  hidden: number
  note?: string
}

export function CleanupView(props: { version: number }) {
  const [facets, setFacets] = useState<Facets | null>(null)
  const [open, setOpen] = useState<Group | null>(null)

  useEffect(() => {
    void api.facets().then(setFacets)
  }, [props.version])

  if (open) return <GroupDetail group={open} version={props.version} onBack={() => setOpen(null)} />

  const origins = facets?.origins ?? []
  // "Probably received or saved" is shown per size clue rather than as one huge group.
  const HINTS: Record<string, { title: string; note: string }> = {
    whatsapp_size: { title: 'Probably WhatsApp', note: 'No camera data, in WhatsApp’s sizes (1600 px photos, 848×480 / 640×352 videos)' },
    social_size: { title: 'Probably social media', note: 'No camera data and 2048 px — Facebook, Messenger and X size' },
    none: { title: 'Probably received or saved', note: 'No camera data or recording date, other sizes' }
  }
  const probable: Group[] = (facets?.receivedHints ?? []).map((h) => ({
    key: `r:${h.hint}`,
    title: HINTS[h.hint]?.title ?? h.hint,
    icon: originIcon('received', 'size-4'),
    query: { origin: 'received', originHint: h.hint },
    count: h.count,
    hidden: h.hidden ?? 0,
    note: HINTS[h.hint]?.note
  }))
  const clutter: Group[] = origins
    .filter((o) => isClutterOrigin(o.origin) && o.origin !== 'received')
    .map((o) => ({
      key: `o:${o.origin}`,
      title: originLabel(o.origin),
      icon: originIcon(o.origin, 'size-4'),
      query: { origin: o.origin },
      count: o.count,
      hidden: o.hidden ?? 0
    }))
  const kinds: Group[] = (facets?.kinds ?? [])
    .filter((k) => k.kind === 'loop' || k.kind === 'sticker' || k.kind === 'animated')
    .map((k) => ({
      key: `k:${k.kind}`,
      title: kindLabel(k.kind as AssetKind, true),
      icon: kindIcon(k.kind as AssetKind, 'size-4'),
      query: { kind: k.kind },
      count: k.count,
      hidden: k.hidden ?? 0,
      note: k.kind === 'loop' ? 'Short videos without sound — how WhatsApp and Telegram save GIFs' : undefined
    }))
  const yours: Group[] = origins
    .filter((o) => !isClutterOrigin(o.origin))
    .map((o) => ({
      key: `o:${o.origin}`,
      title: originLabel(o.origin),
      icon: originIcon(o.origin, 'size-4'),
      query: { origin: o.origin },
      count: o.count,
      hidden: o.hidden ?? 0,
      note: o.origin === 'unknown' ? 'No camera data or recognisable app pattern' : undefined
    }))

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="drag sticky top-0 z-10 bg-stone-50/80 px-7 pb-4 pr-40 pt-5 backdrop-blur-xl dark:bg-stone-950/75">
        <h1 className="font-[family-name:var(--font-display)] text-[22px] font-semibold tracking-tight">Cleanup</h1>
        <div className="mt-0.5 max-w-2xl text-xs leading-relaxed text-stone-500 dark:text-stone-400">
          Media from chat apps, screenshots and downloads, grouped so you can review it in bulk. Hiding only removes items from the Photos timeline —
          nothing is deleted, and hidden items stay searchable here.
        </div>
      </div>
      <div className="space-y-8 px-7 pb-12 pt-2">
        {facets && facets.unclassified > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-accent-50 px-4 py-3 text-[13px] text-accent-600 dark:bg-accent-500/10 dark:text-accent-400">
            <LoaderCircle className="size-4 animate-spin" /> Labelling {plural(facets.unclassified, 'item')}… groups update as it goes.
          </div>
        )}
        <Section title="Likely clutter" groups={[...clutter, ...kinds]} onOpen={setOpen} empty="No chat-app media, screenshots or downloads found." />
        {probable.length > 0 && (
          <Section
            title="Probably clutter — no camera data"
            subtitle="These carry no camera information at all, which your own phone photos keep. Inferred, not certain: review before hiding."
            groups={probable}
            onOpen={setOpen}
          />
        )}
        {facets && facets.hidden > 0 && (
          <Section
            title="Hidden from Photos"
            groups={[{ key: 'hidden', title: 'Hidden', icon: <EyeOff className="size-4" />, query: { hidden: 'only' }, count: facets.hidden, hidden: facets.hidden }]}
            onOpen={setOpen}
          />
        )}
        <Section title="Your own photos" groups={yours} onOpen={setOpen} />
      </div>
    </div>
  )
}

function Section(props: { title: string; subtitle?: string; groups: Group[]; onOpen: (g: Group) => void; empty?: string }) {
  if (props.groups.length === 0 && !props.empty) return null
  return (
    <section>
      <h2 className={`${props.subtitle ? 'mb-1' : 'mb-3'} text-[13px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400`}>{props.title}</h2>
      {props.subtitle && <p className="mb-3 max-w-2xl text-xs leading-relaxed text-stone-500 dark:text-stone-400">{props.subtitle}</p>}
      {props.groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 px-5 py-6 text-[13px] text-stone-500 dark:border-stone-700 dark:text-stone-400">{props.empty}</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {props.groups.map((g) => (
            <GroupCard key={g.key} group={g} onOpen={() => props.onOpen(g)} />
          ))}
        </div>
      )}
    </section>
  )
}

function GroupCard(props: { group: Group; onOpen: () => void }) {
  const g = props.group
  const [preview, setPreview] = useState<AssetSummary[]>([])
  useEffect(() => {
    void api.assetsPage(0, 4, g.query).then(setPreview)
  }, [g.key, g.count])
  return (
    <button onClick={props.onOpen} className="group overflow-hidden rounded-xl bg-white text-left shadow-sm shadow-stone-900/5 transition hover:shadow-md dark:bg-stone-900">
      <div className="grid aspect-[2/1] grid-cols-4 gap-px bg-stone-100 dark:bg-stone-800">
        {Array.from({ length: 4 }, (_, i) => {
          const a = preview[i]
          return (
            <div key={i} className="overflow-hidden bg-stone-200 dark:bg-stone-800">
              {a && a.thumb === 'ready' && <img src={mediaUrl('thumb', a.id, a.rev)} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />}
            </div>
          )
        })}
      </div>
      <div className="p-3.5">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <span className="text-accent-600 dark:text-accent-400">{g.icon}</span>
          {g.title}
          <span className="ml-auto text-[13px] font-semibold tabular-nums">{n(g.count)}</span>
        </div>
        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          {g.note ?? (g.hidden > 0 && g.key !== 'hidden' ? `${n(g.hidden)} hidden from Photos` : g.key === 'hidden' ? 'Not shown in the Photos timeline' : 'All visible in Photos')}
        </div>
      </div>
    </button>
  )
}

function GroupDetail(props: { group: Group; version: number; onBack: () => void }) {
  const g = props.group
  const [confirm, setConfirm] = useState<'hide' | 'show' | 'bin' | null>(null)
  const [counts, setCounts] = useState<{ total: number; hidden: number } | null>(null)

  useEffect(() => {
    void Promise.all([api.timeline(g.query), api.timeline({ ...g.query, hidden: 'only' })]).then(([all, hid]) =>
      setCounts({ total: all.reduce((s, x) => s + x.count, 0), hidden: hid.reduce((s, x) => s + x.count, 0) })
    )
  }, [props.version, g.key])

  const visible = counts ? counts.total - counts.hidden : 0
  const btn = 'no-drag inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition disabled:opacity-40'
  return (
    <>
      <AssetGrid
        version={props.version}
        query={g.query}
        title={
          <span className="flex items-center gap-2">
            <button
              onClick={props.onBack}
              className="no-drag grid size-8 place-items-center rounded-lg text-stone-500 hover:bg-stone-200/70 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              aria-label="Back to Cleanup"
            >
              <ArrowLeft className="size-4" />
            </button>
            {g.title}
          </span>
        }
        subtitle={counts ? `${n(counts.hidden)} of ${n(counts.total)} hidden from Photos${g.note ? ` · ${g.note}` : ''}` : g.note}
        actions={
          <>
            {counts && counts.hidden > 0 && (
              <button onClick={() => setConfirm('show')} className={`${btn} bg-stone-200/70 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`}>
                <Eye className="size-3.5" /> Show all
              </button>
            )}
            {counts && counts.total > 0 && (
              <button onClick={() => setConfirm('bin')} className={`${btn} bg-stone-200/70 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`}>
                <Trash2 className="size-3.5" /> Move all to Bin
              </button>
            )}
            {g.key !== 'hidden' && (
              <button
                disabled={!counts || visible === 0}
                onClick={() => setConfirm('hide')}
                className={`${btn} bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900`}
              >
                <EyeOff className="size-3.5" /> Hide all from Photos
              </button>
            )}
          </>
        }
        empty={<NoMatches title="Nothing here" body="This group is empty." />}
      />
      {confirm === 'bin' && counts && (
        <ConfirmDialog
          title={`Move ${plural(counts.total, 'item')} to the Bin?`}
          body="They leave every view and wait in the Bin, where you can restore them or delete them permanently. Nothing is deleted yet."
          confirm="Move to Bin"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null)
            await api.moveToBin(await api.assetIdsInRange(g.query, 0, counts.total))
          }}
        />
      )}
      {confirm && confirm !== 'bin' && counts && (
        <ConfirmDialog
          title={confirm === 'hide' ? `Hide ${plural(visible, 'item')} from Photos?` : `Show ${plural(counts.hidden, 'item')} in Photos again?`}
          body={
            confirm === 'hide'
              ? 'They disappear from the Photos timeline but stay in your library, in albums, in search and here in Cleanup. Nothing is deleted, and you can show them again at any time.'
              : 'They will appear in the Photos timeline again.'
          }
          confirm={confirm === 'hide' ? 'Hide from Photos' : 'Show in Photos'}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const hide = confirm === 'hide'
            setConfirm(null)
            await api.setHiddenByQuery(g.query, hide)
          }}
        />
      )}
    </>
  )
}

