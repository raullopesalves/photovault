import { useState } from 'react'
import { Heart } from 'lucide-react'
import type { AssetQuery } from '@shared/types'
import { AssetGrid } from '../components/AssetGrid'
import { FilterBar } from '../components/FilterBar'
import { NoMatches } from './PhotosView'
import { t } from '../lib/i18n'

export function FavoritesView(props: { version: number }) {
  const [query, setQuery] = useState<AssetQuery>({})
  const filtered = Object.values(query).some((v) => v !== undefined)
  return (
    <AssetGrid
      version={props.version}
      query={{ ...query, favorite: true }}
      title={t('Favourites')}
      toolbar={<FilterBar query={query} onChange={setQuery} version={props.version} base={{ favorite: true }} hideFavorite />}
      empty={
        filtered ? (
          <NoMatches onClear={() => setQuery({})} />
        ) : (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brass-soft text-brass-ink">
              <Heart className="size-6" strokeWidth={1.6} />
            </div>
            <div className="text-[16px] font-semibold">{t('No favourites yet')}</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{t('Tap the heart on a photo, or select several and choose “Favourite”. Favourites from Google Takeout are kept too.')}</p>
          </div>
        )
      }
    />
  )
}
