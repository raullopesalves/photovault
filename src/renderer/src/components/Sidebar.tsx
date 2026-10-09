import type { ReactNode } from 'react'
import { Album, BrushCleaning, Map as MapIcon, Sparkles, Users, Copy, EyeOff, FolderInput, HardDrive, Heart, Images, LoaderCircle, Plus, Settings, Trash2 } from 'lucide-react'
import type { ImportProgress, LibraryInfo } from '@shared/types'
import { etaLabel, n } from '../lib/format'
import { ImportMenu, type ImportKind } from './ImportMenu'
import { t } from '../lib/i18n'

export type View = 'photos' | 'memories' | 'favorites' | 'albums' | 'people' | 'map' | 'cleanup' | 'imports' | 'duplicates' | 'hidden' | 'bin' | 'storage' | 'settings'

const NAV: Array<{ id: View; label: string; icon: ReactNode; soon?: boolean }> = [
  { id: 'photos', label: t('Photos'), icon: <Images className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'memories', label: t('Memories'), icon: <Sparkles className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'favorites', label: t('Favourites'), icon: <Heart className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'albums', label: t('Albums'), icon: <Album className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'people', label: t('People'), icon: <Users className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'map', label: t('Map'), icon: <MapIcon className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'cleanup', label: t('Cleanup'), icon: <BrushCleaning className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'imports', label: t('Imports'), icon: <FolderInput className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'duplicates', label: t('Duplicates'), icon: <Copy className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'hidden', label: t('Hidden'), icon: <EyeOff className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'bin', label: t('Bin'), icon: <Trash2 className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'storage', label: t('Storage'), icon: <HardDrive className="size-[18px]" strokeWidth={1.75} /> },
  { id: 'settings', label: t('Settings'), icon: <Settings className="size-[18px]" strokeWidth={1.75} /> }
]

function progressText(p: ImportProgress): string {
  switch (p.phase) {
    case 'scanning':
      return t('Scanning… {filesDiscovered} files', { filesDiscovered: n(p.filesDiscovered) })
    case 'sidecars':
      return t('Reading Google metadata…')
    case 'analyzing':
      return t('Checking {analyzed} of {analyzeTotal}', { analyzed: n(p.analyzed), analyzeTotal: n(p.analyzeTotal) })
    case 'classifying':
      return t('Checking duplicates…')
    case 'ready':
      return t('Import ready to review')
    case 'importing':
      return t('Importing {committed} of {commitTotal}', { committed: n(p.committed), commitTotal: n(p.commitTotal) })
    case 'linking':
      return t('Recording sources…')
    default:
      return ''
  }
}

export function Sidebar(props: {
  view: View
  onView: (v: View) => void
  library: LibraryInfo
  importRunning: boolean
  progress: ImportProgress | null
  onImport: (kind: ImportKind) => void
  onShowImport: () => void
}) {
  const { progress } = props
  const pct =
    progress?.phase === 'analyzing' && progress.analyzeTotal > 0
      ? progress.analyzed / progress.analyzeTotal
      : progress?.phase === 'importing' && progress.bytesTotal > 0
        ? progress.bytesProcessed / progress.bytesTotal
        : null

  return (
    <aside className="drag flex w-[228px] shrink-0 flex-col border-r border-stone-200/70 bg-stone-100/70 dark:border-stone-800/70 dark:bg-stone-900/60">
      <div className="h-11 shrink-0" />
      <div className="px-5 pb-6 pt-1">
        <div className="font-[family-name:var(--font-display)] text-[19px] font-semibold tracking-tight">{t('Photo Vault')}</div>
        <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{n(props.library.assetCount)}{' '}{t('items')}</div>
      </div>

      <nav className="no-drag flex flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const active = props.view === item.id
          return (
            <button
              key={item.id}
              onClick={() => props.onView(item.id)}
              className={`group flex h-9 items-center gap-3 rounded-lg px-3 text-left text-[13.5px] transition-colors ${
                active
                  ? 'bg-white text-stone-900 shadow-sm shadow-stone-900/5 dark:bg-stone-800 dark:text-white'
                  : 'text-stone-600 hover:bg-stone-200/60 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100'
              }`}
            >
              <span className={active ? 'text-accent-600 dark:text-accent-400' : ''}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.soon && <span className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">{t('Soon')}</span>}
              {item.id === 'hidden' && props.library.hiddenCount > 0 && <span className="text-[11px] tabular-nums text-stone-400">{n(props.library.hiddenCount)}</span>}
              {item.id === 'bin' && props.library.binCount > 0 && <span className="text-[11px] tabular-nums text-stone-400">{n(props.library.binCount)}</span>}
              {item.id === 'storage' && props.library.unprotectedCount > 0 && props.library.assetCount > 0 && (
                <span className="size-2 rounded-full bg-amber-500" title={t('{unprotectedCount} items have no backup copy', { unprotectedCount: n(props.library.unprotectedCount) })} />
              )}
            </button>
          )
        })}
      </nav>

      <div className="flex-1" />

      <div className="no-drag p-3">
        {props.importRunning && progress ? (
          <button
            onClick={props.onShowImport}
            className="w-full rounded-xl bg-white p-3 text-left shadow-sm shadow-stone-900/5 transition hover:shadow-md dark:bg-stone-800"
          >
            <div className="flex items-center gap-2 text-[13px] font-medium">
              {progress.phase === 'ready' ? (
                <span className="size-2 rounded-full bg-accent-500" />
              ) : (
                <LoaderCircle className="size-3.5 animate-spin text-accent-500" />
              )}
              {progress.phase === 'ready' ? t('Review import') : t('Importing')}
            </div>
            <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{progressText(progress)}</div>
            {(progress.phase === 'analyzing' || progress.phase === 'importing') && progress.etaSeconds !== null && (
              <div className="truncate text-xs text-stone-400 dark:text-stone-500">{etaLabel(progress.etaSeconds)}</div>
            )}
            {pct !== null && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                <div className="h-full rounded-full bg-accent-500 transition-[width] duration-300" style={{ width: `${Math.round(pct * 100)}%` }} />
              </div>
            )}
          </button>
        ) : (
          <ImportMenu
            onImport={props.onImport}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-stone-900 text-[13.5px] font-medium text-white transition hover:bg-stone-800 active:scale-[0.98] dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
          >
            <Plus className="size-4" strokeWidth={2.25} />{t('Import photos')}</ImportMenu>
        )}
      </div>
    </aside>
  )
}
