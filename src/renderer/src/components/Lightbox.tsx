import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Album, Sparkles, Users, Calendar, Camera, Eye, EyeOff, RotateCcw, RotateCw, Smartphone, Trash2, Check, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, SlidersHorizontal, UserPlus, Tag, Share2, Files, FolderOpen, Heart, Info, Link2, MapPin, Fingerprint, HardDrive, History, Minus, Plus, X } from 'lucide-react'
import type { AlbumSummary, AssetDetail, AssetSummary } from '@shared/types'
import { kindLabel, originLabel } from '../lib/labels'
import { DateDialog, ShareDialog } from './Dialog'
import { Editor } from './Editor'
import { FaceOverlay } from './FaceOverlay'
import { LocationPicker } from './LocationPicker'
import { api, basename, bytes, isoLocal, mediaUrl, mimeLabel, offsetLabel, plural, sortTimeLabel, sourceTypeLabel, splitArchivePath, timeSourceLabel, wallClock } from '../lib/format'
import { t } from '../lib/i18n'

export function Lightbox(props: {
  index: number
  total: number
  getSummary: (index: number) => AssetSummary | undefined
  ensure: (from: number, to: number) => void
  version: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const { index, total } = props
  const summary = props.getSummary(index)
  const [detail, setDetail] = useState<AssetDetail | null>(null)
  const [showInfo, setShowInfo] = useState(() => {
    try {
      return localStorage.getItem('pv.info') === '1'
    } catch {
      return false
    }
  })
  // Which full-size image has finished loading. Comparing it with the one on screen (rather than resetting a
  // flag in an effect) avoids a race: an image already in the cache can report "loaded" before such an effect
  // runs, which then hid it behind the blurred thumbnail for good.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [playingLive, setPlayingLive] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dating, setDating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [showFaces, setShowFaces] = useState(() => {
    try {
      return localStorage.getItem('pv.faces') === '1'
    } catch {
      return false
    }
  })
  const [addingFace, setAddingFace] = useState(false)
  useEffect(() => {
    try {
      localStorage.setItem('pv.faces', showFaces ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (!showFaces) setAddingFace(false)
  }, [showFaces])
  const zoom = useZoom()

  useEffect(() => {
    props.ensure(index - 2, index + 2)
  })

  // The photo on screen. It changes only when the user moves to another photo — never because the library
  // reported a change (background scans do that several times a second) or because the list was re-ordered.
  const [assetId, setAssetId] = useState<number | null>(summary?.id ?? null)
  const navigated = useRef(true)
  useEffect(() => {
    navigated.current = true
    zoom.reset() // a different photo always starts fitted to the screen
    setPlayingLive(false)
    setMenu(null)
  }, [index])
  useEffect(() => {
    if (navigated.current && summary) {
      navigated.current = false
      setAssetId(summary.id)
    }
  })

  // New photo: start fresh.
  useEffect(() => {
    setShowOriginal(false)
    setDetail(null)
    if (assetId === null) return
    let alive = true
    void api.asset(assetId).then((d) => alive && setDetail(d))
    return () => {
      alive = false
    }
  }, [assetId])
  // Library changed: refresh the details quietly, keeping the picture on screen untouched.
  useEffect(() => {
    if (assetId === null) return
    let alive = true
    void api.asset(assetId).then((d) => {
      if (alive && d) setDetail((prev) => (prev && prev.id === d.id && JSON.stringify(prev) === JSON.stringify(d) ? prev : d))
    })
    return () => {
      alive = false
    }
  }, [props.version])

  const flash = (msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800)
  }
  const run = async (action: () => Promise<unknown>, done?: string): Promise<void> => {
    setMenu(null)
    try {
      await action()
      if (done) flash(done)
    } catch (err) {
      flash(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('That did not work'))
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem('pv.info', showInfo ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [showInfo])

  const go = (delta: number): void => {
    const next = index + delta
    if (next >= 0 && next < total) props.onIndex(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || dating || editing) return
      if (e.key === 'Escape' && menu) return setMenu(null)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && detail) {
        e.preventDefault()
        return void run(() => api.copyImage(detail.id), t('Picture copied'))
      }
      if (e.key === 'Escape') {
        if (zoom.scale > 1) zoom.reset()
        else props.onClose()
      } else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === '+' || e.key === '=') zoom.zoomBy(1.5)
      else if (e.key === '-' || e.key === '_') zoom.zoomBy(1 / 1.5)
      else if (e.key === '0') zoom.reset()
      else if (e.key.toLowerCase() === 'i') setShowInfo((s) => !s)
      else if (e.key.toLowerCase() === 'r') void rotate()
      else if (e.key.toLowerCase() === 'e' && detail?.mediaType === 'photo') setEditing(true)
      else if (e.key.toLowerCase() === 'f' && detail?.mediaType === 'photo') setShowFaces((s) => !s)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const toggleHidden = async (): Promise<void> => {
    if (!detail) return
    await api.setHidden([detail.id], !detail.hidden)
    setDetail({ ...detail, hidden: !detail.hidden })
  }

  const toggleBin = async (): Promise<void> => {
    if (!detail) return
    if (detail.trashed) await api.restoreFromBin([detail.id])
    else await api.moveToBin([detail.id])
    setDetail({ ...detail, trashed: !detail.trashed })
  }

  const [rotating, setRotating] = useState(false)
  const rotate = async (): Promise<void> => {
    if (!detail || detail.mediaType !== 'photo' || rotating) return
    setRotating(true)
    try {
      await api.rotate([detail.id], 90)
    } finally {
      setRotating(false)
    }
  }

  const toggleFavorite = async (): Promise<void> => {
    if (!detail) return
    await api.setFavorite(detail.id, !detail.favorite)
    setDetail({ ...detail, favorite: !detail.favorite })
  }

  const full = detail
    ? showOriginal && detail.originalVersionId
      ? mediaUrl('preview', detail.originalVersionId)
      : detail.fullView === 'video'
      ? null
      : mediaUrl(detail.fullView === 'original' ? 'original' : detail.fullView === 'preview' ? 'preview' : 'thumb', detail.id, detail.rev)
    : null

  // A different rendition (e.g. after rotating) has a different URL, so it loads behind the blurred thumbnail again.
  const fullLoaded = full !== null && loadedSrc === full

  return (
    // no-drag: the sidebar underneath is a window-drag region, which would otherwise swallow clicks on the left arrow.
    <div className="no-drag fixed inset-0 z-40 flex bg-stone-950 text-stone-100 animate-fade-in">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="drag absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-4 pr-40">
          <button onClick={props.onClose} className="no-drag grid size-9 place-items-center rounded-full transition hover:bg-white/10" aria-label={t('Close')}>
            <X className="size-5" />
          </button>
          <div className="no-drag flex items-center gap-1">
            {detail?.liveVideoId != null && (
              <button
                onClick={() => setPlayingLive((p) => !p)}
                className={`mr-1 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wider transition ${playingLive ? 'bg-white text-stone-900' : 'bg-white/10 hover:bg-white/20'}`}
                title={t('Play the Live Photo')}
              >{t('LIVE')}</button>
            )}
            {detail && detail.fullView !== 'video' && (
              <div className="mr-2 flex items-center rounded-full bg-white/10 p-0.5">
                <button onClick={() => zoom.zoomBy(1 / 1.5)} disabled={zoom.scale <= 1} className="grid size-8 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-30" aria-label={t('Zoom out')} title={t('Zoom out (−)')}>
                  <Minus className="size-4" />
                </button>
                <button onClick={zoom.reset} className="min-w-12 px-1 text-center text-[12px] tabular-nums text-stone-200 hover:text-white" title={t('Fit to screen (0)')}>
                  {zoom.percent === null ? t('Fit') : `${zoom.percent}%`}
                </button>
                <button onClick={() => zoom.zoomBy(1.5)} disabled={zoom.scale >= MAX_ZOOM} className="grid size-8 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-30" aria-label={t('Zoom in')} title={t('Zoom in (+)')}>
                  <Plus className="size-4" />
                </button>
              </div>
            )}
            {detail?.originalVersionId != null && (
              <button
                onClick={() => setShowOriginal((o) => !o)}
                className={`mr-1 inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium transition ${showOriginal ? 'bg-white text-stone-900' : 'bg-white/10 hover:bg-white/20'}`}
                title={t('This photo was edited on the phone; the unedited original is kept too')}
              >
                {showOriginal ? t('Showing the original') : t('Original')}
              </button>
            )}
            {detail?.mediaType === 'photo' && showFaces && (
              <button
                onClick={() => setAddingFace((a) => !a)}
                className={`mr-1 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition ${addingFace ? 'bg-accent-500 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                title={t('Draw a box around a face that was not found')}
              >
                <UserPlus className="size-3.5" /> {addingFace ? t('Draw around the face…') : t('Add a face')}
              </button>
            )}
            {detail?.mediaType === 'photo' && (
              <button
                onClick={() => setShowFaces((s) => !s)}
                className={`grid size-9 place-items-center rounded-full transition hover:bg-white/10 ${showFaces ? 'bg-white/15' : ''}`}
                aria-label={t('Faces')}
                title={t('Show the people in this photo — name them or fix mistakes (F)')}
              >
                <Users className="size-[18px]" />
              </button>
            )}
            {detail?.mediaType === 'photo' && (
              <button
                onClick={() => setEditing(true)}
                className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12.5px] font-medium transition hover:bg-white/20"
                title={t('Crop, adjust light and colour, filters (E). The original file is not changed.')}
              >
                <SlidersHorizontal className="size-3.5" />{' '}{t('Edit')}{detail.edited ? 'ed' : ''}
              </button>
            )}
            {detail?.mediaType === 'photo' && (
              <button
                onClick={rotate}
                disabled={rotating}
                className="grid size-9 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-40"
                aria-label={t('Rotate')}
                title={t('Rotate 90° clockwise (R). The original file is not changed.')}
              >
                <RotateCw className={`size-[18px] ${rotating ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              onClick={toggleHidden}
              className={`grid size-9 place-items-center rounded-full transition hover:bg-white/10 ${detail?.hidden ? 'text-amber-300' : ''}`}
              aria-label={detail?.hidden ? t('Show in Photos') : t('Hide from Photos')}
              title={detail?.hidden ? t('Hidden from Photos — click to show again') : t('Hide from Photos (nothing is deleted)')}
            >
              {detail?.hidden ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
            </button>
            <button
              onClick={toggleBin}
              className={`grid size-9 place-items-center rounded-full transition hover:bg-white/10 ${detail?.trashed ? 'text-red-300' : ''}`}
              aria-label={detail?.trashed ? t('Restore from Bin') : t('Move to Bin')}
              title={detail?.trashed ? t('In the Bin — click to restore') : t('Move to Bin')}
            >
              {detail?.trashed ? <RotateCcw className="size-[18px]" /> : <Trash2 className="size-[18px]" />}
            </button>
            <button onClick={toggleFavorite} className="grid size-9 place-items-center rounded-full transition hover:bg-white/10" aria-label={t('Favorite')}>
              <Heart className={`size-[18px] ${detail?.favorite ? 'fill-rose-500 text-rose-500' : ''}`} />
            </button>
            <button
              onClick={() => setShowInfo((s) => !s)}
              className={`grid size-9 place-items-center rounded-full transition hover:bg-white/10 ${showInfo ? 'bg-white/15' : ''}`}
              aria-label={t('Info')}
            >
              <Info className="size-[18px]" />
            </button>
          </div>
        </div>

        <div
          ref={zoom.containerRef}
          onDoubleClick={(e) => detail?.fullView !== 'video' && zoom.toggleAt(e.clientX, e.clientY)}
          onPointerDown={zoom.onPointerDown}
          onPointerMove={zoom.onPointerMove}
          onPointerUp={zoom.onPointerUp}
          onPointerCancel={zoom.onPointerUp}
          onContextMenu={(e) => {
            e.preventDefault()
            if (detail) setMenu({ x: e.clientX, y: e.clientY })
          }}
          className={`relative flex flex-1 touch-none items-center justify-center overflow-hidden p-6 pt-14 ${
            zoom.scale > 1 ? (zoom.dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
          }`}
        >
          {assetId !== null && (detail?.thumb ?? summary?.thumb) === 'ready' && !fullLoaded && detail?.fullView !== 'video' && (
            <img
              src={mediaUrl('thumb', assetId, detail?.rev ?? summary?.rev)}
              alt=""
              className="absolute inset-x-6 bottom-6 top-14 m-auto h-[calc(100%-5rem)] w-[calc(100%-3rem)] object-contain blur-sm"
            />
          )}
          {showFaces && detail && detail.fullView !== 'video' && fullLoaded && (
            <FaceOverlay
              assetId={detail.id}
              edits={detail.edits}
              version={props.version}
              imageRef={zoom.imageRef}
              containerRef={zoom.containerRef}
              adding={addingFace}
              onAdded={() => setAddingFace(false)}
              onMessage={flash}
            />
          )}
          {playingLive && detail?.liveVideoId != null && (
            <video
              key={`live-${detail.liveVideoId}`}
              src={mediaUrl('original', detail.liveVideoId)}
              autoPlay
              onEnded={() => setPlayingLive(false)}
              className="absolute inset-0 z-[1] m-auto max-h-[calc(100%-5rem)] max-w-[calc(100%-3rem)]"
            />
          )}
          {detail?.fullView === 'video' ? (
            <VideoPlayer key={detail.id} id={detail.id} />
          ) : (
            full && (
              <img
                ref={zoom.imageRef}
                key={full}
                src={full}
                alt={detail?.originalFilename ?? ''}
                draggable={false}
                onLoad={() => setLoadedSrc(full)}
                style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`, transition: zoom.dragging || zoom.wheeling ? 'none' : 'transform 160ms ease-out, opacity 300ms' }}
                className={`relative max-h-full max-w-full select-none object-contain will-change-transform ${fullLoaded ? 'opacity-100' : 'opacity-0'}`}
              />
            )
          )}
        </div>

        {index > 0 && (
          <button
            onClick={() => go(-1)}
            className="absolute left-4 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/30 opacity-70 backdrop-blur transition hover:bg-black/50 hover:opacity-100"
            aria-label={t('Previous')}
          >
            <ChevronLeft className="size-6" />
          </button>
        )}
        {index < total - 1 && (
          <button
            onClick={() => go(1)}
            className="absolute right-4 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/30 opacity-70 backdrop-blur transition hover:bg-black/50 hover:opacity-100"
            aria-label={t('Next')}
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>

      {menu && detail && (
        <ViewerMenu
          x={menu.x}
          y={menu.y}
          detail={detail}
          onClose={() => setMenu(null)}
          actions={{
            copyImage: () => void run(() => api.copyImage(detail.id), t('Picture copied')),
            copyFile: () => void run(() => api.copyFile(detail.id), t('File copied — paste it in a folder or chat')),
            copyPath: () => void run(() => api.copyPath(detail.id), t('File path copied')),
            openExternal: () => void run(() => api.openExternal(detail.id)),
            showInFolder: () => void run(() => api.showInFolder(detail.id)),
            saveCopy: () => void run(async () => (await api.saveCopy(detail.id)) && flash(t('Copy saved'))),
            rotate: () => void run(rotate),
            favorite: () => void run(toggleFavorite),
            hide: () => void run(toggleHidden),
            bin: () => void run(toggleBin),
            setDate: () => {
              setMenu(null)
              setDating(true)
            },
            edit: () => {
              setMenu(null)
              setEditing(true)
            },
            share: () => {
              setMenu(null)
              setSharing(true)
            },
            saveEditedCopy: () => void run(async () => (await api.saveEditedCopy(detail.id)) && flash(t('Edited copy saved'))),
            addToAlbum: (albumId, name) => void run(() => api.addToAlbum(albumId, [detail.id]), t('Added to “{name}”', { name })),
            info: () => {
              setMenu(null)
              setShowInfo(true)
            }
          }}
        />
      )}
      {editing && detail && (
        <Editor
          assetId={detail.id}
          onClose={(saved) => {
            setEditing(false)
            if (saved) flash(t('Edits saved — the original is unchanged'))
          }}
        />
      )}
      {sharing && detail && (
        <ShareDialog
          count={1}
          onClose={() => setSharing(false)}
          onShare={async (opts) => {
            setSharing(false)
            await run(() => api.share([detail.id], opts), t('Copy ready in the folder that opened'))
          }}
        />
      )}
      {dating && detail && (
        <DateDialog
          title={detail.captureTime ? t('Edit date') : t('Set date')}
          initial={detail.captureTime}
          onClose={() => setDating(false)}
          onSubmit={async (wall) => {
            setDating(false)
            await run(() => api.setDates([detail.id], wall), t('Date set'))
          }}
        />
      )}
      {toast && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-[13px] font-medium text-stone-900 shadow-2xl animate-rise-in">
          {toast}
        </div>
      )}

      {showInfo && (
        <aside className="scroll-page w-[360px] shrink-0 overflow-y-auto border-l border-white/10 bg-stone-900 px-6 pb-8 pt-16 animate-fade-in">
          {detail ? <InfoPanel d={detail} onChanged={() => void api.asset(detail.id).then(setDetail)} /> : <div className="skeleton h-6 w-40 rounded" />}
        </aside>
      )}
    </div>
  )
}

/**
 * Plays the original; if Chromium cannot decode it (HEVC without the Windows codec, old formats), asks for a
 * playable copy (made once with ffmpeg, then cached) and plays that instead.
 */
function VideoPlayer(props: { id: number }) {
  const [src, setSrc] = useState(mediaUrl('original', props.id))
  const [preparing, setPreparing] = useState<number | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const tried = useRef(false)

  useEffect(
    () =>
      api.onVideoProgress((p) => {
        if (p.assetId === props.id) setPreparing(p.fraction)
      }),
    [props.id]
  )

  const fallback = (): void => {
    if (tried.current) return
    tried.current = true
    setPreparing(0)
    api
      .prepareVideo(props.id)
      .then(() => {
        setPreparing(null)
        setSrc(mediaUrl('playable', props.id))
      })
      .catch((err: unknown) => {
        setPreparing(null)
        setFailed(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('This video cannot be played.'))
      })
  }

  if (failed) return <div className="max-w-sm text-center text-[13px] text-stone-400">{failed}</div>
  return (
    <div className="relative flex max-h-full max-w-full items-center justify-center">
      {preparing === null ? (
        <video
          src={src}
          controls
          autoPlay
          onError={fallback}
          // Some codecs "load" but decode no picture: treat that as unplayable too.
          onLoadedMetadata={(e) => e.currentTarget.videoWidth === 0 && fallback()}
          className="max-h-full max-w-full rounded-sm"
        />
      ) : (
        <div className="flex flex-col items-center gap-3 text-center text-[13px] text-stone-300">
          <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-white/80 transition-all" style={{ width: `${Math.round(preparing * 100)}%` }} />
          </div>{t('Preparing this video for playback…')}{' '}{Math.round(preparing * 100)}%
          <span className="max-w-xs text-xs text-stone-500">{t('It uses a format Windows can\'t play by itself. A playable copy is made once; the original is not changed.')}</span>
        </div>
      )}
    </div>
  )
}

type MenuActions = Record<'share' | 'copyImage' | 'copyFile' | 'copyPath' | 'openExternal' | 'showInFolder' | 'saveCopy' | 'saveEditedCopy' | 'edit' | 'rotate' | 'favorite' | 'hide' | 'bin' | 'setDate' | 'info', () => void> & {
  addToAlbum: (albumId: number, name: string) => void
}

/** Right-click menu of the viewer. */
function ViewerMenu(props: { x: number; y: number; detail: AssetDetail; actions: MenuActions; onClose: () => void }) {
  const d = props.detail
  const a = props.actions
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null)
  const [showAlbums, setShowAlbums] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: props.x, top: props.y })

  // Keep the menu on screen.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.min(props.x, window.innerWidth - r.width - 8), top: Math.min(props.y, window.innerHeight - r.height - 8) })
  }, [props.x, props.y, showAlbums])
  useEffect(() => {
    const close = (): void => props.onClose()
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [])

  const item = (label: string, icon: ReactNode, onClick: () => void, hint?: string): ReactNode => (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-stone-100 transition hover:bg-white/10"
    >
      <span className="grid size-4 place-items-center text-stone-400">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[11px] text-stone-500">{hint}</span>}
    </button>
  )
  const sep = <div className="my-1 h-px bg-white/10" />
  const photo = d.mediaType === 'photo'

  return (
    <div className="fixed inset-0 z-50" onMouseDown={props.onClose} onContextMenu={(e) => (e.preventDefault(), props.onClose())}>
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
        className="fixed w-64 rounded-xl border border-white/10 bg-stone-900/95 p-1.5 shadow-2xl backdrop-blur animate-fade-in"
      >
        {item(t('Share…'), <Share2 className="size-3.5" />, a.share)}
        {photo && item(t('Copy picture'), <Copy className="size-3.5" />, a.copyImage, 'Ctrl+C')}
        {item(t('Copy file'), <Files className="size-3.5" />, a.copyFile)}
        {item(t('Copy file path'), <Link2 className="size-3.5" />, a.copyPath)}
        {sep}
        {item(t('Open in another app'), <ExternalLink className="size-3.5" />, a.openExternal)}
        {item(t('Show in Explorer'), <FolderOpen className="size-3.5" />, a.showInFolder)}
        {item(d.edited ? t('Save original copy…') : t('Save a copy…'), <Download className="size-3.5" />, a.saveCopy)}
        {d.edited && item(t('Save edited copy…'), <Download className="size-3.5" />, a.saveEditedCopy)}
        {sep}
        {photo && item(t('Edit…'), <SlidersHorizontal className="size-3.5" />, a.edit, 'E')}
        {photo && item(t('Rotate'), <RotateCw className="size-3.5" />, a.rotate, 'R')}
        {item(d.favorite ? t('Remove from favourites') : t('Add to favourites'), <Heart className="size-3.5" />, a.favorite)}
        {item(
          t('Add to album'),
          <Album className="size-3.5" />,
          () => {
            setShowAlbums((s) => !s)
            if (!albums) void api.albums().then((list) => setAlbums(list.filter((x) => x.kind === 'user')))
          },
          '›'
        )}
        {showAlbums && (
          <div className="scroll-thin mx-1 mb-1 max-h-48 overflow-y-auto rounded-lg bg-white/5 p-1">
            {albums === null && <div className="px-2.5 py-1.5 text-[12px] text-stone-500">{t('Loading…')}</div>}
            {albums?.length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-stone-500">{t('No albums yet')}</div>}
            {albums?.map((al) => (
              <button
                key={al.id}
                onClick={() => a.addToAlbum(al.id, al.name)}
                className="block w-full truncate rounded-md px-2.5 py-1 text-left text-[12.5px] text-stone-200 hover:bg-white/10"
              >
                {al.name}
              </button>
            ))}
          </div>
        )}
        {item(d.captureTime ? t('Edit date…') : t('Set date…'), <Calendar className="size-3.5" />, a.setDate)}
        {item(d.hidden ? t('Show in Photos') : t('Hide from Photos'), d.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />, a.hide)}
        {item(t('Info'), <Info className="size-3.5" />, a.info, 'I')}
        {sep}
        {item(d.trashed ? t('Restore from Bin') : t('Move to Bin'), d.trashed ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />, a.bin)}
      </div>
    </div>
  )
}

const MAX_ZOOM = 10

/**
 * Zoom & pan for the viewer. Scale 1 = fitted to the screen. Wheel or trackpad pinch zooms towards the cursor,
 * double-click toggles between fit and actual pixels (at least 2×), dragging pans while zoomed.
 * Panning is clamped so the photo can't be dragged off screen.
 */
function useZoom() {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [state, setState] = useState({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [wheeling, setWheeling] = useState(false)
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number } | null>(null)
  const wheelTimer = useRef<number | undefined>(undefined)

  const clamp = useCallback((scale: number, x: number, y: number) => {
    const c = containerRef.current
    const img = imageRef.current
    if (!c || !img || scale <= 1) return { scale: Math.max(1, scale), x: 0, y: 0 }
    const maxX = Math.max(0, (img.offsetWidth * scale - c.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * scale - c.clientHeight) / 2)
    return { scale, x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
  }, [])

  /** Zoom by `factor` keeping the point (clientX, clientY) fixed on screen; centre when omitted. */
  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      setState((s) => {
        const c = containerRef.current
        const next = Math.min(MAX_ZOOM, Math.max(1, s.scale * factor))
        if (!c || next === s.scale) return s
        const r = c.getBoundingClientRect()
        // Point relative to the container centre, in screen pixels (top padding offsets the image slightly).
        const px = clientX === undefined ? 0 : clientX - (r.left + r.width / 2)
        const py = clientY === undefined ? 0 : clientY - (r.top + r.height / 2)
        const k = next / s.scale
        return clamp(next, px - (px - s.x) * k, py - (py - s.y) * k)
      })
    },
    [clamp]
  )

  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      // Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel notch is ~100.
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY)
      setWheeling(true)
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => setWheeling(false), 150)
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const reset = useCallback(() => setState({ scale: 1, x: 0, y: 0 }), [])

  const toggleAt = (clientX: number, clientY: number): void => {
    if (state.scale > 1) return reset()
    const img = imageRef.current
    const actual = img && img.naturalWidth && img.offsetWidth ? img.naturalWidth / img.offsetWidth : 2
    zoomAt(Math.min(MAX_ZOOM, Math.max(2, actual)), clientX, clientY)
  }

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (state.scale <= 1 || e.button !== 0) return
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: state.x, y: state.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    setState((s) => clamp(s.scale, d.x + e.clientX - d.startX, d.y + e.clientY - d.startY))
  }
  const onPointerUp = (e: ReactPointerEvent): void => {
    if (drag.current?.id === e.pointerId) drag.current = null
    setDragging(false)
  }

  const img = imageRef.current
  const percent = state.scale > 1 && img && img.naturalWidth ? Math.round(((img.offsetWidth * state.scale) / img.naturalWidth) * 100) : null

  return {
    ...state,
    percent,
    dragging,
    wheeling,
    containerRef,
    imageRef,
    reset,
    zoomBy: (f: number) => zoomAt(f),
    toggleAt,
    onPointerDown,
    onPointerMove,
    onPointerUp
  }
}

function Section(props: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-white/10 py-5 last:border-0">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
        {props.icon}
        {props.title}
      </div>
      {props.children}
    </section>
  )
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-[13px]">
      <div className="w-24 shrink-0 text-stone-400">{props.label}</div>
      <div className="min-w-0 flex-1 break-words text-stone-100">{props.children}</div>
    </div>
  )
}

function CopyHash(props: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(props.value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }}
      className="group flex w-full items-start gap-2 rounded-lg bg-white/5 px-3 py-2 text-left font-mono text-[11.5px] leading-relaxed text-stone-300 transition hover:bg-white/10"
      title={t('Copy SHA-256')}
    >
      <span className="min-w-0 flex-1 break-all select-text">{props.value}</span>
      {copied ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" /> : <Copy className="mt-0.5 size-3.5 shrink-0 opacity-50 group-hover:opacity-100" />}
    </button>
  )
}

/** Caption: click to edit, saved on blur or Ctrl+Enter. */
function Caption(props: { d: AssetDetail; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(props.d.description ?? '')
  useEffect(() => setText(props.d.description ?? ''), [props.d.id, props.d.description])
  const save = async (): Promise<void> => {
    setEditing(false)
    if ((props.d.description ?? '') !== text.trim()) {
      await api.setDescription(props.d.id, text.trim() || null)
      props.onChanged()
    }
  }
  if (!editing) {
    return (
      <>
        <button onClick={() => setEditing(true)} className="mt-3 block w-full text-left" title={t('Add or edit a caption')}>
          {props.d.description ? (
            <p className="select-text whitespace-pre-wrap text-[13.5px] leading-relaxed text-stone-200 hover:text-white">{props.d.description}</p>
          ) : (
            <span className="text-[13px] text-stone-500 hover:text-stone-300">{t('Add a caption…')}</span>
          )}
        </button>
        {props.d.autoCaption && (
          <p className="mt-2 flex select-text gap-1.5 text-[12.5px] leading-snug text-stone-400" title={t('Automatic description, made on this computer')}>
            <Sparkles className="mt-0.5 size-3 shrink-0" />
            {props.d.autoCaption}
          </p>
        )}
      </>
    )
  }
  return (
    <textarea
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setText(props.d.description ?? '')
          setEditing(false)
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save()
      }}
      rows={3}
      placeholder={t('What\'s happening here?')}
      className="mt-3 w-full resize-none rounded-lg bg-white/10 p-2 text-[13.5px] leading-relaxed text-stone-100 outline-none ring-accent-400 focus:ring-1"
    />
  )
}

/** Keywords: chips with ×, and a field that suggests existing tags. */
function Tags(props: { d: AssetDetail; onChanged: () => void }) {
  const [text, setText] = useState('')
  const [all, setAll] = useState<Array<{ tag: string; count: number }>>([])
  useEffect(() => {
    void api.allTags().then(setAll)
  }, [props.d.id])
  const add = async (t: string): Promise<void> => {
    const tag = t.trim()
    if (!tag) return
    setText('')
    await api.setTags([props.d.id], [tag], [])
    props.onChanged()
  }
  const suggestions = text.trim()
    ? all.filter((a) => a.tag.toLowerCase().includes(text.trim().toLowerCase()) && !props.d.tags.some((t) => t.toLowerCase() === a.tag.toLowerCase())).slice(0, 5)
    : []
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {props.d.tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white/10 py-0.5 pl-2.5 pr-1 text-[12px] text-stone-200">
            {t}
            <button
              onClick={async () => {
                await api.setTags([props.d.id], [], [t])
                props.onChanged()
              }}
              className="grid size-4 place-items-center rounded-full hover:bg-white/15"
              aria-label={`× ${t}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            void add(text)
          }
        }}
        placeholder={t('Add a tag…')}
        className="mt-2 h-8 w-full rounded-lg bg-white/10 px-2.5 text-[12.5px] text-stone-100 outline-none placeholder:text-stone-500 focus:ring-1 focus:ring-accent-400"
      />
      {suggestions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button key={s.tag} onClick={() => void add(s.tag)} className="rounded-full bg-white/5 px-2 py-0.5 text-[11.5px] text-stone-300 hover:bg-white/15">
              + {s.tag} <span className="text-stone-500">{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function InfoPanel({ d, onChanged }: { d: AssetDetail; onChanged: () => void }) {
  const [editingDate, setEditingDate] = useState(false)
  const [placing, setPlacing] = useState(false)
  const inferred = d.captureTimeSource === 'estimated' || d.captureTimeSource === 'duplicate'
  const camera = [d.cameraMake, d.cameraModel && d.cameraMake && d.cameraModel.startsWith(d.cameraMake) ? d.cameraModel.slice(d.cameraMake.length).trim() : d.cameraModel]
    .filter(Boolean)
    .join(' ')
  const exposure = Object.entries(d.exposure)
  return (
    <div>
      <div className="pb-2">
        <div className="text-[17px] font-semibold leading-snug">
          {d.captureTime ? wallClock(d.captureTime) : sortTimeLabel(d.sortTime)}
        </div>
        <div className="mt-1 break-all text-[13px] text-stone-400">{d.originalFilename}</div>
        <Caption d={d} onChanged={onChanged} />
      </div>

      <Section title={t('Tags')} icon={<Tag className="size-3.5" />}>
        <Tags d={d} onChanged={onChanged} />
      </Section>

      <Section title={t('Date')} icon={<Calendar className="size-3.5" />}>
        {d.captureTime ? (
          <>
            <Row label={t('Taken')}>
              {wallClock(d.captureTime)}
              {d.captureOffsetMinutes !== null && <span className="text-stone-400"> {offsetLabel(d.captureOffsetMinutes)}</span>}
            </Row>
            <Row label={t('Source')}>
              {timeSourceLabel(d.captureTimeSource)}
              {inferred && <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-300">{t('estimated')}</span>}
            </Row>
            {d.dateEvidence.length > 0 && (
              <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-stone-400">
                {d.dateEvidence.map((e) => (
                  <li key={e}>· {e}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12.5px] leading-relaxed text-amber-200">
            {timeSourceLabel('file_modified')} ({sortTimeLabel(d.sortTime)}).
          </div>
        )}
        <Row label={t('Imported')}>{isoLocal(d.importedAt)}</Row>
        <button onClick={() => setEditingDate(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[12.5px] transition hover:bg-white/10">
          <Calendar className="size-3.5" />
          {d.captureTime ? t('Edit date') : t('Set date')}
        </button>
        {editingDate && (
          <DateDialog
            title={d.captureTime ? t('Edit date') : t('Set date')}
            initial={d.captureTime}
            allowRemove={d.captureTimeSource === 'manual' || inferred}
            label={
              d.captureTimeSource && !inferred && d.captureTimeSource !== 'manual'
                ? t('This overrides the date recorded in the file (the original is kept in its metadata).')
                : t('Hand-set dates are never overwritten automatically.')
            }
            onClose={() => setEditingDate(false)}
            onSubmit={async (wall) => {
              setEditingDate(false)
              await api.setDates([d.id], wall)
              onChanged()
            }}
          />
        )}
      </Section>

      <Section title={t('Details')} icon={<Camera className="size-3.5" />}>
        <Row label={t('Type')}>
          {mimeLabel(d.mimeType)} {d.mediaType === 'video' ? 'video' : 'photo'}
        </Row>
        {d.width && d.height && (
          <Row label={t('Dimensions')}>
            {d.width} × {d.height}
            {d.mediaType === 'photo' && <span className="text-stone-400"> · {((d.width * d.height) / 1e6).toFixed(1)}{' '}{t('MP')}</span>}
          </Row>
        )}
        <Row label={t('Size')}>{bytes(d.sizeBytes)}</Row>
        {camera && <Row label={t('Camera')}>{camera}</Row>}
        {d.lensModel && <Row label={t('Lens')}>{d.lensModel}</Row>}
        {exposure.map(([k, v]) => (
          <Row key={k} label={k}>
            {v}
          </Row>
        ))}
      </Section>

      <Section title={t('Location')} icon={<MapPin className="size-3.5" />}>
        {d.latitude !== null && d.longitude !== null ? (
          <>
            {d.place && <Row label={t('Place')}>{t('Near')}{' '}{d.place}</Row>}
            <Row label={t('Coordinates')}>
              {d.latitude.toFixed(5)}, {d.longitude.toFixed(5)}
              {d.locationSource === 'manual' && <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[10.5px] text-stone-300">{t('set by you')}</span>}
            </Row>
            {d.altitude !== null && <Row label={t('Altitude')}>{Math.round(d.altitude)} m</Row>}
            <div className="mt-2 flex gap-3">
              <button onClick={() => setPlacing(true)} className="text-[12.5px] text-accent-400 hover:underline">{t('Change')}</button>
              <a
                href={`https://www.openstreetmap.org/?mlat=${d.latitude}&mlon=${d.longitude}#map=15/${d.latitude}/${d.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] text-accent-400 hover:underline"
              >{t('Open in OpenStreetMap ↗')}</a>
            </div>
          </>
        ) : (
          <button onClick={() => setPlacing(true)} className="text-[12.5px] text-accent-400 hover:underline">{t('Set location…')}</button>
        )}
      </Section>
      {placing && (
        <LocationPicker
          title={t('Where was this taken?')}
          initial={d.latitude !== null && d.longitude !== null ? { lat: d.latitude, lon: d.longitude } : null}
          onClose={() => setPlacing(false)}
          onRemove={
            d.locationSource === 'manual'
              ? async () => {
                  setPlacing(false)
                  await api.setLocation([d.id], null)
                  onChanged()
                }
              : undefined
          }
          onPick={async (loc) => {
            setPlacing(false)
            await api.setLocation([d.id], loc)
            onChanged()
          }}
        />
      )}

      <Section title={t('Origin')} icon={<Smartphone className="size-3.5" />}>
        <Row label={t('From')}>
          {originLabel(d.origin)}
          {d.originConfidence === 'probable' && (
            <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-300">{t('probable')}</span>
          )}
        </Row>
        {d.kind && d.kind !== 'photo' && d.kind !== 'video' && <Row label={t('Kind')}>{kindLabel(d.kind)}</Row>}
        {d.hidden && <Row label={t('Timeline')}>{t('Hidden from Photos')}</Row>}
        {[...d.originEvidence, ...d.kindEvidence].length > 0 && (
          <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-stone-400">
            {[...d.originEvidence, ...d.kindEvidence].map((e) => (
              <li key={e}>· {e}</li>
            ))}
          </ul>
        )}
        {!d.origin && d.originEvidence.length === 0 && <div className="mt-1 text-[12px] text-stone-500">{t('No camera data or recognisable app pattern.')}</div>}
      </Section>

      {d.people.length > 0 && (
        <Section title={t('People')} icon={<Users className="size-3.5" />}>
          <div className="flex flex-wrap gap-1.5">
            {d.people.map((p) => (
              <span key={p.id} className="rounded-full bg-white/10 px-2.5 py-1 text-[12px] text-stone-200">
                {p.name ?? t('Unnamed person')}
              </span>
            ))}
          </div>
        </Section>
      )}

      {d.albums.length > 0 && (
        <Section title={t('Albums')} icon={<Album className="size-3.5" />}>
          <div className="flex flex-wrap gap-1.5">
            {d.albums.map((a) => (
              <span key={a.id} className="rounded-full bg-white/10 px-2.5 py-1 text-[12px] text-stone-200">
                {a.name}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title={t('Archive')} icon={<HardDrive className="size-3.5" />}>
        {d.files.map((f) => (
          <div key={f.id} className="mb-2">
            <div className="break-all text-[13px]">{f.relativePath}</div>
            <div className="text-xs text-stone-400">
              {f.locationName}
              {f.verifiedAt && t(' · verified {v0}', { v0: isoLocal(f.verifiedAt) })}
            </div>
          </div>
        ))}
        {d.backups.map((b) => (
          <div key={b.path} className="mb-2">
            <div className="break-all text-[13px]">{b.path}</div>
            <div className={`text-xs ${b.status === 'ok' ? 'text-stone-400' : 'text-red-400'}`}>{t('Backup copy ·')}{' '}{b.status === 'ok' ? t('verified {v0}', { v0: isoLocal(b.verifiedAt) }) : t('missing or damaged')}
            </div>
          </div>
        ))}
        {d.backups.length === 0 && <div className="mb-2 text-xs text-amber-300/80">{t('No backup copy yet — add a backup location in Storage.')}</div>}
        <button
          onClick={() => void api.showInFolder(d.id)}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[12.5px] transition hover:bg-white/10"
        >
          <FolderOpen className="size-3.5" />{t('Show in folder')}</button>
      </Section>

      <Section title={t('Identity')} icon={<Fingerprint className="size-3.5" />}>
        <div className="mb-2 text-xs text-stone-400">{t('SHA-256 — byte-for-byte fingerprint of the original')}</div>
        <CopyHash value={d.sha256} />
      </Section>

      <Section title={t('Found in {length}', { length: plural(d.sources.length, 'place') })} icon={<History className="size-3.5" />}>
        <div className="space-y-3">
          {d.sources.map((s) => {
            const { archive, inner } = splitArchivePath(s.sourcePath, s.containerPath)
            const folder = inner.slice(0, Math.max(0, inner.length - basename(inner).length))
            return (
              <div key={s.id} className="rounded-lg bg-white/5 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 break-all text-[13px]">{s.originalFilename}</div>
                  {s.sourceType !== 'LOCAL_FOLDER' && (
                    <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-stone-300">{sourceTypeLabel(s.sourceType)}</span>
                  )}
                </div>
                {archive && <div className="mt-0.5 break-all text-xs text-stone-300">{t('in')}{' '}{basename(archive)}</div>}
                <div className="mt-0.5 break-all text-xs text-stone-400">{archive ? folder : s.sourcePath.slice(0, s.sourcePath.length - basename(s.sourcePath).length)}</div>
                {(s.album || s.sidecarPath) && (
                  <div className="mt-1 text-[11.5px] text-stone-400">
                    {s.album && <>{t('Album “')}{s.album}”</>}
                    {s.album && s.sidecarPath && ' · '}
                    {s.sidecarPath && t('Google metadata attached')}
                  </div>
                )}
                <div className="mt-1.5 text-[11.5px] text-stone-500">{t('First seen')}{' '}{isoLocal(s.firstSeenAt)}
                  {s.timesSeen > 1 && t(' · seen in {timesSeen} imports', { timesSeen: s.timesSeen })}
                </div>
              </div>
            )
          })}
        </div>
        {d.sources.length > 1 && (
          <div className="mt-3 text-xs leading-relaxed text-stone-400">{t('These files are byte-for-byte identical. Photo Vault keeps one copy in the library and remembers every place it was found.')}</div>
        )}
      </Section>
    </div>
  )
}
