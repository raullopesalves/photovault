import { memo, useEffect, useState, type MouseEvent } from 'react'
import { Check, EyeOff, Heart, ImageOff, Play, Repeat } from 'lucide-react'
import type { AssetSummary } from '@shared/types'
import { api, duration, mediaUrl, mimeLabel, sortTimeLabel } from '../lib/format'
import { kindLabel } from '../lib/labels'
import { t } from '../lib/i18n'

export const Tile = memo(function Tile(props: {
  /** Position in the timeline, as data-index (the viewer closes into it). */
  index: number
  asset: AssetSummary | undefined
  size: number
  selected: boolean
  /** True while any tile is selected: a click then toggles selection instead of opening. */
  selecting: boolean
  /** The grid's one Tab stop; arrow keys move it (AssetGrid). */
  tabbable: boolean
  /** `from`: the tile on screen, for the viewer's open animation. */
  onOpen: (from?: DOMRect) => void
  onToggle: (shift: boolean) => void
  onFocus: () => void
}) {
  const { asset, size, selected } = props
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  // Optimistic favourite state so the heart reacts instantly; the grid refreshes from the library afterwards.
  const [favOverride, setFavOverride] = useState<boolean | null>(null)
  useEffect(() => setFavOverride(null), [asset?.favorite])

  if (!asset) return <div className="skeleton shrink-0 rounded-[2px]" style={{ width: size, height: size }} />

  const showImg = asset.thumb === 'ready' && !broken
  const favorite = favOverride ?? asset.favorite
  // What a screen reader says for the tile: "Photo, 14 Jul 2019, 19:42, Favourite".
  const label = [
    asset.mediaType === 'video' ? (asset.kind === 'loop' ? kindLabel('loop') : `${t('Video')} ${duration(asset.durationMs)}`) : asset.kind === 'animated' ? t('Animated image') : asset.liveVideoId !== null ? t('Live Photo') : t('Photo'),
    asset.captureKnown ? sortTimeLabel(asset.sortTime) : t('No date'),
    favorite ? t('Favourite') : '',
    asset.hidden ? t('Hidden from Photos') : ''
  ]
    .filter(Boolean)
    .join(', ')
  const onClick = (e: MouseEvent): void => {
    if (props.selecting || e.shiftKey || e.ctrlKey || e.metaKey) props.onToggle(e.shiftKey)
    else props.onOpen(e.currentTarget.getBoundingClientRect())
  }
  return (
    <div
      role="gridcell"
      data-index={props.index}
      tabIndex={props.tabbable ? 0 : -1}
      aria-selected={selected}
      aria-label={label}
      onClick={onClick}
      onFocus={props.onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // Without this the same keypress reaches the viewer's Close button, which has focus by then, and closes it.
          e.preventDefault()
          props.onOpen(e.currentTarget.getBoundingClientRect())
        }
        if (e.key === ' ') {
          e.preventDefault()
          props.onToggle(e.shiftKey)
        }
      }}
      className={`group relative shrink-0 cursor-default overflow-hidden rounded-[2px] transition-colors duration-[var(--dur-gentle)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-brass-ink ${
        selected ? 'bg-brass' : 'bg-shelf'
      }`}
      style={{ width: size, height: size }}
    >
      <div
        className={`size-full overflow-hidden transition-[transform,box-shadow] duration-[var(--dur-gentle)] ${
          selected ? 'scale-[0.84] rounded-[1px] shadow-[0_0_0_4px_var(--mat)] ease-[var(--ease-mount)]' : 'ease-[var(--ease-out-soft)]'
        }`}
      >
        {showImg ? (
          <img
            src={mediaUrl('thumb', asset.id, asset.rev)}
            alt=""
            draggable={false}
            decoding="async"
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
            className={`img-fade size-full object-cover ${loaded ? 'loaded' : ''}`}
          />
        ) : asset.thumb === 'pending' ? (
          <div className="skeleton size-full" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 text-ink-faint">
            <ImageOff className="size-5" strokeWidth={1.5} />
            <span className="text-[10px] font-medium uppercase tracking-wider">{mimeLabel(asset.mimeType)}</span>
          </div>
        )}
      </div>
      {!selected && <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 to-transparent to-40% opacity-0 transition-opacity group-hover:opacity-100" />}
      <button
        tabIndex={-1}
        aria-label={selected ? t('Deselect') : t('Select')}
        onClick={(e) => {
          e.stopPropagation()
          props.onToggle(e.shiftKey)
        }}
        className={`absolute left-1.5 top-1.5 grid size-[22px] place-items-center rounded-full transition ${
          selected
            ? 'bg-brass text-on-accent opacity-100 ring-2 ring-[var(--mat)]'
            : `border-2 border-white/90 bg-black/10 text-transparent hover:bg-white/30 ${props.selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`
        }`}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </button>
      {(asset.mediaType === 'video' || asset.kind === 'animated') && (
        <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 rounded-[4px] bg-black/50 px-1.5 py-0.5 font-mono text-[10.5px] text-white backdrop-blur-sm">
          {asset.kind === 'loop' || asset.kind === 'animated' ? <Repeat className="size-2.5" /> : <Play className="size-2.5 fill-white" />}
          {asset.kind === 'animated' ? 'GIF' : duration(asset.durationMs)}
        </div>
      )}
      {asset.liveVideoId !== null && (
        <div className="pointer-events-none absolute right-1.5 top-1.5 rounded-[4px] bg-black/50 px-1.5 py-0.5 text-[9.5px] font-[650] tracking-[0.06em] text-white backdrop-blur-sm">{t('LIVE')}</div>
      )}
      {asset.hidden && (
        <div className="pointer-events-none absolute bottom-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm" title={t('Hidden from Photos')}>
          <EyeOff className="size-3" />
        </div>
      )}
      <button
        tabIndex={-1}
        aria-label={favorite ? t('Remove from favourites') : t('Add to favourites')}
        title={favorite ? t('Remove from favourites') : t('Add to favourites')}
        onClick={(e) => {
          e.stopPropagation()
          const next = !favorite
          setFavOverride(next)
          void api.setFavorite(asset.id, next).catch(() => setFavOverride(null))
        }}
        className={`absolute bottom-1 left-1 grid size-7 place-items-center rounded-full transition hover:scale-110 ${
          favorite ? 'opacity-100' : props.selecting ? 'hidden' : 'opacity-0 hover:bg-black/20 group-hover:opacity-100'
        }`}
      >
        <Heart className={`size-[15px] drop-shadow ${favorite ? 'fill-accent-400 text-accent-400' : 'text-white'}`} strokeWidth={2.25} />
      </button>
    </div>
  )
})
