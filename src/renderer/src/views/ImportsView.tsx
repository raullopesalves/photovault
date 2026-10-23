import { useEffect, useState } from 'react'
import { ArrowLeft, Eye, FileArchive, FolderInput, FolderSync, Play, RefreshCw, X } from 'lucide-react'
import type { ImportSummary, WatchFolder } from '@shared/types'
import { api, basename, bytes, isoLocal, n, sourcesLabel, sourceTypeLabel } from '../lib/format'
import type { ImportKind } from '../components/ImportMenu'
import { ItemList } from '../components/ImportSheet'
import { PageHeader } from './Placeholder'
import { t } from '../lib/i18n'

const STATUS: Record<string, { label: string; cls: string }> = {
  completed: { label: t('Completed'), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  ready: { label: t('Awaiting review'), cls: 'bg-accent-100 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400' },
  scanning: { label: t('Scanning'), cls: 'bg-accent-100 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400' },
  importing: { label: t('Importing'), cls: 'bg-accent-100 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400' },
  cancelled: { label: t('Cancelled'), cls: 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400' },
  interrupted: { label: t('Interrupted'), cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  failed: { label: t('Failed'), cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' }
}

export function ImportsView(props: { version: number; onImport: (kind: ImportKind) => void; onResume: (importId: number) => void; busy: boolean }) {
  const [list, setList] = useState<ImportSummary[] | null>(null)
  const [selected, setSelected] = useState<ImportSummary | null>(null)

  useEffect(() => {
    void api.imports().then(setList)
  }, [props.version])

  if (selected) return <ImportDetail s={selected} onBack={() => setSelected(null)} />

  return (
    <div className="scroll-page h-full overflow-y-auto">
      <PageHeader title={t('Imports')} subtitle={t('Every import is logged: what was found, what was copied and what was recognised as a duplicate.')} />
      <div className="mx-auto max-w-4xl px-8 pb-12">
        <WatchFolders version={props.version} />
        {list?.length === 0 && (
          <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-16 text-center dark:border-stone-700">
            <FolderInput className="mb-3 size-8 text-ink-faint" strokeWidth={1.5} />
            <div className="font-medium">{t('No imports yet')}</div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => props.onImport('folder')} className="h-9 rounded-lg bg-stone-900 px-4 text-[13.5px] font-medium text-white dark:bg-white dark:text-stone-900">{t('Import a folder')}</button>
              <button onClick={() => props.onImport('zip')} className="h-9 rounded-lg bg-stone-200/70 px-4 text-[13.5px] font-medium dark:bg-stone-800">{t('Google Takeout / ZIP')}</button>
              <button onClick={() => props.onImport('phone')} className="h-9 rounded-lg bg-stone-200/70 px-4 text-[13.5px] font-medium dark:bg-stone-800">{t('Phone or camera')}</button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {list?.map((s) => {
            const status = STATUS[s.status] ?? { label: s.status, cls: '' }
            const archive = s.sourceType !== 'LOCAL_FOLDER'
            return (
              <div
                key={s.importId}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(s)}
                onKeyDown={(e) => e.key === 'Enter' && setSelected(s)}
                className="flex w-full cursor-default items-center gap-5 rounded-[14px] border border-line bg-card px-5 py-4 text-left transition hover:border-line-strong dark:hover:bg-stone-800/80"
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-stone-100 text-ink-muted dark:bg-stone-800 dark:text-stone-400">
                  {archive ? <FileArchive className="size-5" strokeWidth={1.6} /> : <FolderInput className="size-5" strokeWidth={1.6} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium">{sourcesLabel(s.sources)}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${status.cls}`}>{status.label}</span>
                    {s.trigger === 'watch' && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10.5px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                        <FolderSync className="size-3" />{' '}{t('Automatic')}</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-muted">
                    {isoLocal(s.startedAt)} · {sourceTypeLabel(s.sourceType)} · {s.sourcePath}
                  </div>
                </div>
                {s.resumable && (
                  <button
                    disabled={props.busy}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onResume(s.importId)
                    }}
                    title={props.busy ? t('Finish the current import first') : t('Review and continue this import')}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-stone-800 disabled:opacity-40 dark:bg-white dark:hover:bg-stone-200 dark:text-stone-900"
                  >
                    <Play className="size-3 fill-current" />{' '}{t('Resume')}</button>
                )}
                <div className="flex shrink-0 gap-6 text-right">
                  <Metric value={s.status === 'completed' ? s.assetsCreated : s.newAssets} label={s.status === 'completed' ? 'added' : 'new'} />
                  <Metric value={s.duplicatesLibrary + s.duplicatesBatch} label={t('duplicates')} />
                  <Metric value={s.filesScanned} label={t('files')} muted />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function WatchFolders(props: { version: number }) {
  const [folders, setFolders] = useState<WatchFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const reload = async (): Promise<void> => setFolders(await api.watchFolders())
  useEffect(() => {
    void reload()
  }, [props.version])

  const add = async (): Promise<void> => {
    setError(null)
    try {
      if (await api.addWatchFolder()) await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }

  return (
    <div className="mb-6 rounded-[14px] border border-line bg-card px-5 py-4">
      <div className="flex items-center gap-3">
        <FolderSync className="size-5 shrink-0 text-ink-faint" strokeWidth={1.6} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">{t('Watched folders')}</div>
          <div className="text-xs text-ink-muted">{t('New photos in these folders are imported automatically — copied, checked and de-duplicated like any import. The folders are never changed.')}</div>
        </div>
        {(folders?.length ?? 0) > 0 && (
          <button
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              await api.checkWatchFolders()
              await reload()
              setChecking(false)
            }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <RefreshCw className={`size-3.5 ${checking ? 'animate-spin' : ''}`} />{' '}{t('Check now')}</button>
        )}
        <button
          onClick={add}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3 text-[12.5px] font-medium text-white hover:bg-stone-800 dark:bg-white dark:hover:bg-stone-200 dark:text-stone-900"
        >
          <Eye className="size-3.5" />{' '}{t('Watch a folder')}</button>
      </div>
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
      {(folders?.length ?? 0) > 0 && (
        <div className="mt-3 divide-y divide-stone-100 border-t border-stone-100 dark:divide-stone-800 dark:border-stone-800">
          {folders?.map((f) => (
            <div key={f.id} className="flex items-center gap-3 py-2.5">
              <label className="flex shrink-0 items-center" title={f.enabled ? t('Watching — click to pause') : t('Paused — click to watch')}>
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={async (e) => {
                    await api.setWatchFolderEnabled(f.id, e.target.checked)
                    await reload()
                  }}
                  className="size-4 accent-accent-500"
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className={`truncate text-[13px] ${f.enabled ? '' : 'text-ink-faint'}`} title={f.path}>
                  {f.path}
                </div>
                <div className={`truncate text-[11.5px] ${f.lastError ? 'text-amber-600 dark:text-amber-400' : 'text-ink-muted'}`}>
                  {f.lastError
                    ? f.lastError
                    : !f.enabled
                      ? t('Paused')
                      : f.lastCheckedAt
                        ? `Checked ${isoLocal(f.lastCheckedAt)}${f.lastImportId ? t(' · last automatic import added {lastImported}', { lastImported: n(f.lastImported) }) : ''}`
                        : t('Waiting for the first check…')}
                </div>
              </div>
              <button
                onClick={async () => {
                  await api.removeWatchFolder(f.id)
                  await reload()
                }}
                className="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                aria-label={t('Stop watching')}
                title={t('Stop watching (nothing already imported is removed)')}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric(props: { value: number; label: string; muted?: boolean }) {
  return (
    <div className="w-16">
      <div className={`text-[15px] font-semibold tabular-nums ${props.muted ? 'text-ink-faint' : ''}`}>{n(props.value)}</div>
      <div className="text-[11px] text-ink-muted">{props.label}</div>
    </div>
  )
}

function ImportDetail({ s, onBack }: { s: ImportSummary; onBack: () => void }) {
  const rows: Array<[string, string]> = [
    [t('Type'), sourceTypeLabel(s.sourceType)],
    ...s.sources.map((src, i): [string, string] => [i === 0 ? (s.sources.length > 1 ? t('Sources') : t('Source')) : '', src]),
    [t('Started'), isoLocal(s.startedAt)],
    [t('Finished'), isoLocal(s.completedAt)],
    [t('Files scanned'), n(s.filesScanned)],
    [t('Photos / videos found'), `${n(s.photosFound)} / ${n(s.videosFound)}`],
    [t('Sidecar / other files'), `${n(s.sidecarsFound)} / ${n(s.ignoredFound)}`],
    ...(s.archivesFound > 0 ? [[t('ZIP archives'), n(s.archivesFound)] as [string, string]] : []),
    ...(s.takeoutItems > 0 ? [[t('Google metadata matched'), t('{sidecarsMatched} of {v1}', { sidecarsMatched: n(s.sidecarsMatched), v1: n(s.photosFound + s.videosFound) })] as [string, string]] : []),
    ...(s.hashesReused > 0 ? [[t('Unchanged since earlier import'), n(s.hashesReused)] as [string, string]] : []),
    [t('New items'), `${n(s.newAssets)} (${bytes(s.bytesNew)})`],
    [t('Added to library'), n(s.assetsCreated)],
    [t('Exact duplicates'), t('{duplicatesLibrary} already in library, {duplicatesBatch} repeated in source', { duplicatesLibrary: n(s.duplicatesLibrary), duplicatesBatch: n(s.duplicatesBatch) })],
    [t('Duplicate storage avoided'), bytes(s.bytesDuplicate)],
    [t('Not imported'), t('{unsupported} unrecognised, {errors} unreadable, {filesFailed} failed to copy', { unsupported: n(s.unsupported), errors: n(s.errors), filesFailed: n(s.filesFailed) })]
  ]
  return (
    <div className="scroll-page h-full overflow-y-auto">
      <div className="drag h-11" />
      <div className="mx-auto max-w-3xl px-8 pb-12">
        <button onClick={onBack} className="no-drag mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition hover:text-stone-900 dark:hover:text-stone-100">
          <ArrowLeft className="size-4" />{' '}{t('Imports')}</button>
        <h1 className="font-[family-name:var(--font-display)] text-[26px] font-semibold tracking-tight">{sourcesLabel(s.sources)}</h1>
        <div className="mt-6 overflow-hidden rounded-[14px] border border-line bg-card">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-4 border-b border-stone-100 px-5 py-2.5 text-[13px] last:border-0 dark:border-stone-800">
              <div className="w-48 shrink-0 text-ink-muted">{k}</div>
              <div className="min-w-0 break-all">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-1">
          <ItemList importId={s.importId} classification="new" title={t('New')} count={s.newAssets} />
          <ItemList importId={s.importId} classification="duplicate_library" title={t('Already in library')} count={s.duplicatesLibrary} />
          <ItemList importId={s.importId} classification="duplicate_batch" title={t('Repeated in source')} count={s.duplicatesBatch} />
          <ItemList importId={s.importId} classification="unsupported" title={t('Not recognised')} count={s.unsupported} />
          <ItemList importId={s.importId} classification="error" title={t('Could not be read')} count={s.errors} />
        </div>
      </div>
    </div>
  )
}
