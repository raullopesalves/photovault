import { useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, ImageOff, Images, LoaderCircle, Maximize2, Sparkles, Trash2, X } from 'lucide-react'
import type { DuplicateGroup, NearDuplicateGroup, NearDuplicates } from '@shared/types'
import { api, basename, bytes, isoLocal, mediaUrl, n, plural, sortTimeLabel } from '../lib/format'
import { originLabel } from '../lib/labels'
import { ConfirmDialog } from '../components/Dialog'
import { PageHeader } from './Placeholder'
import { t } from '../lib/i18n'

const PAGE = 50
const NEAR_PAGE = 30

type Tab = 'exact' | 'probable' | 'similar'

export function DuplicatesView(props: { version: number }) {
  const [tab, setTab] = useState<Tab>('exact')
  const [exactTotal, setExactTotal] = useState<number | null>(null)
  const [near, setNear] = useState<NearDuplicates | null>(null)
  const [similar, setSimilar] = useState<NearDuplicates | null>(null)

  useEffect(() => {
    void api.duplicates(0, 1).then((r) => setExactTotal(r.total))
    void api.nearDuplicates(0, 1).then(setNear)
    void api.similarPhotos(0, 1).then(setSimilar)
  }, [props.version])

  return (
    <div className="scroll-page h-full overflow-y-auto">
      <PageHeader
        title={t('Duplicates')}
        subtitle={t('Exact duplicates are byte-for-byte identical — the library already keeps only one copy. Probable duplicates look the same but were re-saved, resized or compressed (e.g. sent through WhatsApp): separate files you can review. Similar photos are different shots of the same moment, such as bursts.')}
      />
      <div className="mx-auto max-w-4xl px-8 pb-12">
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Card label={t('Exact duplicates')} value={exactTotal === null ? '…' : n(exactTotal)} active={tab === 'exact'} onClick={() => setTab('exact')} />
          <Card
            label={t('Probable duplicates')}
            value={near === null ? '…' : n(near.unresolvedGroups)}
            note={near && near.hashed < near.hashable ? t('Analysing {v0}%', { v0: Math.round((near.hashed / Math.max(1, near.hashable)) * 100) }) : near && near.unresolvedGroups > 0 ? t('to review') : undefined}
            active={tab === 'probable'}
            onClick={() => setTab('probable')}
          />
          <Card
            label={t('Similar photos')}
            value={similar === null ? '…' : n(similar.unresolvedGroups)}
            note={similar && similar.hashed < similar.hashable ? t('Analysing {v0}%', { v0: Math.round((similar.hashed / Math.max(1, similar.hashable)) * 100) }) : similar && similar.unresolvedGroups > 0 ? t('bursts to review') : undefined}
            active={tab === 'similar'}
            onClick={() => setTab('similar')}
          />
        </div>
        {tab === 'exact' ? <ExactList version={props.version} /> : <ProbableList key={tab} version={props.version} kind={tab} />}
      </div>
    </div>
  )
}

function ExactList(props: { version: number }) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    void api.duplicates(0, PAGE).then((r) => {
      setGroups(r.groups)
      setTotal(r.total)
    })
  }, [props.version])

  const loadMore = async (): Promise<void> => {
    const r = await api.duplicates(groups?.length ?? 0, PAGE)
    setGroups((g) => [...(g ?? []), ...r.groups])
  }

  return (
    <>
      {groups?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-300 py-14 text-center text-[13.5px] text-stone-500 dark:border-stone-700 dark:text-stone-400">{t('No duplicates found yet. Import the same photos from another folder or export and they will appear here.')}</div>
      )}
      <div className="space-y-3">
        {groups?.map((g) => (
          <div key={g.asset.id} className="flex gap-5 rounded-xl bg-white p-4 shadow-sm shadow-stone-900/5 dark:bg-stone-900">
            <div className="size-28 shrink-0 overflow-hidden rounded-lg bg-stone-200 dark:bg-stone-800">
              {g.asset.thumb === 'ready' ? (
                <img src={mediaUrl('thumb', g.asset.id, g.asset.rev)} alt="" className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-items-center text-stone-400">
                  <ImageOff className="size-5" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                <Copy className="size-3" />{' '}{t('Byte-for-byte identical')}</div>
              <div className="font-mono text-[11px] text-stone-500 dark:text-stone-400" title={g.sha256}>{t('SHA-256')}{' '}{g.sha256.slice(0, 16)}…
              </div>
              <div className="mt-3 space-y-1.5">
                {g.sources.map((s) => (
                  <div key={s.id} className="flex items-baseline gap-3 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate" title={s.sourcePath}>
                      <span className="font-medium">{s.originalFilename}</span>
                      <span className="text-stone-400"> — {s.sourcePath.slice(0, s.sourcePath.length - basename(s.sourcePath).length - 1)}</span>
                    </span>
                    <span className="shrink-0 text-stone-400">{bytes(s.sizeBytes)}</span>
                    <span className="w-28 shrink-0 text-right text-stone-400">{isoLocal(s.firstSeenAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      {groups && groups.length < total && (
        <div className="mt-6 text-center">
          <button onClick={loadMore} className="h-9 rounded-lg px-4 text-[13.5px] font-medium text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800">{t('Show more')}</button>
        </div>
      )}
    </>
  )
}

function ProbableList(props: { version: number; kind: 'probable' | 'similar' }) {
  const similar = props.kind === 'similar'
  const [data, setData] = useState<NearDuplicates | null>(null)
  const [shown, setShown] = useState(NEAR_PAGE)
  const [confirmAll, setConfirmAll] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)

  useEffect(() => {
    void (similar ? api.similarPhotos(0, shown) : api.nearDuplicates(0, shown)).then(setData)
  }, [props.version, shown, similar])

  if (!data) return <div className="skeleton h-40 rounded-xl" />
  const analysing = data.hashed < data.hashable

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm shadow-stone-900/5 dark:bg-stone-900">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">
            {data.unresolvedGroups > 0
              ? similar
                ? t('{unresolvedGroups} to review · {extraCopies}', { unresolvedGroups: plural(data.unresolvedGroups, 'series', 'series'), extraCopies: plural(data.extraCopies, 'extra shot') })
                : t('{unresolvedGroups} to review · {extraCopies}', { unresolvedGroups: plural(data.unresolvedGroups, 'group'), extraCopies: plural(data.extraCopies, 'extra copy', 'extra copies') })
              : data.totalGroups > 0
                ? similar
                  ? t('All similar photos reviewed')
                  : t('All probable duplicates reviewed')
                : analysing
                  ? similar
                    ? t('Looking for similar photos…')
                    : t('Looking for probable duplicates…')
                  : similar
                    ? t('No similar photos found')
                    : t('No probable duplicates found')}
          </div>
          <div className="mt-0.5 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
            {analysing ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle className="size-3 animate-spin" />{' '}{t('Comparing visual fingerprints:')}{' '}{n(data.hashed)}{' '}{t('of')}{' '}{n(data.hashable)}{' '}{t('items analysed — more groups may appear.')}</span>
            ) : similar ? (
              t('Separate shots taken seconds apart that look alike — bursts and retakes. The suggested shot to keep is the sharpest. Nothing happens unless you choose.')
            ) : (
              t('Matched by visual fingerprint, not bytes. The suggested copy to keep has camera data, then the highest resolution, then the largest file.')
            )}
          </div>
        </div>
        {!similar && data.unresolvedGroups > 0 && (
          <button
            onClick={() => setConfirmAll(true)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3.5 text-[13px] font-medium text-white transition hover:bg-stone-800 dark:bg-white dark:text-stone-900"
          >
            <Sparkles className="size-4" />{' '}{t('Keep the best of each, hide')}{' '}{n(data.extraCopies)}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {data.groups.map((g) => (
          <NearGroup key={g.key} group={g} similar={similar} onPreview={setPreview} />
        ))}
      </div>
      {data.groups.length < data.totalGroups && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setShown((s) => s + NEAR_PAGE)}
            className="h-9 rounded-lg px-4 text-[13.5px] font-medium text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800"
          >{t('Show more (')}{n(data.totalGroups - data.groups.length)}{' '}{t('more groups)')}</button>
        </div>
      )}

      {confirmAll && (
        <ConfirmDialog
          title={t('Hide {extraCopies} from Photos?', { extraCopies: plural(data.extraCopies, 'extra copy', 'extra copies') })}
          body={
            <>{t('In each of the')}{' '}{plural(data.unresolvedGroups, 'group')}{t(', the suggested best copy stays visible and the others are hidden from the Photos timeline. Nothing is deleted — hidden copies stay in the library, in Cleanup and here, and can be shown again.')}</>
          }
          confirm={t('Hide extra copies')}
          onClose={() => setConfirmAll(false)}
          onConfirm={async () => {
            setConfirmAll(false)
            await api.hideAllNearDuplicateExtras()
          }}
        />
      )}

      {preview !== null && (
        <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-10 animate-fade-in" onClick={() => setPreview(null)}>
          <img src={mediaUrl('preview', preview)} alt="" className="max-h-full max-w-full object-contain" />
          <button className="absolute right-5 top-5 grid size-9 place-items-center rounded-full text-white hover:bg-white/10" aria-label={t('Close preview')}>
            <X className="size-5" />
          </button>
        </div>
      )}
    </>
  )
}

function NearGroup(props: { group: NearDuplicateGroup; similar: boolean; onPreview: (id: number) => void }) {
  const g = props.group
  const [keep, setKeep] = useState(g.bestId)
  const [busy, setBusy] = useState(false)
  const others = g.members.filter((m) => m.asset.id !== keep)
  const anyHidden = g.members.some((m) => m.asset.hidden)

  return (
    <div className={`rounded-xl bg-white p-4 shadow-sm shadow-stone-900/5 dark:bg-stone-900 ${g.resolved ? 'opacity-75' : ''}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          {props.similar ? (
            <>
              <Images className="size-3" />{' '}{t('Same moment')}</>
          ) : (
            <>
              <Copy className="size-3" />{' '}{t('Looks the same')}</>
          )}
        </span>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          {props.similar
            ? `${plural(g.members.length, 'shot')} · ${g.members[0] ? sortTimeLabel(g.members[0].asset.sortTime) : ''}`
            : t('{length} · different files', { length: plural(g.members.length, 'copy', 'copies') })}
          {g.resolved ? t(' · reviewed') : ''}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {g.members.map((m) => {
          const selected = m.asset.id === keep
          return (
            <div key={m.asset.id} className="w-40 shrink-0">
              <button
                onClick={() => setKeep(m.asset.id)}
                className={`group relative block size-40 overflow-hidden rounded-lg bg-stone-200 outline-none transition dark:bg-stone-800 ${
                  selected ? 'ring-[3px] ring-accent-500' : 'ring-1 ring-stone-200 hover:ring-stone-300 dark:ring-stone-800'
                }`}
                title={t('Keep this copy')}
              >
                {m.asset.thumb === 'ready' ? (
                  <img src={mediaUrl('thumb', m.asset.id, m.asset.rev)} alt="" className={`size-full object-cover ${m.asset.hidden ? 'opacity-50' : ''}`} />
                ) : (
                  <div className="grid size-full place-items-center text-stone-400">
                    <ImageOff className="size-5" />
                  </div>
                )}
                {selected && (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-accent-500 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">
                    <Check className="size-3" strokeWidth={3} />{' '}{t('Keep')}</span>
                )}
                {m.asset.hidden && (
                  <span className="absolute bottom-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-black/50 text-white" title={t('Hidden from Photos')}>
                    <EyeOff className="size-3" />
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onPreview(m.asset.id)
                  }}
                  className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/40 text-white opacity-0 transition group-hover:opacity-100"
                  title={t('View larger')}
                >
                  <Maximize2 className="size-3" />
                </span>
              </button>
              <div className="mt-1.5 space-y-0.5 text-[11.5px] leading-snug">
                <div className="truncate font-medium" title={m.originalFilename}>
                  {m.originalFilename}
                </div>
                <div className="text-stone-500 dark:text-stone-400">
                  {m.asset.width && m.asset.height ? `${m.asset.width}×${m.asset.height}` : '?'} · {bytes(m.sizeBytes)}
                </div>
                <div className="truncate text-stone-500 dark:text-stone-400">
                  {m.camera ?? (m.origin ? `${originLabel(m.origin)}${m.originConfidence === 'probable' ? t(' (probable)') : ''}` : t('No camera data'))}
                </div>
                {m.asset.id === g.bestId && <div className="font-medium text-emerald-600 dark:text-emerald-400">{t('Suggested:')}{' '}{g.bestReason}</div>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {anyHidden && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await api.setHidden(g.members.map((m) => m.asset.id), false)
              setBusy(false)
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <Eye className="size-3.5" />{' '}{t('Show all')}</button>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await api.dismissNearDuplicates(g.members.map((m) => m.asset.id))
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          <X className="size-3.5" /> {props.similar ? t('Not similar') : t('Not duplicates')}
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await api.moveToBin(others.map((o) => o.asset.id))
          }}
          title={t('Move the other copies to the Bin (restore or delete them from there)')}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-40 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          <Trash2 className="size-3.5" />{' '}{t('Bin the other')}{others.length === 1 ? '' : 's'}
        </button>
        <button
          disabled={busy || others.every((o) => o.asset.hidden)}
          onClick={async () => {
            setBusy(true)
            await api.setHidden([keep], false)
            await api.setHidden(others.map((o) => o.asset.id), true)
            setBusy(false)
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-stone-900 px-3 text-[12.5px] font-medium text-white hover:bg-stone-800 disabled:opacity-40 dark:bg-white dark:text-stone-900"
        >
          <EyeOff className="size-3.5" />{' '}{t('Keep selected, hide')}{' '}{others.length === 1 ? t('the other') : t('the other {length}', { length: others.length })}
        </button>
      </div>
    </div>
  )
}

function Card(props: { label: string; value: string; note?: string; active?: boolean; onClick?: () => void }) {
  const clickable = !!props.onClick
  return (
    <button
      disabled={!clickable}
      onClick={props.onClick}
      className={`rounded-xl p-4 text-left transition ${
        props.active
          ? 'bg-white shadow-sm shadow-stone-900/5 ring-2 ring-accent-500 dark:bg-stone-900'
          : clickable
            ? 'bg-white/60 hover:bg-white dark:bg-stone-900/60 dark:hover:bg-stone-900'
            : 'bg-stone-100 dark:bg-stone-900/50'
      }`}
    >
      <div className={`font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums ${clickable ? '' : 'text-stone-400 dark:text-stone-600'}`}>{props.value}</div>
      <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{props.label}</div>
      {props.note && <div className="mt-1 text-[10.5px] uppercase tracking-wider text-stone-400 dark:text-stone-500">{props.note}</div>}
    </button>
  )
}
