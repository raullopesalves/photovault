import { useState } from 'react'
import { Play } from 'lucide-react'
import type { AssetQuery } from '@shared/types'
import { AssetGrid } from '../components/AssetGrid'
import { FilterBar } from '../components/FilterBar'
import { NoMatches, SCREEN_ORIGINS } from './PhotosView'
import { t } from '../lib/i18n'

/** Every video, newest first. Screen recordings follow the Photos rule (kept apart unless shown). */
export function VideosView(props: { version: number; showScreenshots: boolean }) {
  const [query, setQuery] = useState<AssetQuery>({})
  const filtered = Object.values(query).some((v) => v !== undefined)
  const base: AssetQuery = { mediaType: 'video', excludeOrigins: props.showScreenshots ? undefined : SCREEN_ORIGINS }
  return (
    <AssetGrid
      version={props.version}
      query={{ ...query, ...base }}
      title={t('Videos')}
      toolbar={<FilterBar query={query} onChange={setQuery} version={props.version} base={base} />}
      empty={
        filtered ? (
          <NoMatches onClear={() => setQuery({})} />
        ) : (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-shelf text-ink-muted">
              <Play className="size-6" strokeWidth={1.6} />
            </div>
            <div className="text-[16px] font-semibold">{t('No videos yet')}</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{t('Videos you import appear here, alongside the photos in your timeline.')}</p>
          </div>
        )
      }
    />
  )
}
