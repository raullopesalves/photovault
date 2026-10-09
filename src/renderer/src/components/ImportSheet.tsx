import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronDown, CircleAlert, Copy, FileQuestion, FolderInput, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import type { ImportItemInfo, ImportProgress, ImportSummary, ItemClassification } from '@shared/types'
import { api, basename, bytes, clockLabel, etaLabel, n, plural, rateLabel, sourcesLabel, sourceTypeLabel } from '../lib/format'

const WORKING = new Set(['scanning', 'sidecars', 'analyzing', 'classifying', 'importing', 'linking'])

export function ImportSheet(props: {
  progress: ImportProgress | null
  error: string | null
  onClose: () => void
  onHide: () => void
  onShowPhotos: () => void
}) {
  const p = props.progress
  const working = p !== null && WORKING.has(p.phase)

  return (
    <div className="no-drag fixed inset-0 z-30 flex items-center justify-center bg-stone-950/30 p-8 backdrop-blur-[6px] animate-fade-in dark:bg-black/50">
      <div className="relative flex max-h-full w-[560px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-stone-950/20 animate-rise-in dark:bg-stone-900 dark:ring-1 dark:ring-white/10">
        <button
          onClick={working || p?.phase === 'ready' ? props.onHide : props.onClose}
          className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          aria-label={working ? 'Hide' : 'Close'}
          title={working ? 'Continue in background' : 'Close'}
        >
          <X className="size-4" />
        </button>
        {props.error ? (
          <ErrorState message={props.error} onClose={props.onClose} />
        ) : !p ? (
          <div className="p-10" />
        ) : p.phase === 'scanning' || p.phase === 'sidecars' || p.phase === 'analyzing' || p.phase === 'classifying' ? (
          <Analyzing p={p} />
        ) : p.phase === 'ready' && p.summary ? (
          <Ready p={p} s={p.summary} />
        ) : p.phase === 'importing' || p.phase === 'linking' ? (
          <Importing p={p} />
        ) : p.phase === 'completed' && p.summary ? (
          <Completed s={p.summary} onShowPhotos={props.onShowPhotos} onClose={props.onClose} />
        ) : p.phase === 'cancelled' ? (
          <Message icon={<X className="size-5" />} title="Import cancelled" body="Nothing more will be copied. Anything already imported stays safely in your library." onClose={props.onClose} />
        ) : (
          <ErrorState title="Import stopped" message={p.error ?? 'The import failed.'} onClose={props.onClose} />
        )}
      </div>
    </div>
  )
}

function Header(props: { icon: ReactNode; title: string; subtitle?: string; badge?: string; tone?: 'default' | 'success' | 'warn' }) {
  const tone =
    props.tone === 'success'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
      : props.tone === 'warn'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
        : 'bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400'
  return (
    <div className="px-8 pt-8">
      <div className={`mb-5 grid size-11 place-items-center rounded-xl ${tone}`}>{props.icon}</div>
      <div className="flex items-center gap-2.5">
        <h2 className="font-[family-name:var(--font-display)] text-[22px] font-semibold tracking-tight">{props.title}</h2>
        {props.badge && (
          <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">{props.badge}</span>
        )}
      </div>
      {props.subtitle && <p className="mt-1 truncate text-[13px] text-stone-500 dark:text-stone-400" title={props.subtitle}>{props.subtitle}</p>}
    </div>
  )
}

function Bar(props: { value: number; total: number; indeterminate?: boolean }) {
  const pct = props.total > 0 ? Math.min(100, (props.value / props.total) * 100) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
      {props.indeterminate ? (
        <div className="skeleton h-full w-full" />
      ) : (
        <div className="h-full rounded-full bg-accent-500 transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      )}
    </div>
  )
}

function Stat(props: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <div className={`font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums tracking-tight ${props.muted ? 'text-stone-400 dark:text-stone-500' : ''}`}>
        {n(props.value)}
      </div>
      <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{props.label}</div>
    </div>
  )
}

function Step(props: { state: 'done' | 'active' | 'todo'; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-3 text-[13.5px]">
      <div className="grid size-5 place-items-center">
        {props.state === 'done' ? (
          <Check className="size-4 text-emerald-500" strokeWidth={2.5} />
        ) : props.state === 'active' ? (
          <LoaderCircle className="size-4 animate-spin text-accent-500" />
        ) : (
          <div className="size-1.5 rounded-full bg-stone-300 dark:bg-stone-600" />
        )}
      </div>
      <span className={props.state === 'todo' ? 'text-stone-400 dark:text-stone-500' : ''}>{props.label}</span>
      {props.detail && <span className="ml-auto text-xs tabular-nums text-stone-500 dark:text-stone-400">{props.detail}</span>}
    </div>
  )
}

function Analyzing({ p }: { p: ImportProgress }) {
  const order = ['scanning', 'sidecars', 'analyzing', 'classifying']
  const at = order.indexOf(p.phase)
  const st = (i: number): 'done' | 'active' | 'todo' => (i < at ? 'done' : i === at ? 'active' : 'todo')
  const jsonSidecars = p.sidecarsFound
  return (
    <div className="pb-8">
      <Header
        icon={<FolderInput className="size-5" />}
        title={p.phase === 'scanning' ? 'Scanning…' : 'Analysing…'}
        subtitle={p.archivesFound > 0 ? `${p.sourcePath} · ${plural(p.archivesFound, 'ZIP archive')}` : p.sourcePath}
      />
      <div className="mt-6 grid grid-cols-4 gap-4 px-8">
        <Stat label="files found" value={p.filesDiscovered} />
        <Stat label="photos" value={p.photosFound} />
        <Stat label="videos" value={p.videosFound} />
        <Stat label="other files" value={p.ignoredFound + p.sidecarsFound} muted />
      </div>
      <div className="mx-8 mt-7 space-y-3 rounded-xl bg-stone-50 p-4 dark:bg-stone-800/50">
        <Step state={st(0)} label={p.archivesFound > 0 ? 'Finding photos and videos (inside ZIPs too)' : 'Finding photos and videos'} detail={at === 0 ? n(p.filesDiscovered) : undefined} />
        {jsonSidecars > 0 && (
          <Step state={st(1)} label="Reading export metadata (Google Takeout JSON)" detail={at === 1 ? `${n(p.sidecarsRead)} / ${n(jsonSidecars)}` : undefined} />
        )}
        <Step
          state={st(2)}
          label="Reading metadata and fingerprinting (SHA-256)"
          detail={at === 2 ? `${n(p.analyzed)} / ${n(p.analyzeTotal)}` : undefined}
        />
        <Step state={st(3)} label="Checking for duplicates" />
      </div>
      {p.phase === 'scanning' && (
        <div className="mx-8 mt-5 flex justify-between text-xs text-stone-500 dark:text-stone-400">
          <span>Counting files — the time estimate starts once the total is known</span>
          <span className="tabular-nums">{clockLabel(p.elapsedSeconds)}</span>
        </div>
      )}
      {(p.phase === 'analyzing' || p.phase === 'sidecars') && <EtaLine p={p} />}
      {p.phase === 'analyzing' && (
        <div className="mx-8 mt-2">
          <Bar value={p.analyzed} total={p.analyzeTotal} />
          <div className="mt-2 flex justify-between gap-4 text-xs text-stone-500 dark:text-stone-400">
            <span className="truncate">{p.currentFile ? basename(p.currentFile) : ''}</span>
            <span className="shrink-0 tabular-nums">{bytes(p.bytesProcessed)}</span>
          </div>
          {p.hashesReused > 0 && (
            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{plural(p.hashesReused, 'unchanged file')} recognised from earlier imports</div>
          )}
        </div>
      )}
      <p className="mx-8 mt-6 flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
        <ShieldCheck className="size-3.5" /> Read-only: nothing is copied until you confirm.
      </p>
      <div className="mx-8 mt-5 flex justify-end">
        <button
          onClick={() => void api.cancelImport(p.importId)}
          className="h-9 rounded-lg px-4 text-[13.5px] font-medium text-stone-600 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Ready({ p, s }: { p: ImportProgress; s: ImportSummary }) {
  const duplicates = s.duplicatesLibrary + s.duplicatesBatch
  const problems = s.unsupported + s.errors
  const [busy, setBusy] = useState(false)
  const nothingNew = s.newAssets === 0
  const mediaFound = s.photosFound + s.videosFound

  return (
    <div className="flex min-h-0 flex-col">
      <div className="scroll-thin min-h-0 overflow-y-auto pb-2">
        <Header
          icon={nothingNew ? <Check className="size-5" strokeWidth={2.5} /> : <FolderInput className="size-5" />}
          tone={nothingNew ? 'success' : 'default'}
          title={nothingNew ? (mediaFound === 0 ? 'No photos found' : 'Already in your library') : 'Import ready'}
          subtitle={s.sources.length > 1 ? sourcesLabel(s.sources) : s.sourcePath}
          badge={s.sourceType !== 'LOCAL_FOLDER' ? sourceTypeLabel(s.sourceType) : undefined}
        />
        <div className="mx-8 mt-6 overflow-hidden rounded-xl ring-1 ring-stone-200 dark:ring-stone-800">
          <SummaryRow
            strong
            value={s.newAssets}
            label={s.newAssets === 1 ? 'new item' : 'new items'}
            detail={
              s.newAssets > 0
                ? [s.newPhotos > 0 && plural(s.newPhotos, 'photo'), s.newVideos > 0 && plural(s.newVideos, 'video'), bytes(s.bytesNew)].filter(Boolean).join(' · ')
                : 'Nothing new to copy'
            }
          />
          <SummaryRow
            value={duplicates}
            label={duplicates === 1 ? 'exact duplicate' : 'exact duplicates'}
            detail={
              duplicates > 0
                ? [
                    s.duplicatesLibrary > 0 && `${n(s.duplicatesLibrary)} already in library`,
                    s.duplicatesBatch > 0 && `${n(s.duplicatesBatch)} repeated within this import`
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : undefined
            }
            icon={<Copy className="size-3.5" />}
          />
          {s.deletedBefore > 0 && (
            <SummaryRow
              value={s.deletedBefore}
              label={s.deletedBefore === 1 ? 'deleted before' : 'deleted before'}
              detail="You deleted these from the library earlier — not imported again (can be allowed in Settings)"
              icon={<X className="size-3.5" />}
            />
          )}
          {problems > 0 && <SummaryRow value={problems} label="not imported" detail="Unreadable, unsafe or not a recognised photo/video" icon={<FileQuestion className="size-3.5" />} />}
        </div>

        {s.takeoutItems > 0 && (
          <div className="mx-8 mt-4 rounded-xl bg-accent-50/70 px-4 py-3 text-[12.5px] leading-relaxed text-stone-700 dark:bg-accent-500/10 dark:text-stone-300">
            <span className="font-medium">Google metadata found for {n(s.sidecarsMatched)} of {n(mediaFound)} items.</span> Dates, locations, descriptions and
            favourites from Takeout fill in what the files themselves don’t record; a camera’s own EXIF date always takes precedence. Album folders are
            remembered.
          </div>
        )}

        {duplicates > 0 && (
          <div className="mx-8 mt-4 rounded-xl bg-stone-50 px-4 py-3 text-[12.5px] leading-relaxed text-stone-600 dark:bg-stone-800/50 dark:text-stone-400">
            Duplicates are byte-for-byte identical to a photo you already have (same SHA-256 fingerprint), whatever their file name. They won’t be copied
            again — Photo Vault just records where else they were found.
            {s.bytesDuplicate > 0 && <span className="font-medium text-stone-800 dark:text-stone-200"> Storage saved: {bytes(s.bytesDuplicate)}.</span>}
          </div>
        )}

        <div className="mx-8 mt-4 space-y-1">
          {duplicates > 0 && <ItemList importId={p.importId} classification="duplicate_library" title="Already in library" count={s.duplicatesLibrary} />}
          {s.duplicatesBatch > 0 && <ItemList importId={p.importId} classification="duplicate_batch" title="Repeated within this import" count={s.duplicatesBatch} />}
          {s.deletedBefore > 0 && <ItemList importId={p.importId} classification="deleted_before" title="Deleted before" count={s.deletedBefore} />}
          {s.unsupported > 0 && <ItemList importId={p.importId} classification="unsupported" title="Not recognised" count={s.unsupported} />}
          {s.errors > 0 && <ItemList importId={p.importId} classification="error" title="Could not be read" count={s.errors} />}
        </div>

        <div className="mx-8 mt-4 text-xs text-stone-500 dark:text-stone-400">
          {n(s.filesScanned)} files scanned{s.archivesFound > 0 && ` in ${plural(s.archivesFound, 'ZIP archive')}`} ·{' '}
          {n(s.ignoredFound + s.sidecarsFound)} non-media files
          {s.hashesReused > 0 && ` · ${n(s.hashesReused)} unchanged since an earlier import`}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-stone-100 px-8 py-5 dark:border-stone-800">
        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <ShieldCheck className="size-3.5 shrink-0" />
          Files are copied and verified. Your sources stay untouched.
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => void api.cancelImport(p.importId)}
            className="h-9 rounded-lg px-4 text-[13.5px] font-medium text-stone-600 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Cancel
          </button>
          <button
            data-testid="import-confirm"
            disabled={busy || mediaFound === 0}
            onClick={async () => {
              setBusy(true)
              await api.commitImport(p.importId)
            }}
            className="h-9 rounded-lg bg-stone-900 px-4 text-[13.5px] font-medium text-white transition hover:bg-stone-800 active:scale-[0.98] disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
          >
            {nothingNew ? 'Record sources & finish' : `Import ${plural(s.newAssets, 'new item')}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function SummaryRow(props: { value: number; label: string; detail?: string; strong?: boolean; icon?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-stone-100 px-5 py-4 last:border-0 dark:border-stone-800">
      <div
        className={`w-20 shrink-0 text-right font-[family-name:var(--font-display)] font-semibold tabular-nums tracking-tight ${
          props.strong ? 'text-[28px]' : 'text-[22px] text-stone-700 dark:text-stone-300'
        }`}
      >
        {n(props.value)}
      </div>
      <div className="min-w-0">
        <div className={`text-[14px] ${props.strong ? 'font-medium' : ''}`}>{props.label}</div>
        {props.detail && <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{props.detail}</div>}
      </div>
    </div>
  )
}

/** Expandable, paged list of items in one classification – explains exactly why each file was treated as it was. */
export function ItemList(props: {
  importId: number
  classification: ItemClassification
  title: string
  count: number
  defaultOpen?: boolean
  onlyFailed?: boolean
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  const [items, setItems] = useState<ImportItemInfo[] | null>(null)
  useEffect(() => {
    if (open && items === null) void api.importItems(props.importId, props.classification, 0, 500).then((all) => setItems(props.onlyFailed ? all.filter((i) => i.outcome === 'failed') : all))
  }, [open, items, props.importId, props.classification, props.onlyFailed])
  if (props.count === 0) return null
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-[13px] font-medium text-stone-700 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white"
      >
        <ChevronDown className={`size-4 transition-transform ${open ? '' : '-rotate-90'}`} />
        {props.title}
        <span className="font-normal text-stone-400">{n(props.count)}</span>
      </button>
      {open && (
        <div className="scroll-thin mb-2 ml-6 max-h-56 space-y-1.5 overflow-y-auto pr-2">
          {items === null && <div className="skeleton h-4 w-48 rounded" />}
          {items?.map((it) => (
            <div key={it.id} className="text-[12.5px] leading-snug">
              <div className="truncate text-stone-800 dark:text-stone-200" title={it.relativePath}>
                {it.relativePath}
              </div>
              <div className="truncate text-stone-500 dark:text-stone-400">
                {it.classification === 'duplicate_library' || it.classification === 'duplicate_batch'
                  ? `Identical to ${it.matchRelativePath ?? it.matchFilename ?? 'another file in this import'}`
                  : it.error ?? it.outcome ?? ''}
                {it.sha256 && (it.classification === 'duplicate_library' || it.classification === 'duplicate_batch') && (
                  <span className="font-mono text-[11px] text-stone-400"> · {it.sha256.slice(0, 12)}…</span>
                )}
              </div>
            </div>
          ))}
          {items && !props.onlyFailed && items.length < props.count && <div className="text-xs text-stone-400">…and {n(props.count - items.length)} more (see Imports)</div>}
        </div>
      )}
    </div>
  )
}

function EtaLine({ p }: { p: ImportProgress }) {
  return (
    <div className="mx-8 mt-5 flex justify-between gap-4 text-xs text-stone-500 dark:text-stone-400">
      <span className="font-medium text-stone-700 dark:text-stone-300">{etaLabel(p.etaSeconds)}</span>
      <span className="shrink-0 tabular-nums">
        {[rateLabel(p.rate, p.rateUnit), `${clockLabel(p.elapsedSeconds)} elapsed`].filter(Boolean).join(' · ')}
      </span>
    </div>
  )
}

function Importing({ p }: { p: ImportProgress }) {
  const linking = p.phase === 'linking'
  return (
    <div className="pb-8">
      <Header icon={<LoaderCircle className="size-5 animate-spin" />} title={linking ? 'Recording sources…' : 'Importing…'} subtitle={p.sourcePath} />
      <div className="mx-8 mt-7">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums tracking-tight">
            {n(p.committed)} <span className="text-base font-normal text-stone-400">of {n(p.commitTotal)}</span>
          </span>
          <span className="text-xs tabular-nums text-stone-500">{clockLabel(p.elapsedSeconds)} elapsed</span>
        </div>
        <Bar value={linking ? 1 : p.bytesTotal > 0 ? p.bytesProcessed : p.committed} total={linking ? 1 : p.bytesTotal > 0 ? p.bytesTotal : p.commitTotal} />
        {!linking && (
          <div className="mt-2 flex justify-between gap-4 text-xs text-stone-500 dark:text-stone-400">
            <span className="font-medium text-stone-700 dark:text-stone-300">{etaLabel(p.etaSeconds)}</span>
            <span className="shrink-0 tabular-nums">
              {[rateLabel(p.rate, p.rateUnit), p.bytesTotal > 0 && `${bytes(p.bytesProcessed)} of ${bytes(p.bytesTotal)}`].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
        <div className="mt-2 truncate text-xs text-stone-500 dark:text-stone-400">
          {linking ? 'Remembering where duplicates were found' : p.currentFile ? `Copying and verifying ${basename(p.currentFile)}` : ''}
        </div>
      </div>
      <p className="mx-8 mt-6 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
        Each file is copied, re-fingerprinted and only then added to the library. You can hide this window and keep browsing; thumbnails appear as they are
        ready.
      </p>
      <div className="mx-8 mt-5 flex justify-end">
        <button
          onClick={() => void api.cancelImport(p.importId)}
          className="h-9 rounded-lg px-4 text-[13.5px] font-medium text-stone-600 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          Stop
        </button>
      </div>
    </div>
  )
}

function Completed(props: { s: ImportSummary; onShowPhotos: () => void; onClose: () => void }) {
  const s = props.s
  const duplicates = s.duplicatesLibrary + s.duplicatesBatch
  return (
    <div className="pb-8">
      <Header
        icon={<Check className="size-5" strokeWidth={2.5} />}
        tone={s.filesFailed > 0 ? 'warn' : 'success'}
        title={s.assetsCreated > 0 ? `${plural(s.assetsCreated, 'item')} imported` : 'Nothing new to import'}
        subtitle={s.sourcePath}
      />
      <div className="mt-6 grid grid-cols-3 gap-4 px-8">
        <Stat label="added to library" value={s.assetsCreated} />
        <Stat label="exact duplicates" value={duplicates} />
        <Stat label="not imported" value={s.unsupported + s.errors + s.filesFailed} muted />
      </div>
      {duplicates > 0 && (
        <p className="mx-8 mt-6 text-[12.5px] leading-relaxed text-stone-600 dark:text-stone-400">
          {plural(duplicates, 'file')} matched photos already in your library byte-for-byte. Their locations were recorded; no extra copies were made.
        </p>
      )}
      {s.filesFailed > 0 && (
        <div className="mx-8 mt-4 space-y-1">
          <ItemList importId={s.importId} classification="new" title="Failed to copy" count={s.filesFailed} onlyFailed />
        </div>
      )}
      <div className="mx-8 mt-7 flex justify-end gap-2">
        <button onClick={props.onClose} className="h-9 rounded-lg px-4 text-[13.5px] font-medium text-stone-600 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">
          Close
        </button>
        <button
          onClick={props.onShowPhotos}
          className="h-9 rounded-lg bg-stone-900 px-4 text-[13.5px] font-medium text-white transition hover:bg-stone-800 active:scale-[0.98] dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
        >
          View photos
        </button>
      </div>
    </div>
  )
}

function Message(props: { icon: ReactNode; title: string; body: string; onClose: () => void }) {
  return (
    <div className="pb-8">
      <Header icon={props.icon} title={props.title} tone="warn" />
      <p className="mx-8 mt-3 text-[13.5px] leading-relaxed text-stone-600 dark:text-stone-400">{props.body}</p>
      <div className="mx-8 mt-7 flex justify-end">
        <button onClick={props.onClose} className="h-9 rounded-lg bg-stone-900 px-4 text-[13.5px] font-medium text-white dark:bg-white dark:text-stone-900">
          OK
        </button>
      </div>
    </div>
  )
}

function ErrorState(props: { title?: string; message: string; onClose: () => void }) {
  return <Message icon={<CircleAlert className="size-5" />} title={props.title ?? 'Import couldn’t start'} body={props.message} onClose={props.onClose} />
}
