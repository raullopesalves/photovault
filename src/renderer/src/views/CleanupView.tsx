import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Copy, Eye, EyeOff, Images, LoaderCircle, Trash2 } from 'lucide-react'
import type { AssetKind, AssetQuery, AssetSummary, Facets, NearDuplicates } from '@shared/types'
import { api, mediaUrl, n, plural } from '../lib/format'
import { isClutterOrigin, kindIcon, kindLabel, originIcon, originLabel } from '../lib/labels'
import { AssetGrid } from '../components/AssetGrid'
import { ConfirmDialog } from '../components/Dialog'
import { NoMatches, SCREEN_ORIGINS } from './PhotosView'
import { t } from '../lib/i18n'

interface Group {
  key: string
  title: string
  icon: ReactNode
  /** The items, for the previews and the detail grid. */
  query?: AssetQuery
  /** Previews by id, for groups that are not a query (duplicates). */
  previewIds?: number[]
  count: number
  /** What the count counts, after the number: "extra copies". */
  unit?: string
  hidden: number
  note?: string
  /** Opens another view instead of the group's own grid. */
  target?: TidyTarget
}

export type TidyTarget = { view: 'duplicates'; tab: 'probable' | 'similar' } | { view: 'hidden' }

/** Tidy up: everything worth reviewing together, as cards with one number each, biggest first. */
export function CleanupView(props: { version: number; showScreenshots: boolean; onOpenView: (target: TidyTarget) => void }) {
  const [facets, setFacets] = useState<Facets | null>(null)
  const [near, setNear] = useState<NearDuplicates | null>(null)
  const [similar, setSimilar] = useState<NearDuplicates | null>(null)
  const [open, setOpen] = useState<Group | null>(null)

  useEffect(() => {
    void api.facets().then(setFacets)
    void api.nearDuplicates(0, 1).then(setNear)
    void api.similarPhotos(0, 1).then(setSimilar)
  }, [props.version])

  if (open?.query) return <GroupDetail group={{ ...open, query: open.query }} version={props.version} onBack={() => setOpen(null)} />

  const openGroup = (g: Group): void => (g.target ? props.onOpenView(g.target) : setOpen(g))
  const bySize = (a: Group, b: Group): number => b.count - a.count
  const origins = facets?.origins ?? []
  // "Probably received or saved" is shown per size clue rather than as one huge group.
  const HINTS: Record<string, { title: string; note: string }> = {
    whatsapp_size: { title: t('Probably WhatsApp'), note: t('No camera data, in WhatsApp’s sizes (1600 px photos, 848×480 / 640×352 videos)') },
    social_size: { title: t('Probably social media'), note: t('No camera data and 2048 px — Facebook, Messenger and X size') },
    none: { title: t('Probably received or saved'), note: t('No camera data or recording date, other sizes') }
  }
  const probable: Group[] = (facets?.receivedHints ?? [])
    .map((h) => ({
      key: `r:${h.hint}`,
      title: HINTS[h.hint]?.title ?? h.hint,
      icon: originIcon('received', 'size-4'),
      query: { origin: 'received' as const, originHint: h.hint },
      count: h.count,
      hidden: h.hidden ?? 0,
      note: HINTS[h.hint]?.note
    }))
    .sort(bySize)
  const clutter: Group[] = origins
    .filter((o) => isClutterOrigin(o.origin) && o.origin !== 'received')
    .map((o) => ({
      key: `o:${o.origin}`,
      title: originLabel(o.origin),
      icon: originIcon(o.origin, 'size-4'),
      query: { origin: o.origin },
      count: o.count,
      hidden: o.hidden ?? 0,
      note: !props.showScreenshots && o.origin !== 'unknown' && SCREEN_ORIGINS.includes(o.origin) ? t('Kept out of Photos') : undefined
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
      note: k.kind === 'loop' ? t('Short videos without sound — how WhatsApp and Telegram save GIFs') : undefined
    }))
  const lookalikes: Group[] = []
  if (near)
    lookalikes.push({
      key: 'near',
      title: t('Probable duplicates'),
      icon: <Copy className="size-4" />,
      previewIds: near.groups[0]?.members.map((m) => m.asset.id),
      count: near.extraCopies,
      unit: t('extra copies'),
      hidden: 0,
      note:
        near.unresolvedGroups > 0
          ? t('In {groups} groups of the same photo re-saved, resized or compressed. The best copy of each is suggested.', { groups: n(near.unresolvedGroups) })
          : t('Nothing to review. Exact duplicates and reviewed groups are listed here.'),
      target: { view: 'duplicates', tab: 'probable' }
    })
  if (similar)
    lookalikes.push({
      key: 'similar',
      title: t('Similar photos'),
      icon: <Images className="size-4" />,
      previewIds: similar.groups[0]?.members.map((m) => m.asset.id),
      count: similar.extraCopies,
      unit: t('extra shots'),
      hidden: 0,
      note:
        similar.unresolvedGroups > 0
          ? t('In {groups} series of near-identical shots, such as bursts. The sharpest is suggested.', { groups: n(similar.unresolvedGroups) })
          : t('Nothing to review.'),
      target: { view: 'duplicates', tab: 'similar' }
    })
  const yours: Group[] = origins
    .filter((o) => !isClutterOrigin(o.origin))
    .map((o) => ({
      key: `o:${o.origin}`,
      title: originLabel(o.origin),
      icon: originIcon(o.origin, 'size-4'),
      query: { origin: o.origin },
      count: o.count,
      hidden: o.hidden ?? 0,
      note: o.origin === 'unknown' ? t('No camera data or recognisable app pattern') : undefined
    }))
  const hiddenCount = facets?.hidden ?? 0

  return (
    <div className="scroll-page h-full overflow-y-auto">
      <ViewHeader title={t('Tidy up')} subtitle={t('Groups worth reviewing together, biggest first. Hiding only takes items out of Photos, and nothing is deleted until you empty the Bin.')} />
      <div className="space-y-12 px-6 pb-12 pt-2">
        {facets && facets.unclassified > 0 && (
          <div className="flex items-center gap-2 rounded-[14px] bg-brass-soft px-4 py-3 text-[13px] text-brass-ink">
            <LoaderCircle className="size-4 animate-spin" />{' '}{t('Labelling')}{' '}{plural(facets.unclassified, 'item')}{t('… groups update as it goes.')}</div>
        )}
        <Section title={t('Likely clutter')} groups={[...clutter, ...kinds].sort(bySize)} onOpen={openGroup} empty={t('No chat-app media, screenshots or downloads found.')} />
        {probable.length > 0 && (
          <Section
            title={t('Probably clutter — no camera data')}
            subtitle={t('These carry no camera information at all, which your own phone photos keep. Inferred, not certain: review before hiding.')}
            groups={probable}
            onOpen={openGroup}
          />
        )}
        <Section title={t('Look-alikes')} groups={lookalikes} onOpen={openGroup} />
        <Section
          title={t('Kept aside')}
          groups={[
            {
              key: 'hidden',
              title: t('Hidden'),
              icon: <EyeOff className="size-4" />,
              query: { hidden: 'only' },
              count: hiddenCount,
              hidden: hiddenCount,
              note: t('Out of the Photos timeline, still in albums and search.'),
              target: { view: 'hidden' }
            }
          ]}
          onOpen={openGroup}
        />
        <Section title={t('Your own photos')} groups={yours} onOpen={openGroup} />
      </div>
    </div>
  )
}

/** The sticky title row of full-page views: title-1 with a small subtitle. */
export function ViewHeader(props: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="drag sticky top-0 z-10 bg-mat/85 px-6 pb-4 pr-40 pt-4 backdrop-blur-xl">
      <h1 className="font-[family-name:var(--font-display)] text-[26px] font-bold leading-8 tracking-[-0.015em]">{props.title}</h1>
      {props.subtitle && <div className="mt-0.5 max-w-2xl text-[12.5px] leading-[18px] text-ink-muted">{props.subtitle}</div>}
    </div>
  )
}

function Section(props: { title: string; subtitle?: string; groups: Group[]; onOpen: (g: Group) => void; empty?: string }) {
  if (props.groups.length === 0 && !props.empty) return null
  return (
    <section>
      <h2 className={`${props.subtitle ? 'mb-1' : 'mb-3'} font-[family-name:var(--font-display)] text-[19px] font-[650] leading-6 tracking-[-0.01em]`}>{props.title}</h2>
      {props.subtitle && <p className="mb-3 max-w-2xl text-[12.5px] leading-[18px] text-ink-muted">{props.subtitle}</p>}
      {props.groups.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line px-5 py-6 text-[13px] text-ink-muted">{props.empty}</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] items-start gap-4">
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
    const q = g.query ?? (g.previewIds?.length ? { ids: g.previewIds } : null)
    if (q && g.count > 0) void api.assetsPage(0, 4, q).then(setPreview)
    else setPreview([])
  }, [g.key, g.count])
  const status = g.note ?? (g.hidden > 0 ? t('{hidden} hidden from Photos', { hidden: n(g.hidden) }) : t('All visible in Photos'))
  return (
    <button
      onClick={props.onOpen}
      className="group flex flex-col overflow-hidden rounded-[14px] border border-line bg-card text-left transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-ink"
    >
      <div className="grid aspect-[5/2] w-full grid-cols-4 gap-0.5 bg-line">
        {Array.from({ length: 4 }, (_, i) => {
          const a = preview[i]
          return (
            <div key={i} className="relative min-h-0 overflow-hidden bg-shelf">
              {a && a.thumb === 'ready' && <img src={mediaUrl('thumb', a.id, a.rev)} alt="" className="absolute inset-0 size-full object-cover" />}
            </div>
          )
        })}
      </div>
      <div className="flex flex-col gap-1 px-4 pb-4 pt-3.5">
        <div className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-[650] leading-5">
          <span className="text-brass-ink">{g.icon}</span>
          {g.title}
        </div>
        <div className="mt-1.5 font-mono text-[28px] leading-8 tracking-[-0.02em] tabular-nums">
          {n(g.count)}
          {g.unit && <span className="ml-1.5 font-sans text-[12.5px] tracking-normal text-ink-muted">{g.unit}</span>}
        </div>
        <div className="text-[12.5px] leading-[18px] text-ink-muted">{status}</div>
      </div>
    </button>
  )
}

function GroupDetail(props: { group: Group & { query: AssetQuery }; version: number; onBack: () => void }) {
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
              className="no-drag grid size-8 place-items-center rounded-lg text-ink-muted hover:bg-stone-200/70 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              aria-label={t('Back to Tidy up')}
            >
              <ArrowLeft className="size-4" />
            </button>
            {g.title}
          </span>
        }
        subtitle={counts ? t('{hidden} of {total} hidden from Photos{v2}', { hidden: n(counts.hidden), total: n(counts.total), v2: g.note ? ` · ${g.note}` : '' }) : g.note}
        actions={
          <>
            {counts && counts.hidden > 0 && (
              <button onClick={() => setConfirm('show')} className={`${btn} bg-stone-200/70 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`}>
                <Eye className="size-3.5" />{' '}{t('Show all')}</button>
            )}
            {counts && counts.total > 0 && (
              <button onClick={() => setConfirm('bin')} className={`${btn} bg-stone-200/70 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`}>
                <Trash2 className="size-3.5" />{' '}{t('Move all to Bin')}</button>
            )}
            {g.key !== 'hidden' && (
              <button
                disabled={!counts || visible === 0}
                onClick={() => setConfirm('hide')}
                className={`${btn} bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:hover:bg-stone-200 dark:text-stone-900`}
              >
                <EyeOff className="size-3.5" />{' '}{t('Hide all from Photos')}</button>
            )}
          </>
        }
        empty={<NoMatches title={t('Nothing here')} body={t('This group is empty.')} />}
      />
      {confirm === 'bin' && counts && (
        <ConfirmDialog
          title={t('Move {total} to the Bin?', { total: plural(counts.total, 'item') })}
          body={t('They leave every view and wait in the Bin, where you can restore them or delete them permanently. Nothing is deleted yet.')}
          confirm={t('Move to Bin')}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null)
            await api.moveToBin(await api.assetIdsInRange(g.query, 0, counts.total))
          }}
        />
      )}
      {confirm && confirm !== 'bin' && counts && (
        <ConfirmDialog
          title={confirm === 'hide' ? t('Hide {visible} from Photos?', { visible: plural(visible, 'item') }) : t('Show {hidden} in Photos again?', { hidden: plural(counts.hidden, 'item') })}
          body={
            confirm === 'hide'
              ? t('They disappear from the Photos timeline but stay in your library, in albums, in search and here in Cleanup. Nothing is deleted, and you can show them again at any time.')
              : t('They will appear in the Photos timeline again.')
          }
          confirm={confirm === 'hide' ? t('Hide from Photos') : t('Show in Photos')}
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

