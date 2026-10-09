import { useEffect, useState, type ReactNode } from 'react'
import { LoaderCircle, MessageSquareText, Monitor, Moon, Sparkles, Sun } from 'lucide-react'
import type { CaptionStatus, Language, LibraryInfo, SmartSearchStatus, ThemePreference, UpdateStatus } from '@shared/types'
import { api, bytes, n } from '../lib/format'
import { PageHeader } from './Placeholder'
import { language, t } from '../lib/i18n'

/** Each language is named in itself. */
const LANGUAGES: Array<{ id: Language; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'pt', label: 'Português' }
]

async function changeLanguage(lang: Language): Promise<void> {
  if (lang === language()) return
  await api.setSettings({ language: lang })
  window.location.reload()
}

export function SettingsView(props: {
  library: LibraryInfo
  theme: ThemePreference
  onTheme: (t: ThemePreference) => void
  onOpenLibrary: () => void
  onCreateLibrary: () => void
}) {
  const themes: Array<{ id: ThemePreference; label: string; icon: ReactNode }> = [
    { id: 'system', label: t('System'), icon: <Monitor className="size-4" /> },
    { id: 'light', label: t('Light'), icon: <Sun className="size-4" /> },
    { id: 'dark', label: t('Dark'), icon: <Moon className="size-4" /> }
  ]
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title={t('Settings')} />
      <div className="mx-auto max-w-4xl space-y-6 px-8 pb-12">
        <Group title={t('Appearance')}>
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

        <Group title={t('Language')}>
          <div className="flex gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                onClick={() => void changeLanguage(l.id)}
                className={`flex h-10 flex-1 items-center justify-center rounded-lg text-[13.5px] font-medium transition ${
                  language() === l.id
                    ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </Group>

        <SmartSearchGroup />

        <CaptionsGroup />

        <UpdatesGroup />

        <Group title={t('Library')}>
          <div className="text-[13px] text-stone-500 dark:text-stone-400">{t('Location')}</div>
          <div className="mt-0.5 break-all text-[14px]">{props.library.path}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn onClick={() => void api.openLibraryFolder()}>{t('Show in Explorer')}</Btn>
            <Btn onClick={props.onOpenLibrary}>{t('Open another library…')}</Btn>
            <Btn onClick={props.onCreateLibrary}>{t('Create new library…')}</Btn>
          </div>
        </Group>

        {props.library.deletedCount > 0 && (
          <Group title={t('Deleted items')}>
            <p className="text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">{t('Photo Vault remembers the')}{' '}{props.library.deletedCount === 1 ? 'item' : `${props.library.deletedCount} items`}{' '}{t('you permanently deleted, so importing the same files again (e.g. from an old ZIP) skips them.')}</p>
            <div className="mt-3">
              <Btn
                onClick={async () => {
                  await api.forgetDeleted()
                  window.location.reload()
                }}
              >{t('Allow them to be imported again')}</Btn>
            </div>
          </Group>
        )}

        <Group title={t('Safety')}>
          <ul className="space-y-2 text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
            <li>{t('Imports copy files into the library. Source folders are only ever read.')}</li>
            <li>{t('Each copy is fingerprinted with SHA-256 after copying and only then added to the library.')}</li>
            <li>{t('Files are never overwritten: name collisions get a suffix derived from the file’s fingerprint.')}</li>
            <li>{t('Duplicates are never deleted automatically. Photo Vault records where each copy was found.')}</li>
            <li>{t('Nothing is ever deleted automatically. Files are only deleted from the Bin, after you confirm — and by default they go to the Windows Recycle Bin first.')}</li>
          </ul>
        </Group>
      </div>
    </div>
  )
}

function UpdatesGroup() {
  const [s, setS] = useState<UpdateStatus | null>(null)
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.updateStatus().then(setS)
    return api.onUpdateStatus(setS)
  }, [])
  if (!s) return null
  const line =
    !s.canUpdate
      ? t('This copy cannot update itself (portable or development build). Use the installer for automatic updates.')
      : s.state === 'checking'
        ? t('Checking for updates…')
        : s.state === 'downloading'
          ? t('Downloading version {v0}… {v1}%', { v0: s.available ?? '', v1: s.percent ?? 0 })
          : s.state === 'ready'
            ? t('Version {available} is ready — it installs when you quit, or restart now.', { available: s.available })
            : s.state === 'up-to-date'
              ? t('You have the latest version.')
              : s.state === 'error'
                ? t('Could not check: {error}', { error: s.error })
                : !s.tokenSet
                  ? t('Add a GitHub token below to get updates from your private repository.')
                  : t('Updates are checked automatically.')
  return (
    <Group title={t('Updates')}>
      <div className="text-[13px] text-stone-600 dark:text-stone-400">{t('Photo Vault')}{' '}{s.version}. {line}
      </div>
      {s.canUpdate && (
        <div className="mt-3 flex gap-2">
          {s.state === 'ready' ? (
            <button onClick={() => void api.installUpdate()} className="h-9 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white dark:bg-white dark:text-stone-900">{t('Restart and update')}</button>
          ) : (
            <Btn onClick={() => void api.checkForUpdates().then(setS)}>{t('Check now')}</Btn>
          )}
        </div>
      )}
      {s.canUpdate && (
        <div className="mt-5 border-t border-stone-100 pt-4 dark:border-stone-800">
          <div className="text-[13px] font-medium">{t('GitHub access')}{' '}{s.tokenSet && <span className="ml-1 text-emerald-600 dark:text-emerald-400">{t('· saved')}</span>}</div>
          <p className="mt-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400">{t('Your code repository is private, so the app needs a read-only token to see new versions. On github.com: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate. Repository access: only')}{' '}<b>{t('photovault')}</b>{t('; Permissions → Contents:')}{' '}<b>{t('Read-only')}</b>{t('. The token is stored encrypted on this computer.')}</p>
          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={s.tokenSet ? t('Paste a new token to replace it') : 'github_pat_…'}
              className="h-9 min-w-0 flex-1 rounded-lg bg-stone-100 px-3 text-[13px] outline-none ring-accent-500 focus:ring-2 dark:bg-stone-800"
            />
            <button
              disabled={!token.trim() || busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  setS(await api.setUpdateToken(token))
                  setToken('')
                } catch (err) {
                  setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
                } finally {
                  setBusy(false)
                }
              }}
              className="h-9 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white disabled:opacity-40 dark:bg-white dark:text-stone-900"
            >{t('Save')}</button>
            {s.tokenSet && <Btn onClick={() => void api.setUpdateToken(null).then(setS)}>{t('Remove')}</Btn>}
          </div>
          {error && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
        </div>
      )}
    </Group>
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
      ? t('Downloading the model… {v0}{v1}', { v0: bytes(s.download.loaded), v1: s.download.total ? ` of ${bytes(s.download.total)}` : '' })
      : s.phase === 'loading'
        ? t('Starting…')
        : s.phase === 'indexing'
          ? t('Looking at your photos… {indexed} of {total} ({pct}%) — search already works on those', { indexed: n(s.indexed), total: n(s.total), pct })
          : s.phase === 'error'
            ? t('Something went wrong: {error}', { error: s.error })
            : t('Ready — {indexed} items indexed', { indexed: n(s.indexed) })
  return (
    <Group title={t('Smart search')}>
      <div className="flex items-start gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">{t('Find photos by what they show — “beach at sunset”, “dog”, “birthday cake”, “receipt” — with the')}{' '}<Sparkles className="inline size-3.5" />{' '}{t('button in the search box. It runs entirely on this computer: your photos are never uploaded. Turning it on downloads the AI model (about 150 MB, once) from Hugging Face, then looks at every photo in the background (roughly 1–2 minutes per 1,000 photos).')}</p>
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
                <Btn onClick={() => void api.setSmartSearch(false)}>{t('Turn off')}</Btn>
                {s.phase === 'error' && <Btn onClick={() => void api.setSmartSearch(true)}>{t('Try again')}</Btn>}
              </>
            ) : (
              <button
                onClick={() => void api.setSmartSearch(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900"
              >
                <Sparkles className="size-4" />{' '}{t('Turn on smart search')}</button>
            )}
          </div>
        </div>
      </div>
    </Group>
  )
}

function CaptionsGroup() {
  const [s, setS] = useState<CaptionStatus | null>(null)
  useEffect(() => {
    void api.captionStatus().then(setS)
    return api.onCaptionStatus(setS)
  }, [])
  if (!s) return null
  const pct = s.total ? Math.floor((s.described / s.total) * 100) : 0
  const busy = s.enabled && (s.phase === 'downloading' || s.phase === 'describing' || s.phase === 'loading')
  const status = !s.enabled
    ? s.described > 0
      ? t('Paused — {described} of {total} described', { described: n(s.described), total: n(s.total) })
      : null
    : s.phase === 'downloading' && s.download
      ? t('Downloading the model… {loaded} of {total}', { loaded: bytes(s.download.loaded), total: bytes(s.download.total) })
      : s.phase === 'loading'
        ? t('Starting…')
        : s.phase === 'describing'
          ? t('Describing your photos… {described} of {total} ({pct}%), newest first', { described: n(s.described), total: n(s.total), pct })
          : s.phase === 'error'
            ? t('Something went wrong: {error}', { error: s.error })
            : t('Ready — {described} items described', { described: n(s.described) })
  return (
    <Group title={t('Automatic descriptions')}>
      <div className="flex items-start gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">
          <MessageSquareText className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
            {t('Writes a short description of each photo — “A dog sitting in a field with trees in the background.” — shown in the photo’s details and found by the search box. Runs on this computer only. Turning it on downloads the model (Florence-2, about 265 MB, once); describing takes about 2 seconds per photo in the background, newest first, so a large library takes many hours. Descriptions are in English.')}
          </p>
          {status && (
            <div className={`mt-3 flex items-center gap-2 text-[13px] ${s.phase === 'error' ? 'text-red-600 dark:text-red-400' : 'text-stone-700 dark:text-stone-300'}`}>
              {busy && <LoaderCircle className="size-3.5 animate-spin" />}
              {status}
            </div>
          )}
          {s.enabled && s.phase === 'describing' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="mt-4 flex gap-2">
            {s.enabled ? (
              <>
                <Btn onClick={() => void api.setCaptionsEnabled(false)}>{t('Pause')}</Btn>
                {s.phase === 'error' && <Btn onClick={() => void api.setCaptionsEnabled(true)}>{t('Try again')}</Btn>}
              </>
            ) : (
              <button
                onClick={() => void api.setCaptionsEnabled(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900"
              >
                <MessageSquareText className="size-4" />
                {s.described > 0 ? t('Continue describing') : t('Turn on automatic descriptions')}
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
