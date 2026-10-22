import { useState } from 'react'
import { Eye, EyeOff, MonitorSmartphone } from 'lucide-react'
import type { AssetQuery } from '@shared/types'
import { AssetGrid } from '../components/AssetGrid'
import { FilterBar } from '../components/FilterBar'
import { NoMatches, SCREEN_ORIGINS } from './PhotosView'
import { t } from '../lib/i18n'

const actionBtn = 'no-drag inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition'

/** Screenshots and screen recordings, which the Photos timeline leaves out by default. */
export function ScreenshotsView(props: { version: number; showInPhotos: boolean; onShowInPhotos: (show: boolean) => void }) {
  const [query, setQuery] = useState<AssetQuery>({})
  const filtered = Object.values(query).some((v) => v !== undefined)
  return (
    <AssetGrid
      version={props.version}
      query={{ ...query, origins: SCREEN_ORIGINS }}
      title={t('Screenshots')}
      subtitle={
        props.showInPhotos
          ? t('Screenshots and screen recordings — also shown in the Photos timeline.')
          : t('Screenshots and screen recordings — kept out of the Photos timeline. Search still finds them.')
      }
      actions={
        <button
          onClick={() => props.onShowInPhotos(!props.showInPhotos)}
          className={`${actionBtn} bg-stone-200/70 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`}
        >
          {props.showInPhotos ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{' '}
          {props.showInPhotos ? t('Keep out of Photos') : t('Show in Photos too')}
        </button>
      }
      toolbar={<FilterBar query={query} onChange={setQuery} version={props.version} hideOrigin />}
      empty={
        filtered ? (
          <NoMatches onClear={() => setQuery({})} />
        ) : (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-stone-200/70 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              <MonitorSmartphone className="size-6" strokeWidth={1.6} />
            </div>
            <div className="text-[16px] font-semibold">{t('No screenshots')}</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-stone-500 dark:text-stone-400">{t('Screenshots from phones and computers are recognised by their file name and folder, and collected here.')}</p>
          </div>
        )
      }
    />
  )
}
