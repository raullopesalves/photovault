import { useEffect, useState } from 'react'
import { Album, ArrowLeft, FolderOutput, Globe, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import type { AlbumSummary, AssetQuery, SmartAlbum } from '@shared/types'
import { api, mediaUrl, n, plural } from '../lib/format'
import { AssetGrid } from '../components/AssetGrid'
import { ConfirmDialog, PromptDialog } from '../components/Dialog'
import { FilterBar } from '../components/FilterBar'
import { NoMatches } from './PhotosView'
import { t } from '../lib/i18n'

export function AlbumsView(props: { version: number }) {
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [smart, setSmart] = useState<SmartAlbum[]>([])
  const [openSmart, setOpenSmart] = useState<number | null>(null)

  useEffect(() => {
    void api.albums().then(setAlbums)
    void api.smartAlbums().then(setSmart)
  }, [props.version])

  if (openId !== null) return <AlbumDetail id={openId} version={props.version} onBack={() => setOpenId(null)} />
  const smartOpen = smart.find((s) => s.id === openSmart)
  if (smartOpen) return <SmartAlbumPage album={smartOpen} version={props.version} onBack={() => setOpenSmart(null)} />

  const user = (albums ?? []).filter((a) => a.kind === 'user')
  const google = (albums ?? []).filter((a) => a.kind === 'takeout')

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="drag sticky top-0 z-10 flex items-end justify-between bg-stone-50/80 px-7 pb-4 pr-40 pt-5 backdrop-blur-xl dark:bg-stone-950/75">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[22px] font-semibold tracking-tight">{t('Albums')}</h1>
          <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{t('Albums only reference photos — removing or deleting never touches your files.')}</div>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="no-drag inline-flex h-9 items-center gap-1.5 rounded-lg bg-stone-900 px-3.5 text-[13px] font-medium text-white transition hover:bg-stone-800 dark:bg-white dark:text-stone-900"
        >
          <Plus className="size-4" />{' '}{t('New album')}</button>
      </div>

      <div className="px-7 pb-12">
        {albums?.length === 0 && smart.length === 0 && (
          <div className="mx-auto mt-20 max-w-sm text-center">
            <div className="mx-auto mb-5 grid size-16 place-items-center rounded-3xl bg-stone-200/70 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              <Album className="size-7" strokeWidth={1.5} />
            </div>
            <div className="text-[17px] font-semibold">{t('No albums yet')}</div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-stone-500 dark:text-stone-400">{t('Select photos in the timeline and choose “Add to album”, or create an empty one. Albums from a Google Takeout appear here automatically.')}</p>
          </div>
        )}
        {smart.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              <Wand2 className="size-3.5" />{' '}{t('Smart albums')}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-5 gap-y-6">
              {smart.map((a) => (
                <button key={a.id} onClick={() => setOpenSmart(a.id)} className="group text-left outline-none">
                  <div className="relative aspect-square overflow-hidden rounded-xl bg-stone-200 shadow-sm dark:bg-stone-800">
                    {a.coverId ? (
                      <img src={mediaUrl('thumb', a.coverId)} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                    ) : (
                      <div className="grid size-full place-items-center text-stone-400">
                        <Wand2 className="size-8" strokeWidth={1.3} />
                      </div>
                    )}
                    <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-black/45 text-white">
                      <Wand2 className="size-3.5" />
                    </span>
                  </div>
                  <div className="mt-2 truncate text-[13.5px] font-medium">{a.name}</div>
                  <div className="text-xs text-stone-500 dark:text-stone-400">{plural(a.count, 'item')}{' '}{t('· updates itself')}</div>
                </button>
              ))}
            </div>
          </section>
        )}
        {user.length > 0 && <AlbumSection title={t('My albums')} albums={user} onOpen={setOpenId} />}
        {google.length > 0 && <AlbumSection title={t('From Google Photos')} albums={google} onOpen={setOpenId} />}
      </div>

      {creating && (
        <PromptDialog
          title={t('New album')}
          placeholder={t('Album name')}
          confirm={t('Create')}
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            setCreating(false)
            const a = await api.createAlbum(name, [])
            setOpenId(a.id)
          }}
        />
      )}
    </div>
  )
}

/** A saved search: shows whatever currently matches it. */
function SmartAlbumPage(props: { album: SmartAlbum; version: number; onBack: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const iconBtn =
    'grid size-8 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'
  return (
    <>
      <AssetGrid
        version={props.version}
        query={props.album.query}
        title={
          <span className="flex items-center gap-2">
            <button onClick={props.onBack} className={`no-drag ${iconBtn}`} aria-label={t('All albums')}>
              <ArrowLeft className="size-4" />
            </button>
            {props.album.name}
            <span className="rounded-full bg-accent-50 px-2 py-0.5 align-middle text-[11px] font-medium text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">{t('Smart')}</span>
          </span>
        }
        subtitle={describeQuery(props.album.query)}
        actions={
          <>
            <button onClick={() => setRenaming(true)} className={iconBtn} aria-label={t('Rename')} title={t('Rename')}>
              <Pencil className="size-4" />
            </button>
            <button onClick={() => setDeleting(true)} className={iconBtn} aria-label={t('Delete smart album')} title={t('Delete smart album (photos stay)')}>
              <Trash2 className="size-4" />
            </button>
          </>
        }
        empty={<NoMatches title={t('Nothing matches yet')} body={t('Photos that match this search will appear here automatically.')} />}
      />
      {renaming && (
        <PromptDialog
          title={t('Rename smart album')}
          initial={props.album.name}
          confirm={t('Rename')}
          onClose={() => setRenaming(false)}
          onSubmit={async (name) => {
            setRenaming(false)
            await api.updateSmartAlbum(props.album.id, { name })
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('Delete “{name}”?', { name: props.album.name })}
          body={t('Only the saved search is removed. No photos are touched.')}
          confirm={t('Delete')}
          destructive
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            setDeleting(false)
            await api.deleteSmartAlbum(props.album.id)
            props.onBack()
          }}
        />
      )}
    </>
  )
}

function describeQuery(q: AssetQuery): string {
  const parts: string[] = []
  if (q.text) parts.push(`“${q.text}”`)
  if (q.favorite) parts.push('favourites')
  if (q.types?.length) parts.push(q.types.join(' or '))
  if (q.years?.length) parts.push(q.years.map((y) => (y === 0 ? t('no date') : String(y))).join(', '))
  if (q.cameras?.length) parts.push(q.cameras.map((c) => c.model).join(', '))
  if (q.origins?.length) parts.push(t('from {v0}', { v0: q.origins.join(', ') }))
  if (q.personId) parts.push(t('a person'))
  if (q.tag) parts.push(t('tag {tag}', { tag: q.tag }))
  return parts.length ? t('Everything matching {v0}', { v0: parts.join(' · ') }) : t('All photos')
}

function AlbumSection(props: { title: string; albums: AlbumSummary[]; onOpen: (id: number) => void }) {
  return (
    <section className="mt-4">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{props.title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-5 gap-y-6">
        {props.albums.map((a) => (
          <button key={a.id} onClick={() => props.onOpen(a.id)} className="group text-left outline-none">
            <div className="aspect-square overflow-hidden rounded-xl bg-stone-200 shadow-sm ring-accent-500 group-focus-visible:ring-2 dark:bg-stone-800">
              {a.coverAssetId && a.coverThumb === 'ready' ? (
                <img src={mediaUrl('thumb', a.coverAssetId)} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
              ) : (
                <div className="grid size-full place-items-center text-stone-400 dark:text-stone-600">
                  <Album className="size-8" strokeWidth={1.3} />
                </div>
              )}
            </div>
            <div className="mt-2 truncate text-[13.5px] font-medium">{a.name}</div>
            <div className="text-xs text-stone-500 dark:text-stone-400">{plural(a.count, 'item')}</div>
          </button>
        ))}
      </div>
    </section>
  )
}

function AlbumDetail(props: { id: number; version: number; onBack: () => void }) {
  const [album, setAlbum] = useState<AlbumSummary | null>(null)
  const [query, setQuery] = useState<AssetQuery>({ albumId: props.id })
  const [renaming, setRenaming] = useState(false)
  const [describing, setDescribing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [webStatus, setWebStatus] = useState<string | null>(null)

  useEffect(() => {
    void api.album(props.id).then((a) => (a ? setAlbum(a) : props.onBack()))
  }, [props.id, props.version])

  if (!album) return <div className="h-full" />

  const iconBtn =
    'grid size-8 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'

  return (
    <>
      <AssetGrid
        version={props.version}
        query={{ ...query, albumId: props.id }}
        albumId={props.id}
        title={
          <span className="flex items-center gap-2">
            <button onClick={props.onBack} className={`no-drag ${iconBtn}`} aria-label={t('All albums')}>
              <ArrowLeft className="size-4" />
            </button>
            {album.name}
            {album.kind === 'takeout' && (
              <span className="rounded-full bg-accent-50 px-2 py-0.5 align-middle text-[11px] font-medium text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">{t('Google Photos')}</span>
            )}
          </span>
        }
        subtitle={
          <button onClick={() => setDescribing(true)} className="no-drag text-left hover:text-stone-800 dark:hover:text-stone-200">
            {album.description ?? t('Add a description')}
          </button>
        }
        actions={
          <>
            {album.count > 0 && (
              <button
                onClick={async () => {
                  const ids = await api.assetIdsInRange({ albumId: props.id }, 0, 200_000)
                  await api.exportOriginals(ids)
                }}
                className={iconBtn}
                aria-label={t('Export album')}
                title={t('Export: copy this album\'s original files to a folder')}
              >
                <FolderOutput className="size-4" />
              </button>
            )}
            {album.count > 0 && (
              <button
                disabled={webStatus !== null}
                onClick={async () => {
                  const ids = await api.assetIdsInRange({ albumId: props.id }, 0, 200_000)
                  const off = api.onExportProgress((p) => setWebStatus(t('Making the web page… {done} of {total}', { done: n(p.done), total: n(p.total) })))
                  try {
                    const r = await api.exportWebGallery(ids, album.name, album.description)
                    setWebStatus(r ? (r.failed ? t('Web page ready — {failed} could not be included', { failed: n(r.failed) }) : t('Web page ready: open index.html, or zip the folder to send it')) : null)
                  } catch (err) {
                    setWebStatus(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
                  } finally {
                    off()
                    window.setTimeout(() => setWebStatus(null), 6000)
                  }
                }}
                className={iconBtn}
                aria-label={t('Share as a web page')}
                title={t('Share as a web page: a folder with index.html that opens in any browser — zip it and send it, or upload it to share a link')}
              >
                <Globe className="size-4" />
              </button>
            )}
            <button onClick={() => setRenaming(true)} className={iconBtn} aria-label={t('Rename album')} title={t('Rename')}>
              <Pencil className="size-4" />
            </button>
            <button onClick={() => setDeleting(true)} className={iconBtn} aria-label={t('Delete album')} title={t('Delete album')}>
              <Trash2 className="size-4" />
            </button>
          </>
        }
        toolbar={album.count > 0 ? <FilterBar query={query} onChange={(q) => setQuery({ ...q, albumId: props.id })} version={props.version} /> : undefined}
        empty={
          album.count === 0 ? (
            <NoMatches title={t('This album is empty')} body={t('Select photos in the Photos view and choose “Add to album”.')} />
          ) : (
            <NoMatches onClear={() => setQuery({ albumId: props.id })} />
          )
        }
      />
      {webStatus && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-stone-900 px-4 py-2 text-[13px] text-white shadow-lg dark:bg-white dark:text-stone-900">{webStatus}</div>
      )}
      {renaming && (
        <PromptDialog
          title={t('Rename album')}
          initial={album.name}
          confirm={t('Rename')}
          onClose={() => setRenaming(false)}
          onSubmit={async (name) => {
            setRenaming(false)
            setAlbum(await api.updateAlbum(album.id, { name }))
          }}
        />
      )}
      {describing && (
        <PromptDialog
          title={t('Album description')}
          initial={album.description ?? ''}
          placeholder={t('What is this album about?')}
          confirm={t('Save')}
          onClose={() => setDescribing(false)}
          onSubmit={async (description) => {
            setDescribing(false)
            setAlbum(await api.updateAlbum(album.id, { description }))
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('Delete “{name}”?', { name: album.name })}
          body={
            <>{t('The album is removed. The')}{' '}{plural(album.count, 'photo')}{' '}{t('in it stay in your library and on disk — nothing is deleted.')}{album.kind === 'takeout' && t(' Re-importing the same Takeout will recreate it.')}
            </>
          }
          confirm={t('Delete album')}
          destructive
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            setDeleting(false)
            await api.deleteAlbum(album.id)
            props.onBack()
          }}
        />
      )}
    </>
  )
}
