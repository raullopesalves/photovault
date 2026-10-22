import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { FolderInput } from 'lucide-react'
import type { AppState, ImportProgress, ThemePreference } from '@shared/types'
import { api } from './lib/format'
import { Sidebar, type View } from './components/Sidebar'
import { ImportSheet } from './components/ImportSheet'
import { PhoneDialog } from './components/PhoneDialog'
import { Welcome } from './views/Welcome'
import { PhotosView } from './views/PhotosView'
import { ImportsView } from './views/ImportsView'
import { DuplicatesView } from './views/DuplicatesView'
import { StorageView } from './views/StorageView'
import { SettingsView } from './views/SettingsView'
import { AlbumsView } from './views/AlbumsView'
import { MapView } from './views/MapView'
import { PeopleView } from './views/PeopleView'
import { MemoriesView } from './views/MemoriesView'
import { FavoritesView } from './views/FavoritesView'
import { CleanupView } from './views/CleanupView'
import { ScreenshotsView } from './views/ScreenshotsView'
import { BinView, HiddenView } from './views/HiddenBinViews'
import { t } from './lib/i18n'

function applyThemeClass(theme: ThemePreference): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

const ACTIVE_PHASES = new Set(['scanning', 'sidecars', 'analyzing', 'classifying', 'ready', 'importing', 'linking'])

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [view, setView] = useState<View>('photos')
  const [theme, setTheme] = useState<ThemePreference>('system')
  const [showScreenshots, setShowScreenshots] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [version, setVersion] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [phoneOpen, setPhoneOpen] = useState(false)

  const refreshState = useCallback(async () => setState(await api.getState()), [])

  useEffect(() => {
    void refreshState()
    void api.getSettings().then((s) => {
      setTheme(s.theme)
      setShowScreenshots(s.showScreenshots)
    })
    void api.currentImport().then((p) => {
      if (p) {
        setProgress(p)
        if (ACTIVE_PHASES.has(p.phase)) setSheetOpen(true)
      }
    })
    const offProgress = api.onImportProgress((p) => {
      setProgress(p)
      if (p.phase === 'completed') {
        setVersion((v) => v + 1)
        void refreshState()
      }
    })
    const offChanged = api.onLibraryChanged(() => {
      setVersion((v) => v + 1)
      void refreshState()
    })
    return () => {
      offProgress()
      offChanged()
    }
  }, [refreshState])

  useEffect(() => {
    applyThemeClass(theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyThemeClass(theme)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const changeTheme = async (t: ThemePreference): Promise<void> => {
    setTheme(t)
    await api.setSettings({ theme: t })
  }

  const changeShowScreenshots = async (show: boolean): Promise<void> => {
    setShowScreenshots(show)
    await api.setSettings({ showScreenshots: show })
  }

  const errorText = (err: unknown): string =>
    err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)

  /** Starts an import from given paths, or asks for a folder / ZIP archives. */
  const startImport = useCallback(async (sources: string[] | 'folder' | 'zip' | 'phone' = 'folder') => {
    setImportError(null)
    if (sources === 'phone') return setPhoneOpen(true)
    const paths = Array.isArray(sources) ? sources : await api.chooseImportSources(sources)
    if (!paths || paths.length === 0) return
    try {
      if (progress && !ACTIVE_PHASES.has(progress.phase)) await api.dismissImport(progress.importId)
      await api.startImport(paths)
      setSheetOpen(true)
    } catch (err) {
      setImportError(errorText(err))
      setSheetOpen(true)
    }
  }, [progress])

  const resumeImport = useCallback(async (importId: number) => {
    setImportError(null)
    try {
      if (progress && !ACTIVE_PHASES.has(progress.phase)) await api.dismissImport(progress.importId)
      setProgress(await api.resumeImport(importId))
      setSheetOpen(true)
    } catch (err) {
      setImportError(errorText(err))
      setSheetOpen(true)
    }
  }, [progress])

  const closeSheet = async (): Promise<void> => {
    if (progress && !ACTIVE_PHASES.has(progress.phase)) {
      await api.dismissImport(progress.importId)
      setProgress(null)
    }
    setImportError(null)
    setSheetOpen(false)
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    if (state?.kind !== 'ready') return
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => api.pathForFile(f))
      .filter((p) => p.length > 0)
    if (paths.length > 0) void startImport(paths)
  }

  if (!state) return <div className="h-full" />

  if (state.kind === 'no-library') {
    return (
      <Welcome
        error={state.error}
        onCreate={async () => setState(await api.createLibrary())}
        onOpen={async () => setState(await api.openLibrary())}
      />
    )
  }

  const library = state.library
  const importRunning = progress !== null && ACTIVE_PHASES.has(progress.phase)

  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.relatedTarget) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <Sidebar
        view={view}
        onView={setView}
        library={library}
        importRunning={importRunning}
        progress={progress}
        onShowImport={() => setSheetOpen(true)}
        onImport={(kind) => void startImport(kind)}
      />
      <main className="relative min-w-0 flex-1">
        {view === 'photos' && (
          <PhotosView
            version={version}
            library={library}
            showScreenshots={showScreenshots}
            onImport={(kind) => void startImport(kind)}
            onShowScreenshots={() => setView('screenshots')}
          />
        )}
        {view === 'imports' && (
          <ImportsView version={version} onImport={(kind) => void startImport(kind)} onResume={(id) => void resumeImport(id)} busy={importRunning} />
        )}
        {view === 'duplicates' && <DuplicatesView version={version} />}
        {view === 'storage' && <StorageView library={library} version={version} />}
        {view === 'settings' && (
          <SettingsView
            library={library}
            theme={theme}
            onTheme={changeTheme}
            onOpenLibrary={async () => setState(await api.openLibrary())}
            onCreateLibrary={async () => setState(await api.createLibrary())}
          />
        )}
        {view === 'favorites' && <FavoritesView version={version} />}
        {view === 'albums' && <AlbumsView version={version} />}
        {view === 'map' && <MapView version={version} />}
        {view === 'people' && <PeopleView version={version} />}
        {view === 'memories' && <MemoriesView version={version} />}
        {view === 'screenshots' && <ScreenshotsView version={version} showInPhotos={showScreenshots} onShowInPhotos={(s) => void changeShowScreenshots(s)} />}
        {view === 'cleanup' && <CleanupView version={version} />}
        {view === 'hidden' && <HiddenView version={version} library={library} />}
        {view === 'bin' && <BinView version={version} library={library} />}
      </main>

      {phoneOpen && (
        <PhoneDialog
          onClose={() => setPhoneOpen(false)}
          onImport={(folder) => {
            setPhoneOpen(false)
            void startImport([folder])
          }}
        />
      )}

      {sheetOpen && (
        <ImportSheet
          progress={progress}
          error={importError}
          onClose={closeSheet}
          onHide={() => setSheetOpen(false)}
          onShowPhotos={async () => {
            await closeSheet()
            setView('photos')
          }}
        />
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-white/60 px-16 py-12 text-white">
            <FolderInput className="size-10" strokeWidth={1.5} />
            <div className="text-lg font-medium">{t('Drop folders or ZIP archives to import')}</div>
            <div className="text-sm text-white/70">{t('Originals are copied — your folder is never changed')}</div>
          </div>
        </div>
      )}
    </div>
  )
}
