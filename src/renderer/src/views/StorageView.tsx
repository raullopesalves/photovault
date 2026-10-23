import { useEffect, useState } from 'react'
import { CircleAlert, FolderOpen, HardDrive, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { LibraryInfo, VerifyIssue, VerifyProgress } from '@shared/types'
import { api, bytes, etaLabel, isoLocal, n, plural } from '../lib/format'
import { PageHeader } from './Placeholder'
import { BackupPanel } from '../components/BackupPanel'
import { t } from '../lib/i18n'

export function StorageView({ library, version }: { library: LibraryInfo; version: number }) {
  return (
    <div className="scroll-page h-full overflow-y-auto">
      <PageHeader title={t('Safety')} subtitle={t('Where your originals live, their backup copies, and checks that every file is still intact.')} />
      <div className="mx-auto max-w-4xl space-y-4 px-8 pb-12">
        <SafetyStatement library={library} />
        <div id="backups" className="scroll-mt-20">
          <BackupPanel version={version} />
        </div>

        <div className="flex items-center gap-5 rounded-[14px] border border-line bg-card p-5">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">
            <HardDrive className="size-6" strokeWidth={1.6} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">{t('Photo Vault library')}</div>
            <div className="truncate text-xs text-ink-muted">{library.path}</div>
          </div>
          <div className="text-right">
            <div className="text-[17px] font-semibold tabular-nums">{bytes(library.totalBytes)}</div>
            {library.binCount > 0 && <div className="text-xs text-ink-muted">{t('incl.')}{' '}{bytes(library.binBytes)}{' '}{t('in the Bin')}</div>}
            <div className="text-xs text-ink-muted">
              {n(library.photoCount)}{' '}{t('photos ·')}{' '}{n(library.videoCount)}{' '}{t('videos')}</div>
          </div>
          <button
            onClick={() => void api.openLibraryFolder()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-stone-100 px-3 text-[13px] font-medium transition hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"
          >
            <FolderOpen className="size-4" />{' '}{t('Open')}</button>
        </div>

        <VerifyCard />

      </div>
    </div>
  )
}

/**
 * The one question Safety answers first: does every item have a second copy? With no backup at all, the backup
 * panel's own warning says it (with the button to fix it), so this shows only once a backup exists.
 */
function SafetyStatement({ library }: { library: LibraryInfo }) {
  const { assetCount, unprotectedCount } = library
  if (assetCount === 0 || unprotectedCount >= assetCount) return null
  const safe = unprotectedCount === 0
  return (
    <section className={`flex items-center gap-4 rounded-[14px] px-5 py-4 ${safe ? 'bg-safe-soft' : 'bg-brass-soft'}`}>
      <div className={`grid size-11 shrink-0 place-items-center rounded-lg bg-card ${safe ? 'text-safe' : 'text-brass-ink'}`}>
        {safe ? <ShieldCheck className="size-[22px]" strokeWidth={1.75} /> : <ShieldAlert className="size-[22px]" strokeWidth={1.75} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-[family-name:var(--font-display)] text-[19px] font-[650] leading-6 tracking-[-0.01em] text-ink">
          {safe ? t('Every item has a backup copy') : t('{count} items have only one copy', { count: n(unprotectedCount) })}
        </div>
        <div className="mt-0.5 text-[14px] leading-5 text-ink">
          {safe ? t('Plug your backup drives in now and then, and they are brought up to date.') : t('Plug in your backup drive and they are copied straight away.')}
        </div>
      </div>
    </section>
  )
}

function VerifyCard() {
  const [v, setV] = useState<VerifyProgress | null>(null)
  const [issues, setIssues] = useState<VerifyIssue[]>([])

  useEffect(() => {
    void api.currentVerify().then(setV)
    return api.onVerifyProgress(setV)
  }, [])

  const finishedId = v && v.status !== 'running' ? v.id : null
  useEffect(() => {
    if (finishedId !== null) void api.verifyIssues(0, 200).then(setIssues)
  }, [finishedId])

  const running = v?.status === 'running'
  const problems = v ? v.missing + v.mismatched : 0
  const pct = v && v.bytesTotal > 0 ? Math.min(100, (v.bytesChecked / v.bytesTotal) * 100) : v && v.filesTotal > 0 ? (v.filesChecked / v.filesTotal) * 100 : 0

  return (
    <div className="rounded-[14px] border border-line bg-card p-5">
      <div className="flex items-start gap-4">
        <div
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${
            problems > 0
              ? 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400'
              : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
          }`}
        >
          {running ? <LoaderCircle className="size-5 animate-spin" /> : problems > 0 ? <CircleAlert className="size-5" /> : <ShieldCheck className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">{t('Verify originals')}</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">
            {!v && t('Re-reads every original and compares it with the SHA-256 fingerprint recorded at import. Nothing is changed.')}
            {running && v && t('Checking {filesChecked} of {filesTotal} files · {v2}{v3}', { filesChecked: n(v.filesChecked), filesTotal: n(v.filesTotal), v2: etaLabel(v.etaSeconds), v3: v.rate ? ` · ${bytes(v.rate)}/s` : '' })}
            {v && v.status === 'completed' && problems === 0 && t('All {ok} verified intact · {v1}', { ok: plural(v.ok, 'original'), v1: isoLocal(v.completedAt) })}
            {v && v.status === 'completed' && problems > 0 && (
              <span className="text-red-700 dark:text-red-300">
                {v.missing > 0 && `${plural(v.missing, 'file')} missing`}
                {v.missing > 0 && v.mismatched > 0 && ' · '}
                {v.mismatched > 0 && t('{mismatched} changed or damaged', { mismatched: plural(v.mismatched, 'file') })} · {n(v.ok)}{' '}{t('intact ·')}{' '}{isoLocal(v.completedAt)}
              </span>
            )}
            {v && (v.status === 'cancelled' || v.status === 'interrupted') && t('Last check stopped after {filesChecked} of {filesTotal} files.', { filesChecked: n(v.filesChecked), filesTotal: n(v.filesTotal) })}
            {v && v.status === 'failed' && t('Verification failed: {error}', { error: v.error })}
          </div>
        </div>
        {running ? (
          <button
            onClick={() => void api.cancelVerify()}
            className="h-9 shrink-0 rounded-lg px-3 text-[13px] font-medium text-stone-600 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          >{t('Stop')}</button>
        ) : (
          <button
            onClick={() => void api.startVerify().then(setV)}
            className="h-9 shrink-0 rounded-lg bg-stone-900 px-3.5 text-[13px] font-medium text-white transition hover:bg-stone-800 active:scale-[0.98] dark:bg-white dark:hover:bg-stone-200 dark:text-stone-900"
          >
            {v ? t('Verify again') : t('Verify library')}
          </button>
        )}
      </div>
      {running && (
        <div className="ml-14 mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
          <div className="h-full rounded-full bg-accent-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
      {!running && problems > 0 && issues.length > 0 && (
        <div className="scroll-thin ml-14 mt-4 max-h-64 space-y-1.5 overflow-y-auto pr-2">
          {issues.map((i) => (
            <div key={i.fileId} className="flex items-baseline gap-3 text-[12.5px]">
              <span className={`w-20 shrink-0 font-medium ${i.status === 'missing' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                {i.status === 'missing' ? t('Missing') : t('Changed')}
              </span>
              <span className="min-w-0 flex-1 truncate" title={i.relativePath}>
                {i.relativePath}
              </span>
            </div>
          ))}
          <p className="pt-2 text-xs leading-relaxed text-ink-muted">{t('Photo Vault never repairs or deletes files on its own. Restore these from a backup, or re-import them from the original source — identical bytes will be recognised.')}</p>
        </div>
      )}
    </div>
  )
}
