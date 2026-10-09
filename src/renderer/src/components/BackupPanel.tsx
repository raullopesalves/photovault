import { useEffect, useState } from 'react'
import { CircleAlert, Database as DbIcon, FolderOpen, HardDriveDownload, LoaderCircle, Plus, ShieldCheck, X } from 'lucide-react'
import type { BackupProgress, BackupStatus, DbSnapshot } from '@shared/types'
import { api, bytes, etaLabel, isoLocal, n, plural } from '../lib/format'
import { ConfirmDialog } from './Dialog'

const btn = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition disabled:opacity-40'
const soft = `${btn} bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`

/** Second copies on other drives, with verification, plus catalogue snapshots. */
export function BackupPanel(props: { version: number }) {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)

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
                <div className="truncate text-[14px] font-medium" title={t.path}>
                  {t.path}
                </div>
                <div className="mt-0.5 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                  {!t.reachable
                    ? 'Not connected — plug in the drive and press “Back up now”.'
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

      <SnapshotsCard version={props.version} />

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
        <p className="mt-1 text-xs leading-relaxed text-stone-400 dark:text-stone-500">
          To restore one: close Photo Vault, then replace database\photovault.db with the snapshot (keep a copy of the current one).
        </p>
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
    </div>
  )
}
