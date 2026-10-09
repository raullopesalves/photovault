import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Smartphone } from 'lucide-react'
import type { PhoneCopyProgress, PhoneDevice } from '@shared/types'
import { api } from '../lib/format'

const btn = 'h-9 rounded-lg px-4 text-[13.5px] font-medium transition'
const secondary = `${btn} text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800`
const primary = `${btn} bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200`

const mb = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)

/**
 * "Import from a phone or camera": lists the USB devices Windows sees, copies their DCIM/Pictures folders
 * next to the library (only new files), then hands that folder to the normal import.
 */
export function PhoneDialog(props: { onImport: (folder: string) => void; onClose: () => void }) {
  const [devices, setDevices] = useState<PhoneDevice[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [progress, setProgress] = useState<PhoneCopyProgress | null>(null)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setDevices(null)
    setError(null)
    try {
      const list = await api.listPhones()
      setDevices(list)
      setChosen((c) => (c && list.some((d) => d.name === c) ? c : (list.find((d) => d.folders.length)?.name ?? null)))
    } catch (err) {
      setDevices([])
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    return api.onPhoneProgress(setProgress)
  }, [refresh])

  const start = async (): Promise<void> => {
    if (!chosen) return
    setCopying(true)
    setError(null)
    setProgress(null)
    try {
      const done = await api.copyFromPhone(chosen)
      if (done.copied + done.skipped > 0) props.onImport(done.folder)
      else setError(done.total === 0 ? 'No photos were found on it.' : `None of the ${done.total} files could be copied.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
      if (msg !== 'Cancelled') setError(msg)
    } finally {
      setCopying(false)
    }
  }

  const close = (): void => {
    if (copying) void api.cancelPhoneCopy()
    props.onClose()
  }

  const device = devices?.find((d) => d.name === chosen)
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/30 p-8 backdrop-blur-[4px] animate-fade-in dark:bg-black/50">
      <div className="w-[460px] rounded-2xl bg-white p-6 shadow-2xl shadow-stone-950/20 animate-rise-in dark:bg-stone-900 dark:ring-1 dark:ring-white/10">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">Import from a phone or camera</h2>
          {!copying && (
            <button onClick={() => void refresh()} title="Look again" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">
              <RefreshCw className={`size-4 ${devices === null ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
          Connect it with a USB cable and unlock it. On an iPhone tap <b>Trust</b>; on Android choose <b>File transfer</b>. The phone is only read — nothing on it is changed
          or deleted.
        </p>

        {!copying && (
          <div className="mt-4 space-y-1.5">
            {devices === null && <p className="px-3 py-2 text-[13px] text-stone-500">Looking for devices…</p>}
            {devices?.length === 0 && !error && <p className="px-3 py-2 text-[13px] text-stone-500">No phone or camera found.</p>}
            {devices?.map((d) => (
              <label
                key={d.name}
                className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 ${chosen === d.name ? 'bg-stone-100 dark:bg-stone-800' : 'hover:bg-stone-50 dark:hover:bg-stone-800/50'}`}
              >
                <input type="radio" checked={chosen === d.name} onChange={() => setChosen(d.name)} className="mt-1 accent-accent-500" />
                <Smartphone className="mt-0.5 size-4 shrink-0 text-stone-500" />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium">{d.name}</span>
                  <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                    {d.folders.length ? d.folders.join(' · ') : 'No photos visible — unlock it and allow access, then look again'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        {copying && (
          <div className="mt-5">
            <div className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <div className="h-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-[13px] tabular-nums text-stone-600 dark:text-stone-400">
              {!progress || !progress.total
                ? 'Reading the phone…'
                : `Copying ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} · ${mb(progress.bytes)}${progress.skipped ? ` · ${progress.skipped.toLocaleString()} already copied` : ''}`}
            </p>
            {progress?.current && <p className="mt-0.5 truncate text-xs text-stone-500">{progress.current}</p>}
            <p className="mt-3 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
              Keep the phone unlocked and connected. When the copy finishes the import starts and you review it as usual.
            </p>
          </div>
        )}

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={close} className={secondary}>
            {copying ? 'Stop' : 'Cancel'}
          </button>
          {!copying && (
            <button onClick={() => void start()} disabled={!device || device.folders.length === 0} className={primary}>
              Copy and import
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
