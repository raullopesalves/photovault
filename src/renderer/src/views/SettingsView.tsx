import { useEffect, useState, type ReactNode } from 'react'
import { LoaderCircle, Monitor, Moon, Sparkles, Sun } from 'lucide-react'
import type { LibraryInfo, SmartSearchStatus, ThemePreference } from '@shared/types'
import { api, bytes, n } from '../lib/format'
import { PageHeader } from './Placeholder'

export function SettingsView(props: {
  library: LibraryInfo
  theme: ThemePreference
  onTheme: (t: ThemePreference) => void
  onOpenLibrary: () => void
  onCreateLibrary: () => void
}) {
  const themes: Array<{ id: ThemePreference; label: string; icon: ReactNode }> = [
    { id: 'system', label: 'System', icon: <Monitor className="size-4" /> },
    { id: 'light', label: 'Light', icon: <Sun className="size-4" /> },
    { id: 'dark', label: 'Dark', icon: <Moon className="size-4" /> }
  ]
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="Settings" />
      <div className="mx-auto max-w-4xl space-y-6 px-8 pb-12">
        <Group title="Appearance">
          <div className="flex gap-2">
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => props.onTheme(t.id)}
                className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-[13.5px] font-medium transition ${
                  props.theme === t.id
                    ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </Group>

        <SmartSearchGroup />

        <Group title="Library">
          <div className="text-[13px] text-stone-500 dark:text-stone-400">Location</div>
          <div className="mt-0.5 break-all text-[14px]">{props.library.path}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn onClick={() => void api.openLibraryFolder()}>Show in Explorer</Btn>
            <Btn onClick={props.onOpenLibrary}>Open another library…</Btn>
            <Btn onClick={props.onCreateLibrary}>Create new library…</Btn>
          </div>
        </Group>

        {props.library.deletedCount > 0 && (
          <Group title="Deleted items">
            <p className="text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
              Photo Vault remembers the {props.library.deletedCount === 1 ? 'item' : `${props.library.deletedCount} items`} you permanently deleted, so importing the same
              files again (e.g. from an old ZIP) skips them.
            </p>
            <div className="mt-3">
              <Btn
                onClick={async () => {
                  await api.forgetDeleted()
                  window.location.reload()
                }}
              >
                Allow them to be imported again
              </Btn>
            </div>
          </Group>
        )}

        <Group title="Safety">
          <ul className="space-y-2 text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
            <li>Imports copy files into the library. Source folders are only ever read.</li>
            <li>Each copy is fingerprinted with SHA-256 after copying and only then added to the library.</li>
            <li>Files are never overwritten: name collisions get a suffix derived from the file’s fingerprint.</li>
            <li>Duplicates are never deleted automatically. Photo Vault records where each copy was found.</li>
            <li>
              Nothing is ever deleted automatically. Files are only deleted from the Bin, after you confirm — and by default they go to the Windows
              Recycle Bin first.
            </li>
          </ul>
        </Group>
      </div>
    </div>
  )
}

function SmartSearchGroup() {
  const [s, setS] = useState<SmartSearchStatus | null>(null)
  useEffect(() => {
    void api.smartSearchStatus().then(setS)
    return api.onSmartSearchStatus(setS)
  }, [])
  if (!s) return null
  const pct = s.total ? Math.floor((s.indexed / s.total) * 100) : 0
  const status = !s.enabled
    ? null
    : s.phase === 'downloading' && s.download
      ? `Downloading the model… ${bytes(s.download.loaded)}${s.download.total ? ` of ${bytes(s.download.total)}` : ''}`
      : s.phase === 'loading'
        ? 'Starting…'
        : s.phase === 'indexing'
          ? `Looking at your photos… ${n(s.indexed)} of ${n(s.total)} (${pct}%) — search already works on those`
          : s.phase === 'error'
            ? `Something went wrong: ${s.error}`
            : `Ready — ${n(s.indexed)} items indexed`
  return (
    <Group title="Smart search">
      <div className="flex items-start gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
            Find photos by what they show — “beach at sunset”, “dog”, “birthday cake”, “receipt” — with the <Sparkles className="inline size-3.5" /> button
            in the search box. It runs entirely on this computer: your photos are never uploaded. Turning it on downloads the AI model (about 150 MB, once)
            from Hugging Face, then looks at every photo in the background (roughly 1–2 minutes per 1,000 photos).
          </p>
          {status && (
            <div className={`mt-3 flex items-center gap-2 text-[13px] ${s.phase === 'error' ? 'text-red-600 dark:text-red-400' : 'text-stone-700 dark:text-stone-300'}`}>
              {(s.phase === 'downloading' || s.phase === 'indexing' || s.phase === 'loading') && <LoaderCircle className="size-3.5 animate-spin" />}
              {status}
            </div>
          )}
          {s.enabled && s.phase === 'indexing' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="mt-4 flex gap-2">
            {s.enabled ? (
              <>
                <Btn onClick={() => void api.setSmartSearch(false)}>Turn off</Btn>
                {s.phase === 'error' && <Btn onClick={() => void api.setSmartSearch(true)}>Try again</Btn>}
              </>
            ) : (
              <button
                onClick={() => void api.setSmartSearch(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900"
              >
                <Sparkles className="size-4" /> Turn on smart search
              </button>
            )}
          </div>
        </div>
      </div>
    </Group>
  )
}

function Group(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm shadow-stone-900/5 dark:bg-stone-900">
      <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{props.title}</h2>
      {props.children}
    </section>
  )
}

function Btn(props: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className="h-9 rounded-lg bg-stone-100 px-3.5 text-[13px] font-medium transition hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"
    >
      {props.children}
    </button>
  )
}
