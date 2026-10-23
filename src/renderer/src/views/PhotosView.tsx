import { useState } from 'react'
import { FileArchive, FolderInput, ImagePlus, SearchX, ShieldCheck, Copy as CopyIcon, Fingerprint } from 'lucide-react'
import type { AssetOrigin, AssetQuery, LibraryInfo } from '@shared/types'
import { AssetGrid } from '../components/AssetGrid'
import { FilterBar } from '../components/FilterBar'
import type { ImportKind } from '../components/ImportMenu'
import { plural } from '../lib/format'
import { t } from '../lib/i18n'

/** Kept out of the Photos timeline unless Settings say otherwise; they have their own view. */
export const SCREEN_ORIGINS: AssetOrigin[] = ['screenshot', 'screen_recording']

export function PhotosView(props: {
  version: number
  library: LibraryInfo
  showScreenshots: boolean
  onImport: (kind: ImportKind) => void
  onShowScreenshots: () => void
}) {
  const [query, setQuery] = useState<AssetQuery>({})

  if (props.library.assetCount === 0) return <EmptyLibrary onImport={props.onImport} />

  // Searching, or picking Screenshots in the Origin filter, still finds them.
  const asked = !!query.text || !!query.ids || !!query.origins?.some((o) => o !== 'unknown' && SCREEN_ORIGINS.includes(o))
  const leftOut = !props.showScreenshots && !asked && props.library.screenshotCount > 0
  // What Photos itself leaves out; the filter counts follow it, so a year's count is what that year shows here.
  const base: AssetQuery = { hidden: 'exclude', excludeOrigins: !props.showScreenshots && props.library.screenshotCount > 0 ? SCREEN_ORIGINS : undefined }

  return (
    <AssetGrid
      version={props.version}
      query={{ ...query, hidden: 'exclude', excludeOrigins: leftOut ? SCREEN_ORIGINS : undefined }}
      title={t('Photos')}
      subtitle={
        leftOut ? (
          <button onClick={props.onShowScreenshots} className="no-drag hover:text-stone-800 hover:underline dark:hover:text-stone-200">
            {t('{screenshots} kept apart in Screenshots', { screenshots: plural(props.library.screenshotCount, 'screenshot') })}
          </button>
        ) : undefined
      }
      toolbar={<FilterBar query={query} onChange={setQuery} version={props.version} base={base} />}
      empty={<NoMatches onClear={() => setQuery({})} />}
    />
  )
}

export function NoMatches(props: { onClear?: () => void; title?: string; body?: string }) {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center animate-fade-in">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-stone-200/70 text-ink-muted dark:bg-stone-800 dark:text-stone-400">
        <SearchX className="size-6" strokeWidth={1.5} />
      </div>
      <div className="text-[16px] font-semibold">{props.title ?? t('No matches')}</div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{props.body ?? t('Nothing in your library matches these filters.')}</p>
      {props.onClear && (
        <button onClick={props.onClear} className="mt-4 h-9 rounded-lg bg-stone-200/70 px-4 text-[13px] font-medium hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700">{t('Clear filters')}</button>
      )}
    </div>
  )
}

function EmptyLibrary(props: { onImport: (kind: ImportKind) => void }) {
  return (
    <div className="drag flex h-full items-center justify-center">
      <div className="no-drag w-[560px] text-center animate-rise-in">
        <div className="mx-auto mb-7 grid size-20 place-items-center rounded-3xl bg-stone-200/70 text-ink-muted dark:bg-stone-800 dark:text-stone-400">
          <ImagePlus className="size-9" strokeWidth={1.4} />
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">{t('Start your archive')}</h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">{t('Choose a folder of photos or a Google Takeout export — from an old drive, a phone backup or ZIP archives. You can also drop them anywhere in this window.')}</p>
        <div className="mt-8 flex justify-center gap-3">
          <button
            onClick={() => props.onImport('folder')}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-stone-900 px-6 text-[14px] font-medium text-white shadow-sm transition hover:bg-stone-800 active:scale-[0.98] dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
          >
            <FolderInput className="size-4" strokeWidth={2} />{t('Import a folder')}</button>
          <button
            onClick={() => props.onImport('zip')}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-stone-200/70 px-6 text-[14px] font-medium text-stone-800 transition hover:bg-stone-200 active:scale-[0.98] dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700"
          >
            <FileArchive className="size-4" strokeWidth={2} />{t('Google Takeout / ZIP')}</button>
        </div>
        <div className="mx-auto mt-12 grid max-w-lg grid-cols-3 gap-4 text-left">
          {[
            { icon: <ShieldCheck className="size-4" />, title: t('Originals untouched'), body: t('Files are copied and verified. Sources are never changed.') },
            { icon: <Fingerprint className="size-4" />, title: t('Exact duplicates'), body: t('SHA-256 recognises identical files, whatever their name.') },
            { icon: <CopyIcon className="size-4" />, title: t('Full provenance'), body: t('Every place a photo was found is remembered.') }
          ].map((f) => (
            <div key={f.title} className="rounded-[14px] border border-line bg-card p-3.5">
              <div className="mb-2 text-accent-600 dark:text-accent-400">{f.icon}</div>
              <div className="text-[13px] font-medium">{f.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-ink-muted">{f.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
