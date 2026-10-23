import { useEffect, useState } from 'react'
import { CircleAlert, Database as DbIcon, FolderOpen, HardDriveDownload, LoaderCircle, Plus, ShieldCheck, X } from 'lucide-react'
import type { BackupProgress, BackupStatus, DbSnapshot } from '@shared/types'
import { api, bytes, etaLabel, isoLocal, n, plural } from '../lib/format'
import { ConfirmDialog, PromptDialog } from './Dialog'
import { t } from '../lib/i18n'

const btn = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition disabled:opacity-40'
const soft = `${btn} bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`

/** Second copies on other drives, with verification, plus catalogue snapshots. */
export function BackupPanel(props: { version: number }) {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  const [naming, setNaming] = useState<{ id: number; label: string } | null>(null)

  const refresh = (): void => void api.backupStatus().then(setStatus)
  useEffect(refresh, [props.version])
  useEffect(() => {
    void api.currentBackup().then(setProgress)
    return api.onBackupProgress((p) => {
      setProgress(p.status === 'running' ? p : null)
      if (p.status !== 'running') refresh()
    })
  }, [])

  if (!status) return <div className="skeleton h-32 rounded-xl" />
  const unprotected = status.totalAssets - status.protectedAssets
  const fully = status.targets.length > 0 && unprotected === 0
  const run = async (id: number, verify: boolean): Promise<void> => {
    setError(null)
    try {
      await api.runBackup(id, verify)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
    refresh()
  }

  return (
    <div className="space-y-4">
      <div
        className={`flex items-start gap-4 rounded-[14px] p-5 ${fully ? 'bg-safe-soft' : 'bg-brass-soft'}`}
      >
        <div
          className={`grid size-11 shrink-0 place-items-center rounded-xl ${
            fully ? 'bg-card text-safe' : 'bg-card text-brass-ink'
          }`}
        >
          {fully ? <ShieldCheck className="size-6" /> : <CircleAlert className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[15px] font-semibold ${fully ? 'text-emerald-900 dark:text-emerald-200' : 'text-amber-900 dark:text-amber-200'}`}>
            {status.targets.length === 0
              ? t('Only one copy of your photos exists')
              : fully
                ? t('All {totalAssets} have a verified second copy', { totalAssets: plural(status.totalAssets, 'item') })
                : t('{protectedAssets} of {totalAssets} items have a verified second copy', { protectedAssets: n(status.protectedAssets), totalAssets: n(status.totalAssets) })}
          </div>
          <p className={`mt-1 text-[13px] leading-relaxed ${fully ? 'text-emerald-800/80 dark:text-emerald-200/70' : 'text-amber-900/80 dark:text-amber-200/70'}`}>
            {status.targets.length === 0
              ? t('If this drive fails, everything is lost. Add a backup location on another drive (external disk, NAS, or a cloud-synced folder) — Photo Vault copies every original there, checks each copy, and keeps it up to date after every import.')
              : t('Backups are complete, openable Photo Vault libraries: if the main drive fails, use “Open another library…” on the backup folder. Nothing is ever deleted from a backup automatically.')}
          </p>
        </div>
        <button onClick={async () => {
          setError(null)
          try {
            await api.addBackupTarget()
          } catch (err) {
            setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
          }
          refresh()
        }} className={`${btn} bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:hover:bg-stone-200 dark:text-stone-900`}>
          <Plus className="size-3.5" />{' '}{t('Add backup location')}</button>
      </div>
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-800 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

      {status.targets.map((tg) => {
        const running = progress && progress.targetId === tg.id ? progress : null
        const pct = status.totalFiles > 0 ? (tg.filesBackedUp / status.totalFiles) * 100 : 0
        return (
          <div key={tg.id} className="rounded-[14px] border border-line bg-card p-5">
            <div className="flex items-start gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">
                {running ? <LoaderCircle className="size-5 animate-spin" /> : <HardDriveDownload className="size-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setNaming({ id: tg.id, label: tg.label ?? '' })}
                    className="truncate text-left text-[14px] font-medium hover:text-accent-600"
                    title={t('{path} — click to name this drive', { path: tg.path })}
                  >
                    {tg.label ?? tg.path}
                  </button>
                  {tg.reachable && tg.missingAssets === 0 && (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">{t('up to date')}</span>
                  )}
                  {tg.missingAssets > 0 && tg.lastCompletedAt && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      {plural(tg.missingAssets, 'item')}{' '}{t('not on it yet')}</span>
                  )}
                </div>
                {tg.label && <div className="truncate text-[11.5px] text-ink-faint">{tg.path}</div>}
                <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                  {!tg.reachable
                    ? t('Not connected{v0}. Plug it in: it is brought up to date automatically.', { v0: tg.lastCompletedAt ? t(' — last updated {v0}', { v0: ago(tg.lastCompletedAt) }) : '' })
                    : t('{filesBackedUp} of {totalFiles} originals copied and verified · {v2}', { filesBackedUp: n(tg.filesBackedUp), totalFiles: n(status.totalFiles), v2: bytes(tg.bytesBackedUp) })}
                  {tg.lastCompletedAt && t(' · last backup {v0}', { v0: isoLocal(tg.lastCompletedAt) })}
                  {tg.lastVerifiedAt && t(' · fully verified {v0}', { v0: isoLocal(tg.lastVerifiedAt) })}
                  {tg.filesWithProblems > 0 && <span className="text-red-600 dark:text-red-400"> · {plural(tg.filesWithProblems, 'copy', 'copies')}{' '}{t('failed')}</span>}
                </div>
                {tg.lastError && !running && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{tg.lastError}</div>}
              </div>
              <button onClick={() => setRemoving(tg.id)} className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800" title={t('Remove this backup location')}>
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
              <div
                className="h-full rounded-full bg-accent-500 transition-[width] duration-300"
                style={{ width: `${running ? (running.bytesDone / Math.max(1, running.bytesTotal)) * 100 : pct}%` }}
              />
            </div>
            {running && (
              <div className="mt-2 flex justify-between gap-4 text-xs text-ink-muted">
                <span className="font-medium text-stone-700 dark:text-stone-300">
                  {running.mode === 'verify' ? t('Verifying') : t('Copying')} {n(running.filesDone)}{' '}{t('of')}{' '}{n(running.filesTotal)} · {etaLabel(running.etaSeconds)}
                </span>
                <span className="tabular-nums">
                  {bytes(running.bytesDone)}{' '}{t('of')}{' '}{bytes(running.bytesTotal)}
                  {running.rate ? ` · ${bytes(running.rate)}/s` : ''}
                </span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {running ? (
                <button onClick={() => void api.cancelBackup()} className={soft}>{t('Stop')}</button>
              ) : (
                <>
                  <button disabled={!!progress || !tg.reachable} onClick={() => void run(tg.id, false)} className={`${btn} bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:hover:bg-stone-200 dark:text-stone-900`}>{t('Back up now')}</button>
                  <button disabled={!!progress || !tg.reachable} onClick={() => void run(tg.id, true)} className={soft} title={t('Re-read every copy and compare its fingerprint; repairs missing or damaged copies')}>{t('Verify all copies')}</button>
                </>
              )}
              <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={tg.auto}
                  onChange={async (e) => {
                    await api.setBackupAuto(tg.id, e.target.checked)
                    refresh()
                  }}
                  className="size-3.5 accent-accent-500"
                />{t('Back up automatically after imports')}</label>
            </div>
          </div>
        )
      })}

      {status.targets.length > 0 && (
        <div className="rounded-[14px] border border-line bg-card px-5 py-4 text-xs leading-relaxed text-ink-muted">
          <span className="font-medium text-stone-700 dark:text-stone-300">{t('Keep a copy away from home.')}</span>{' '}{t('A fire or theft takes a backup drive that sits next to the computer too. With two drives, keep one elsewhere (work, family) and swap them every month or so — each is brought up to date the moment it is plugged in.')}{' '}{status.targets.length === 1 && t('Add a second drive here to start rotating.')}
          <div className="mt-2">{t('Checks: your library\'s files are re-read and compared with their fingerprints automatically every month')}{status.lastLibraryCheck ? t(' (last complete check {v0})', { v0: ago(status.lastLibraryCheck) }) : t(' (first check soon)')}{t('; connected backup drives are verified on the same schedule.')}</div>
        </div>
      )}

      <SnapshotsCard version={props.version} />

      {naming && (
        <PromptDialog
          title={t('Name this backup drive')}
          label={t('For example “Drive at home” or “Drive at Mum\'s”. Helps when rotating drives.')}
          initial={naming.label}
          placeholder={t('Name')}
          confirm={t('Save')}
          onClose={() => setNaming(null)}
          onSubmit={async (value) => {
            await api.setBackupLabel(naming.id, value || null)
            setNaming(null)
            refresh()
          }}
        />
      )}

      {removing !== null && (
        <ConfirmDialog
          title={t('Remove this backup location?')}
          body={t('Photo Vault stops updating it. The files already copied there are left exactly as they are.')}
          confirm={t('Remove location')}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.removeBackupTarget(removing)
            setRemoving(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function SnapshotsCard(props: { version: number }) {
  const [snaps, setSnaps] = useState<DbSnapshot[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState<DbSnapshot | null>(null)
  const refresh = (): void => void api.dbSnapshots().then(setSnaps)
  useEffect(refresh, [props.version])
  const latest = snaps?.[0]
  return (
    <div className="flex items-start gap-4 rounded-[14px] border border-line bg-card p-5">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
        <DbIcon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{t('Catalogue snapshots')}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{t('Albums, labels, dates and history live in the catalogue database. Photo Vault snapshots it daily, after every import, before permanent deletes and before upgrades.')}{' '}
          {latest ? t('{count} kept · latest {date} ({reason}).', { count: plural(snaps?.length ?? 0, 'snapshot'), date: isoLocal(latest.createdAt), reason: (REASONS[latest.reason] ?? latest.reason).toLowerCase() }) : t('No snapshot yet.')}
        </p>
        {snaps && snaps.length > 0 && (
          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {snaps.map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-stone-50 dark:hover:bg-stone-800/60">
                <span className="w-40 shrink-0 tabular-nums">{isoLocal(s.createdAt)}</span>
                <span className="flex-1 text-ink-muted">{REASONS[s.reason] ?? s.reason}</span>
                <span className="text-ink-faint">{bytes(s.sizeBytes)}</span>
                <button onClick={() => setRestoring(s)} className="rounded-md px-2 py-0.5 font-medium text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-500/10">{t('Restore')}</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => void api.openSnapshotsFolder()} className={soft}>
          <FolderOpen className="size-3.5" />{' '}{t('Open')}</button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await api.snapshotNow()
            setBusy(false)
            refresh()
          }}
          className={soft}
        >{t('Snapshot now')}</button>
      </div>
      {restoring && (
        <ConfirmDialog
          title={t('Restore the catalogue from {v0}?', { v0: isoLocal(restoring.createdAt) })}
          body={t('Albums, people, dates, labels and everything else go back to how they were then. Your current catalogue is saved first, so this can be undone by restoring that copy. Photo files are not touched; photos imported after this point stay on disk and come back when you import their source again.')}
          confirm={t('Restore')}
          destructive
          onClose={() => setRestoring(null)}
          onConfirm={async () => {
            const s = restoring
            setRestoring(null)
            setBusy(true)
            try {
              await api.restoreSnapshot(s.name)
            } finally {
              setBusy(false)
              refresh()
            }
          }}
        />
      )}
    </div>
  )
}

const REASONS: Record<string, string> = {
  daily: t('Daily'),
  import: t('After an import'),
  'before-delete': t('Before a permanent delete'),
  manual: t('Taken by you'),
  'before-upgrade': t('Before an app update'),
  'before-restore': t('Before a restore'),
  unknown: t('Snapshot')
}

/** "3 days ago", "today". */
function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 60) return t('{days} days ago', { days })
  return t('{v0} months ago', { v0: Math.round(days / 30) })
}
