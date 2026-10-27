import { useEffect, useState, type ReactNode } from 'react'
import { LoaderCircle, MessageSquareText, Monitor, Moon, Sparkles, Sun, Wifi, WifiOff } from 'lucide-react'
import type { CaptionStatus, Language, LibraryInfo, ModelInfo, SmartSearchStatus, ThemePreference, UpdateStatus } from '@shared/types'
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
  /** Changes each time the sidebar's progress card is clicked: scroll to the AI sections. */
  focusAi?: number
  library: LibraryInfo
  theme: ThemePreference
  onTheme: (t: ThemePreference) => void
  onOpenLibrary: () => void
  onCreateLibrary: () => void
  /** Opens the Guide at What's new. */
  onWhatsNew: () => void
}) {
  const themes: Array<{ id: ThemePreference; label: string; icon: ReactNode }> = [
    { id: 'system', label: t('System'), icon: <Monitor className="size-4" /> },
    { id: 'light', label: t('Light'), icon: <Sun className="size-4" /> },
    { id: 'dark', label: t('Dark'), icon: <Moon className="size-4" /> }
  ]
  // Opened from the sidebar's "Working on your photos" card: go straight to the AI sections.
  useEffect(() => {
    // After the sections above have loaded their status (their height changes), or the jump lands short.
    if (!props.focusAi) return
    const timer = setTimeout(() => document.getElementById('ai-progress')?.scrollIntoView({ block: 'start' }), 250)
    return () => clearTimeout(timer)
  }, [props.focusAi])
  return (
    <div className="scroll-page h-full overflow-y-auto">
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

        <OfflineGroup />

        <ModelsGroup />

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

        <div id="ai-progress" className="scroll-mt-20" />
        <SmartSearchGroup />

        <CaptionsGroup />

        <UpdatesGroup onWhatsNew={props.onWhatsNew} />

        <Group title={t('Library')}>
          <div className="text-[13px] text-ink-muted">{t('Location')}</div>
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

function OfflineGroup() {
  const [offline, setOffline] = useState<boolean | null>(null)
  useEffect(() => {
    void api.getSettings().then((s) => setOffline(s.offline))
  }, [])
  if (offline === null) return null
  const toggle = async (): Promise<void> => setOffline((await api.setSettings({ offline: !offline })).offline)
  return (
    <Group title={t('Offline mode')}>
      <div className="flex items-start gap-4">
        <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${offline ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-stone-100 text-ink-muted dark:bg-stone-800'}`}>
          {offline ? <WifiOff className="size-5" /> : <Wifi className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
            {t('Photo Vault works without the internet. Its only connections are ones you start: downloading an AI model, the detailed map, and update checks. Offline mode blocks all of them at once, as a guarantee. Models you already have keep working.')}
          </p>
          <div className="mt-2 text-[13px] font-medium">{offline ? t('On — nothing connects to the internet.') : t('Off')}</div>
          <button
            onClick={() => void toggle()}
            className={`mt-3 h-9 rounded-lg px-4 text-[13px] font-medium ${offline ? 'bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700' : 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900'}`}
          >
            {offline ? t('Turn off offline mode') : t('Turn on offline mode')}
          </button>
        </div>
      </div>
    </Group>
  )
}

const MODEL_NAMES: Record<ModelInfo['id'], string> = {
  smart: t('Smart search and pets (CLIP)'),
  captions: t('Automatic descriptions (Florence-2)'),
  faces: t('People (YuNet + SFace)')
}

function ModelsGroup() {
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    void api.models().then(setModels)
  }, [])
  if (!models) return null
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setNote(null)
    try {
      await fn()
    } catch (err) {
      setNote(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }
  return (
    <Group title={t('AI models')}>
      <p className="text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
        {t('The on-device models are downloaded once when you turn a feature on. To set up a computer that is never online, or to avoid downloading again after a reinstall, save a copy to a USB stick here and load it on the other computer.')}
      </p>
      <ul className="mt-3 space-y-1.5">
        {models.map((m) => (
          <li key={m.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-[13px] dark:bg-stone-800/60">
            <span>{MODEL_NAMES[m.id]}</span>
            <span className={m.installed ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-faint'}>
              {m.installed ? t('Installed · {size}', { size: bytes(m.bytes) }) : t('Not installed')}
            </span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-3 text-[13px] text-stone-700 dark:text-stone-300">{note}</p>}
      <div className="mt-4 flex gap-2">
        <Btn
          onClick={() =>
            void run(async () => {
              const r = await api.importModels()
              if (!r) return
              setModels(r.models)
              setNote(r.installed.length ? t('Installed: {list}', { list: r.installed.map((id) => MODEL_NAMES[id]).join(', ') }) : t('Those models were already installed.'))
            })
          }
        >
          {t('Load from a folder…')}
        </Btn>
        {models.some((m) => m.installed) && (
          <Btn
            onClick={() =>
              void run(async () => {
                const out = await api.exportModels()
                if (out) setNote(t('Saved to {folder}', { folder: out }))
              })
            }
          >
            {t('Save a copy to a folder…')}
          </Btn>
        )}
      </div>
    </Group>
  )
}

function UpdatesGroup(props: { onWhatsNew: () => void }) {
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
            : s.state === 'offline'
              ? t('Offline mode is on: updates are not checked.')
              : s.state === 'up-to-date'
              ? t('You have the latest version.')
              : s.state === 'error'
                ? t('Could not check: {error}', { error: s.error })
                : t('Updates are checked automatically.')
  return (
    <Group title={t('Updates')}>
      <div className="text-[13px] text-stone-600 dark:text-stone-400">{t('Photo Vault')}{' '}{s.version}. {line}
      </div>
      <div className="mt-3 flex gap-2">
        {s.canUpdate &&
          (s.state === 'ready' ? (
            <button onClick={() => void api.installUpdate()} className="h-9 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white dark:bg-white dark:text-stone-900">{t('Restart and update')}</button>
          ) : (
            <Btn onClick={() => void api.checkForUpdates().then(setS)}>{t('Check now')}</Btn>
          ))}
        <Btn onClick={props.onWhatsNew}>{t('What’s new')}</Btn>
      </div>
      {s.canUpdate && (
        <div className="mt-5 border-t border-stone-100 pt-4 dark:border-stone-800">
          <div className="text-[13px] font-medium">{t('GitHub token (optional)')}{' '}{s.tokenSet && <span className="ml-1 text-emerald-600 dark:text-emerald-400">{t('· saved')}</span>}</div>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t('Not needed: updates come from the public repository. A saved token is still used for update checks and stored encrypted on this computer; remove it if checks start failing (tokens expire).')}</p>
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
          <p className="text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">{t('Find photos by what they show — “beach at sunset”, “dog”, “birthday cake”, “receipt”: type it in the search box and pick “Photos that look like…”. It runs entirely on this computer: your photos are never uploaded. Turning it on downloads the AI model (about 150 MB, once) from Hugging Face, then looks at every photo in the background (roughly 1–2 minutes per 1,000 photos).')}</p>
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
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white hover:bg-stone-800 dark:bg-white dark:hover:bg-stone-200 dark:text-stone-900"
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
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white hover:bg-stone-800 dark:bg-white dark:hover:bg-stone-200 dark:text-stone-900"
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
    <section className="rounded-[14px] border border-line bg-card p-5">
      <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-ink-muted">{props.title}</h2>
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
