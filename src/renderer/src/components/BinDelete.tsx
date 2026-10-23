import { useEffect, useState } from 'react'
import { ModalPanel } from './Modal'
import { LoaderCircle, Trash2 } from 'lucide-react'
import type { BinDeleteProgress, BinDeleteResult } from '@shared/types'
import { api, bytes, n, plural } from '../lib/format'
import { t } from '../lib/i18n'

/**
 * Confirmation → progress → result for permanently deleting items from the Bin.
 * By default the originals go to the Windows Recycle Bin (a last safety net); the user can opt out to free space now.
 */
export function BinDeleteDialog(props: { ids: number[] | 'all'; count: number; sizeBytes?: number; onClose: (deleted: boolean) => void }) {
  const [skipRecycleBin, setSkip] = useState(false)
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm')
  const [progress, setProgress] = useState<BinDeleteProgress | null>(null)
  const [result, setResult] = useState<BinDeleteResult | null>(null)

  useEffect(() => api.onBinProgress(setProgress), [])

  const run = async (): Promise<void> => {
    setPhase('running')
    try {
      setResult(await api.deleteFromBin(props.ids, { skipRecycleBin }))
    } catch (err) {
      setResult({ deleted: 0, failed: props.count, bytes: 0, errors: [err instanceof Error ? err.message : String(err)] })
    }
    setPhase('done')
  }

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/40 p-8 backdrop-blur-[4px] animate-fade-in" onMouseDown={() => phase !== 'running' && props.onClose(phase === 'done')}>
      <ModalPanel className="w-[460px] rounded-2xl bg-white p-6 shadow-2xl animate-rise-in dark:bg-stone-900 dark:ring-1 dark:ring-white/10" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 grid size-11 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400">
          {phase === 'running' ? <LoaderCircle className="size-5 animate-spin" /> : <Trash2 className="size-5" />}
        </div>
        {phase === 'confirm' && (
          <>
            <h2 className="text-[17px] font-semibold">{t('Delete')}{' '}{plural(props.count, 'item')}{' '}{t('permanently?')}</h2>
            <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed text-stone-600 dark:text-stone-400">
              <p>
                {props.count === 1 ? t('Its file is') : t('Their files are')}{' '}{t('removed from your Photo Vault library folder')}{props.sizeBytes ? ` (${bytes(props.sizeBytes)})` : ''}{t(', along with albums, labels and history. If the same files are imported again later, they are skipped.')}</p>
              <p>{t('The folders and ZIP files you originally imported from are not touched.')}</p>
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg bg-stone-50 p-3 text-[13px] dark:bg-stone-800/60">
              <input type="checkbox" checked={skipRecycleBin} onChange={(e) => setSkip(e.target.checked)} className="mt-0.5 size-4 accent-red-600" />
              <span>
                <span className="font-medium">{t('Skip the Windows Recycle Bin')}</span>
                <span className="block text-xs text-ink-muted">
                  {skipRecycleBin ? t('Space is freed immediately. This cannot be undone.') : t('Off: files go to the Recycle Bin first, so you can still recover them until you empty it.')}
                </span>
              </span>
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button data-autofocus onClick={() => props.onClose(false)} className="h-9 rounded-lg px-4 text-[13.5px] font-medium text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">{t('Cancel')}</button>
              <button onClick={run} className="h-9 rounded-lg bg-red-600 px-4 text-[13.5px] font-medium text-white hover:bg-red-700">{t('Delete')}{' '}{plural(props.count, 'item')}
              </button>
            </div>
          </>
        )}
        {phase === 'running' && (
          <>
            <h2 className="text-[17px] font-semibold">{t('Deleting…')}</h2>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
              <div className="h-full rounded-full bg-red-500 transition-[width] duration-300" style={{ width: `${progress ? (progress.done / Math.max(1, progress.total)) * 100 : 0}%` }} />
            </div>
            <div className="mt-2 text-xs tabular-nums text-ink-muted">
              {progress ? t('{done} of {total} · {v2}', { done: n(progress.done), total: n(progress.total), v2: bytes(progress.bytes) }) : t('Starting…')}
              {!skipRecycleBin && t(' · moving files to the Recycle Bin')}
            </div>
          </>
        )}
        {phase === 'done' && result && (
          <>
            <h2 className="text-[17px] font-semibold">{result.failed === 0 ? t('{deleted} deleted', { deleted: plural(result.deleted, 'item') }) : t('{deleted} deleted, {failed} failed', { deleted: n(result.deleted), failed: n(result.failed) })}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-stone-600 dark:text-stone-400">
              {result.deleted > 0 && (skipRecycleBin ? t('{v0} freed.', { v0: bytes(result.bytes) }) : t('{v0} moved to the Windows Recycle Bin — empty it there to free the space.', { v0: bytes(result.bytes) }))}
              {result.failed > 0 && t(' Items that could not be deleted are still in the Bin.')}
            </p>
            {result.errors.length > 0 && (
              <ul className="scroll-thin mt-3 max-h-32 overflow-y-auto rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-500/10 dark:text-red-300">
                {result.errors.slice(0, 50).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex justify-end">
              <button onClick={() => props.onClose(true)} className="h-9 rounded-lg bg-stone-900 px-4 text-[13.5px] font-medium text-white dark:bg-white dark:text-stone-900">{t('Done')}</button>
            </div>
          </>
        )}
      </ModalPanel>
    </div>
  )
}
