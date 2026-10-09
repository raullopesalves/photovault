import { useEffect, useState } from 'react'
import { CircleAlert, Database as DbIcon, FolderOpen, HardDriveDownload, LoaderCircle, Plus, ShieldCheck, X } from 'lucide-react'
import type { BackupProgress, BackupStatus, DbSnapshot } from '@shared/types'
import { api, bytes, etaLabel, isoLocal, n, plural } from '../lib/format'
import { ConfirmDialog, PromptDialog } from './Dialog'

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
        className={`flex items-start gap-4 rounded-xl p-5 shadow-sm shadow-stone-900/5 ${
          fully ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-amber-50 dark:bg-amber-500/10'
        }`}
      >
        <div
          className={`grid size-11 shrink-0 place-items-center rounded-xl ${
            fully ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
          }`}
        >
          {fully ? <ShieldCheck className="size-6" /> : <CircleAlert className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[15px] font-semibold ${fully ? 'text-emerald-900 dark:text-emerald-200' : 'text-amber-900 dark:text-amber-200'}`}>
            {status.targets.length === 0
              ? 'Only one copy of your photos exists'
              : fully
                ? `All ${plural(status.totalAssets, 'item')} have a verified second copy`
                : `${n(status.protectedAssets)} of ${n(status.totalAssets)} items have a verified second copy`}
          </div>
          <p className={`mt-1 text-[13px] leading-relaxed ${fully ? 'text-emerald-800/80 dark:text-emerald-200/70' : 'text-amber-900/80 dark:text-amber-200/70'}`}>
            {status.targets.length === 0
              ? 'If this drive fails, everything is lost. Add a backup location on another drive (external disk, NAS, or a cloud-synced folder) — Photo Vault copies every original there, checks each copy, and keeps it up to date after every import.'
              : 'Backups are complete, openable Photo Vault libraries: if the main drive fails, use “Open another library…” on the backup folder. Nothing is ever deleted from a backup automatically.'}
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
        }} className={`${btn} bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900`}>
          <Plus className="size-3.5" /> Add backup location
        </button>
      </div>
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-800 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

      {status.targets.map((t) => {
        const running = progress && progress.targetId === t.id ? progress : null
        const pct = status.totalFiles > 0 ? (t.filesBackedUp / status.totalFiles) * 100 : 0
        return (
          <div key={t.id} className="rounded-xl bg-white p-5 shadow-sm shadow-stone-900/5 dark:bg-stone-900">
            <div className="flex items-start gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">
                {running ? <LoaderCircle className="size-5 animate-spin" /> : <HardDriveDownload className="size-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setNaming({ id: t.id, label: t.label ?? '' })}
                    className="truncate text-left text-[14px] font-medium hover:text-accent-600"
                    title={`${t.path} — click to name this drive`}
                  >
                    {t.label ?? t.path}
                  </button>
                  {t.reachable && t.missingAssets === 0 && (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">up to date</span>
                  )}
                  {t.missingAssets > 0 && t.lastCompletedAt && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      {plural(t.missingAssets, 'item')} not on it yet
                    </span>
                  )}
                </div>
                {t.label && <div className="truncate text-[11.5px] text-stone-400">{t.path}</div>}
                <div className="mt-0.5 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                  {!t.reachable
                    ? `Not connected${t.lastCompletedAt ? ` — last updated ${ago(t.lastCompletedAt)}` : ''}. Plug it in: it is brought up to date automatically.`
                    : `${n(t.filesBackedUp)} of ${n(status.totalFiles)} originals copied and verified · ${bytes(t.bytesBackedUp)}`}
                  {t.lastCompletedAt && ` · last backup ${isoLocal(t.lastCompletedAt)}`}
                  {t.lastVerifiedAt && ` · fully verified ${isoLocal(t.lastVerifiedAt)}`}
                  {t.filesWithProblems > 0 && <span className="text-red-600 dark:text-red-400"> · {plural(t.filesWithProblems, 'copy', 'copies')} failed</span>}
                </div>
                {t.lastError && !running && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{t.lastError}</div>}
              </div>
              <button onClick={() => setRemoving(t.id)} className="grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800" title="Remove this backup location">
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
              <div className="mt-2 flex justify-between gap-4 text-xs text-stone-500 dark:text-stone-400">
                <span className="font-medium text-stone-700 dark:text-stone-300">
                  {running.mode === 'verify' ? 'Verifying' : 'Copying'} {n(running.filesDone)} of {n(running.filesTotal)} · {etaLabel(running.etaSeconds)}
                </span>
                <span className="tabular-nums">
                  {bytes(running.bytesDone)} of {bytes(running.bytesTotal)}
                  {running.rate ? ` · ${bytes(running.rate)}/s` : ''}
                </span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {running ? (
                <button onClick={() => void api.cancelBackup()} className={soft}>
                  Stop
                </button>
              ) : (
                <>
                  <button disabled={!!progress || !t.reachable} onClick={() => void run(t.id, false)} className={`${btn} bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900`}>
                    Back up now
                  </button>
                  <button disabled={!!progress || !t.reachable} onClick={() => void run(t.id, true)} className={soft} title="Re-read every copy and compare its fingerprint; repairs missing or damaged copies">
                    Verify all copies
                  </button>
                </>
              )}
              <label className="ml-auto flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                <input
                  type="checkbox"
                  checked={t.auto}
                  onChange={async (e) => {
                    await api.setBackupAuto(t.id, e.target.checked)
                    refresh()
                  }}
                  className="size-3.5 accent-accent-500"
                />
                Back up automatically after imports
              </label>
            </div>
          </div>
        )
      })}

      {status.targets.length > 0 && (
        <div className="rounded-xl bg-white px-5 py-4 text-xs leading-relaxed text-stone-500 shadow-sm shadow-stone-900/5 dark:bg-stone-900 dark:text-stone-400">
          <span className="font-medium text-stone-700 dark:text-stone-300">Keep a copy away from home.</span> A fire or theft takes a backup drive that sits next
          to the computer too. With two drives, keep one elsewhere (work, family) and swap them every month or so — each is brought up to date the moment it
          is plugged in. {status.targets.length === 1 && 'Add a second drive here to start rotating.'}
          <div className="mt-2">
            Checks: your library's files are re-read and compared with their fingerprints automatically every month
            {status.lastLibraryCheck ? ` (last complete check ${ago(status.lastLibraryCheck)})` : ' (first check soon)'}; connected backup drives are verified on the
            same schedule.
          </div>
        </div>
      )}

      <SnapshotsCard version={props.version} />

      {naming && (
        <PromptDialog
          title="Name this backup drive"
          label="For example “Drive at home” or “Drive at Mum's”. Helps when rotating drives."
          initial={naming.label}
          placeholder="Name"
          confirm="Save"
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
          title="Remove this backup location?"
          body="Photo Vault stops updating it. The files already copied there are left exactly as they are."
          confirm="Remove location"
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
    <div className="flex items-start gap-4 rounded-xl bg-white p-5 shadow-sm shadow-stone-900/5 dark:bg-stone-900">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
        <DbIcon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">Catalogue snapshots</div>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
          Albums, labels, dates and history live in the catalogue database. Photo Vault snapshots it daily, after every import, before permanent deletes and
          before upgrades.{' '}
          {latest ? `${plural(snaps?.length ?? 0, 'snapshot')} kept · latest ${isoLocal(latest.createdAt)} (${latest.reason}).` : 'No snapshot yet.'}
        </p>
        {snaps && snaps.length > 0 && (
          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {snaps.map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-stone-50 dark:hover:bg-stone-800/60">
                <span className="w-40 shrink-0 tabular-nums">{isoLocal(s.createdAt)}</span>
                <span className="flex-1 text-stone-500 dark:text-stone-400">{REASONS[s.reason] ?? s.reason}</span>
                <span className="text-stone-400">{bytes(s.sizeBytes)}</span>
                <button onClick={() => setRestoring(s)} className="rounded-md px-2 py-0.5 font-medium text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-500/10">
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => void api.openSnapshotsFolder()} className={soft}>
          <FolderOpen className="size-3.5" /> Open
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await api.snapshotNow()
            setBusy(false)
            refresh()
          }}
          className={soft}
        >
          Snapshot now
        </button>
      </div>
      {restoring && (
        <ConfirmDialog
          title={`Restore the catalogue from ${isoLocal(restoring.createdAt)}?`}
          body="Albums, people, dates, labels and everything else go back to how they were then. Your current catalogue is saved first, so this can be undone by restoring that copy. Photo files are not touched; photos imported after this point stay on disk and come back when you import their source again."
          confirm="Restore"
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
  daily: 'Daily',
  import: 'After an import',
  'before-delete': 'Before a permanent delete',
  manual: 'Taken by you',
  'before-upgrade': 'Before an app update',
  'before-restore': 'Before a restore',
  unknown: 'Snapshot'
}

/** "3 days ago", "today". */
function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 60) return `${days} days ago`
  return `${Math.round(days / 30)} months ago`
}
