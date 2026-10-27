import type { ReactNode } from 'react'
import {
  Album,
  BrushCleaning,
  CircleHelp,
  Heart,
  Images,
  LoaderCircle,
  Map as MapIcon,
  MonitorSmartphone,
  Play,
  Plus,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users
} from 'lucide-react'
import type { ImportProgress, LibraryInfo } from '@shared/types'
import { etaLabel, n } from '../lib/format'
import { ImportMenu, type ImportKind } from './ImportMenu'
import { Mark } from './Mark'
import { BackgroundWork } from './BackgroundWork'
import { t } from '../lib/i18n'

export type View =
  | 'photos'
  | 'memories'
  | 'favorites'
  | 'albums'
  | 'people'
  | 'map'
  | 'screenshots'
  | 'videos'
  | 'cleanup'
  | 'imports'
  | 'duplicates'
  | 'hidden'
  | 'bin'
  | 'storage'
  | 'settings'
  | 'guide'

const icon = (I: typeof Images): ReactNode => <I className="size-[17px]" strokeWidth={1.75} />

/** Ten places in three groups. Duplicates and Hidden open from Tidy up, imports from the Import button, Safety from the
 * status card, the Guide and Settings from the footer. */
const SECTIONS: Array<{ label?: string; items: Array<{ id: View; label: string; icon: ReactNode }> }> = [
  {
    items: [
      { id: 'photos', label: t('Photos'), icon: icon(Images) },
      { id: 'memories', label: t('Memories'), icon: icon(Sparkles) },
      { id: 'people', label: t('People'), icon: icon(Users) },
      { id: 'map', label: t('Places'), icon: icon(MapIcon) },
      { id: 'albums', label: t('Albums'), icon: icon(Album) }
    ]
  },
  {
    label: t('Collections'),
    items: [
      { id: 'favorites', label: t('Favourites'), icon: icon(Heart) },
      { id: 'screenshots', label: t('Screenshots'), icon: icon(MonitorSmartphone) },
      { id: 'videos', label: t('Videos'), icon: icon(Play) }
    ]
  },
  {
    label: t('Look after'),
    items: [
      { id: 'cleanup', label: t('Tidy up'), icon: icon(BrushCleaning) },
      { id: 'bin', label: t('Bin'), icon: icon(Trash2) }
    ]
  }
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
  /** Opens Settings at the AI sections (smart search, descriptions). */
  onShowAi: () => void
}) {
  const { progress, library } = props
  const pct =
    progress?.phase === 'analyzing' && progress.analyzeTotal > 0
      ? progress.analyzed / progress.analyzeTotal
      : progress?.phase === 'importing' && progress.bytesTotal > 0
        ? progress.bytesProcessed / progress.bytesTotal
        : null
  const counts: Partial<Record<View, number>> = { screenshots: library.screenshotCount, bin: library.binCount }
  // Views opened from Tidy up keep it highlighted, so the way back is visible.
  const current: View = props.view === 'duplicates' || props.view === 'hidden' ? 'cleanup' : props.view

  return (
    <aside aria-label={t('Photo Vault')} className="drag flex w-[232px] shrink-0 flex-col gap-[18px] border-r border-line bg-shelf px-3 pb-3">
      <div className="h-7 shrink-0" />
      <div className="flex items-center gap-2.5 px-2">
        <Mark size={24} />
        <span className="font-[family-name:var(--font-display)] text-[17px] font-bold tracking-[-0.02em] text-ink">{t('Photo Vault')}</span>
      </div>

      <nav className="no-drag flex flex-col gap-[18px]" aria-label={t('Library')}>
        {SECTIONS.map((s, i) => (
          <div key={i} className="flex flex-col gap-px">
            {s.label && <div className="px-2.5 pb-1.5 text-[11px] font-[650] uppercase leading-[14px] tracking-[0.07em] text-ink-muted">{s.label}</div>}
            {s.items.map((item) => {
              const active = current === item.id
              const count = counts[item.id]
              return (
                <button
                  key={item.id}
                  onClick={() => props.onView(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] transition-colors duration-[var(--dur-instant)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-ink ${
                    active ? 'bg-brass-soft font-[650] text-brass-ink' : 'font-medium text-ink hover:bg-line/60'
                  }`}
                >
                  <span className={active ? 'text-brass-ink' : 'text-ink-muted'}>{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {count ? <span className="text-[12px] tabular-nums text-ink-muted">{n(count)}</span> : null}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="flex-1" />

      <div className="no-drag flex flex-col gap-2">
        <BackgroundWork onOpen={props.onShowAi} />
        {library.assetCount > 0 && <SafetyStatus library={library} active={props.view === 'storage'} onClick={() => props.onView('storage')} />}
        {props.importRunning && progress && (
          <button onClick={props.onShowImport} className="w-full rounded-[14px] border border-line bg-card p-3 text-left transition-colors hover:border-line-strong">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              {progress.phase === 'ready' ? <span className="size-2 rounded-full bg-brass" /> : <LoaderCircle className="size-3.5 animate-spin text-brass-ink" />}
              {progress.phase === 'ready' ? t('Review import') : t('Importing')}
            </div>
            <div className="mt-1 truncate text-xs text-ink-muted">{progressText(progress)}</div>
            {(progress.phase === 'analyzing' || progress.phase === 'importing') && progress.etaSeconds !== null && (
              <div className="truncate text-xs text-ink-muted">{etaLabel(progress.etaSeconds)}</div>
            )}
            {pct !== null && (
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-brass transition-[width] duration-300" style={{ width: `${Math.round(pct * 100)}%` }} />
              </div>
            )}
          </button>
        )}
        <div className="flex gap-1.5">
          <div className="flex-1">
            <ImportMenu
              onImport={props.onImport}
              onShowImports={() => props.onView('imports')}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brass text-[13.5px] font-semibold text-on-accent transition active:scale-[0.97]"
            >
              <Plus className="size-[15px]" strokeWidth={2.25} />
              {t('Import')}
            </ImportMenu>
          </div>
          <button
            onClick={() => props.onView('guide')}
            aria-label={t('Guide')}
            title={t('Guide')}
            aria-current={props.view === 'guide' ? 'page' : undefined}
            className={`grid size-8 place-items-center rounded-lg transition-colors ${props.view === 'guide' ? 'bg-brass-soft text-brass-ink' : 'text-ink-muted hover:bg-line/60 hover:text-ink'}`}
          >
            <CircleHelp className="size-4" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => props.onView('settings')}
            aria-label={t('Settings')}
            title={t('Settings')}
            aria-current={props.view === 'settings' ? 'page' : undefined}
            className={`grid size-8 place-items-center rounded-lg transition-colors ${props.view === 'settings' ? 'bg-brass-soft text-brass-ink' : 'text-ink-muted hover:bg-line/60 hover:text-ink'}`}
          >
            <Settings className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
  )
}

/** The library's safety in one line; opens Storage. */
function SafetyStatus(props: { library: LibraryInfo; active: boolean; onClick: () => void }) {
  const { assetCount, unprotectedCount } = props.library
  const safe = unprotectedCount === 0
  const title = safe ? t('Protected') : unprotectedCount >= assetCount ? t('No backup yet') : t('{count} without a backup', { count: n(unprotectedCount) })
  const detail = safe
    ? t('Every item has a backup copy')
    : unprotectedCount >= assetCount
      ? t('Your photos have one copy. Add a backup drive.')
      : t('Plug in a backup drive to copy them')
  return (
    <button
      onClick={props.onClick}
      aria-current={props.active ? 'page' : undefined}
      aria-label={`${t('Safety')}: ${title}. ${detail}`}
      className={`flex w-full items-start gap-2.5 rounded-[14px] border bg-card px-3 py-2.5 text-left transition-colors ${props.active ? 'border-brass' : 'border-line hover:border-line-strong'}`}
    >
      <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${safe ? 'bg-safe-soft text-safe' : 'bg-warn-soft text-warn'}`}>
        {safe ? <ShieldCheck className="size-4" strokeWidth={1.75} /> : <ShieldAlert className="size-4" strokeWidth={1.75} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-[18px] text-ink">{title}</span>
        <span className="block text-xs leading-4 text-ink-muted">{detail}</span>
      </span>
    </button>
  )
}
