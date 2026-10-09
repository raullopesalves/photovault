import { BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import sharp from 'sharp'
import { unlink } from 'node:fs/promises'
import { binIds, deletePermanently, forgetDeleted, moveToBin, restoreFromBin } from '@core/library/bin'
import { listSnapshots, snapshotDatabase, snapshotDir } from '@core/library/dbSnapshots'
import type { AssetQuery, ItemClassification, LibraryChangeReason, Settings } from '@shared/types'
import { originalPathFor } from '@core/thumbnails/thumbnails'
import { verifyIssues } from '@core/library/verify'
import { assetDetail, assetIdsInRange, assetsPage, duplicateGroups, importItems, listImports, setFavorite, timeline } from '@core/repo/queries'
import { addAssets, createAlbum, deleteAlbum, getAlbum, listAlbums, removeAssets, setFavorites, setHidden, updateAlbum } from '@core/repo/albums'
import { facets, setHiddenByQuery } from '@core/repo/filters'
import { setManualDates } from '@core/dating/dating'
import { dismissNearDuplicates, hideAllNearDuplicateExtras, nearDuplicates } from '@core/repo/nearDuplicates'
import { similarPhotos } from '@core/repo/similar'
import { mapClusters } from '@core/repo/geo'
import { memories } from '@core/repo/memories'
import { fillPlaces } from '@core/geo/fillPlaces'
import { allTags, assetFaces, createSmartAlbum, deleteFace, deleteSmartAlbum, setDescription, setLocation, setTags, smartAlbums, updateSmartAlbum } from '@core/repo/annotate'
import { getPerson, listPeople, markDifferentPeople, mergePeople, moveFaces, personFaces, personMerges, undoMerge, peopleSuggestions, removeFromPerson, renamePerson, setPersonHidden } from '@core/repo/people'
import { rotateAssets } from '@core/library/rotate'
import { exportOriginals } from '@core/library/export'
import { playableVideo } from './videos'
import { editPreview, editState, renderEdited, saveEdits } from './editing'
import { prepareShare } from './share'
import { cancelPhoneCopy, copyPhone } from './phoneImport'
import { listPhones } from '@core/sources/phone'
import { checkForUpdates, installUpdateNow, setUpdateToken, updateStatus } from './updater'
import type { LibraryController } from './controller'
import { languageOf, loadSettings, saveSettings, type StoredSettings } from './settings'

function int(v: unknown, name: string, min = 0): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) throw new Error(`Invalid ${name}`)
  return v
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 4096) throw new Error(`Invalid ${name}`)
  return v
}

function idList(v: unknown): number[] {
  if (!Array.isArray(v) || v.length > 100_000) throw new Error('Invalid id list')
  return v.map((x) => int(x, 'id', 1))
}

/** Validates a renderer-supplied timeline filter; unknown fields are dropped. */
function query(v: unknown): AssetQuery | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'object') throw new Error('Invalid query')
  const q = v as Record<string, unknown>
  const out: AssetQuery = {}
  if (typeof q.text === 'string' && q.text.trim()) out.text = q.text.slice(0, 200)
  if (q.mediaType === 'photo' || q.mediaType === 'video') out.mediaType = q.mediaType
  if (q.favorite === true) out.favorite = true
  if (typeof q.year === 'number' && Number.isInteger(q.year)) out.year = q.year
  if (typeof q.cameraModel === 'string') {
    out.cameraModel = q.cameraModel
    out.cameraMake = typeof q.cameraMake === 'string' ? q.cameraMake : null
  }
  if (typeof q.sourceType === 'string') out.sourceType = q.sourceType.slice(0, 40)
  if (typeof q.albumId === 'number') out.albumId = int(q.albumId, 'album', 1)
  if (typeof q.personId === 'number') out.personId = int(q.personId, 'person', 1)
  if (typeof q.tag === 'string' && q.tag.trim()) out.tag = q.tag.trim().slice(0, 60)
  if (typeof q.origin === 'string' && /^[a-z_]{1,24}$/.test(q.origin)) out.origin = q.origin as AssetQuery['origin']
  if (typeof q.kind === 'string' && /^[a-z_]{1,24}$/.test(q.kind)) out.kind = q.kind as AssetQuery['kind']
  if (q.originHint === 'whatsapp_size' || q.originHint === 'social_size' || q.originHint === 'none') out.originHint = q.originHint
  if (q.hidden === 'exclude' || q.hidden === 'only') out.hidden = q.hidden
  if (q.trash === 'only') out.trash = 'only'
  if (q.sort === 'added' || q.sort === 'relevance') out.sort = q.sort
  if (q.located === true) out.located = true
  if (Array.isArray(q.ids)) out.ids = q.ids.slice(0, 5000).filter((x): x is number => Number.isSafeInteger(x) && (x as number) > 0)
  if (Array.isArray(q.bbox) && q.bbox.length === 4 && q.bbox.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    out.bbox = q.bbox as [number, number, number, number]
  }
  const list = <T>(v: unknown, ok: (x: unknown) => x is T): T[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const items = v.slice(0, 100).filter(ok)
    return items.length ? items : undefined
  }
  const word = (x: unknown): x is string => typeof x === 'string' && /^[a-z_]{1,24}$/i.test(x)
  out.types = list(q.types, (x): x is NonNullable<AssetQuery['types']>[number] => ['photo', 'video', 'loop', 'animated', 'sticker'].includes(x as string))
  out.years = list(q.years, (x): x is number => typeof x === 'number' && Number.isInteger(x) && (x === 0 || (x > 1800 && x < 3000)))
  out.cameras = list(
    q.cameras,
    (x): x is { make: string | null; model: string } =>
      typeof x === 'object' && x !== null && typeof (x as { model: unknown }).model === 'string' && ['string', 'object'].includes(typeof (x as { make: unknown }).make)
  )?.map((c) => ({ make: typeof c.make === 'string' ? c.make.slice(0, 200) : null, model: c.model.slice(0, 200) }))
  out.sourceTypes = list(q.sourceTypes, word)
  out.origins = list(q.origins, word) as AssetQuery['origins']
  return out
}

const CLASSIFICATIONS = new Set<ItemClassification | 'all'>(['all', 'pending', 'new', 'duplicate_library', 'duplicate_batch', 'unsupported', 'error'])

export function registerIpc(controller: LibraryController, getWindow: () => BrowserWindow | null, applyTheme: (s: StoredSettings) => void): void {
  let settings = loadSettings()
  /** Native dialog text in the interface language. */
  const tr = (en: string, pt: string): string => (languageOf(settings) === 'pt' ? pt : en)
  const changed = (reason: LibraryChangeReason): void => getWindow()?.webContents.send('library:changed', reason)

  const lib = () => {
    if (!controller.library) throw new Error('No library is open.')
    return controller.library
  }

  const chooseLibraryFolder = async (title: string): Promise<string | null> => {
    const win = getWindow()
    const opts = { title, properties: ['openDirectory', 'createDirectory', 'promptToCreate'] as Array<'openDirectory' | 'createDirectory' | 'promptToCreate'> }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : (r.filePaths[0] as string)
  }

  const openAndRemember = (root: string, create: boolean) => {
    try {
      controller.open(root, create)
      settings = { ...settings, libraryPath: controller.library?.root ?? null }
      saveSettings(settings)
    } catch (err) {
      controller.lastError = err instanceof Error ? err.message : String(err)
    }
    return controller.state()
  }

  ipcMain.handle('app:state', () => controller.state())
  ipcMain.handle('library:create', async () => {
    const root = await chooseLibraryFolder(tr('Choose where to keep your Photo Vault library', 'Escolha onde guardar a sua biblioteca do Photo Vault'))
    return root ? openAndRemember(root, true) : controller.state()
  })
  ipcMain.handle('library:open', async () => {
    const root = await chooseLibraryFolder(tr('Open an existing Photo Vault library', 'Abrir uma biblioteca do Photo Vault existente'))
    return root ? openAndRemember(root, false) : controller.state()
  })
  ipcMain.handle('library:timeline', (_e, q: unknown) => timeline(lib(), query(q)))
  ipcMain.handle('library:page', (_e, offset: unknown, limit: unknown, q: unknown) =>
    assetsPage(lib(), int(offset, 'offset'), int(limit, 'limit', 1), query(q))
  )
  ipcMain.handle('library:facets', () => facets(lib()))
  ipcMain.handle('library:favorites', (_e, ids: unknown, fav: unknown) => {
    setFavorites(lib(), idList(ids), fav === true)
    changed('favorite')
  })
  ipcMain.handle('library:setDates', (_e, ids: unknown, wall: unknown) => {
    if (wall !== null && (typeof wall !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wall))) throw new Error('Invalid date')
    setManualDates(lib(), idList(ids), wall as string | null)
    changed('favorite')
    controller.scheduleDating() // a hand-set date can be lent to matching copies
  })
  ipcMain.handle('library:idsInRange', (_e, q: unknown, offset: unknown, limit: unknown) =>
    assetIdsInRange(lib(), query(q), int(offset, 'offset'), int(limit, 'limit', 1))
  )
  ipcMain.handle('bin:move', (_e, ids: unknown) => {
    const n = moveToBin(lib(), idList(ids))
    changed('favorite')
    return n
  })
  ipcMain.handle('bin:restore', (_e, ids: unknown) => {
    const n = restoreFromBin(lib(), ids === 'all' ? binIds(lib()) : idList(ids))
    changed('favorite')
    return n
  })
  let deleting = false
  ipcMain.handle('bin:delete', async (_e, ids: unknown, opts: unknown) => {
    if (deleting) throw new Error('A deletion is already running.')
    const library = lib()
    const skipRecycleBin = (opts as { skipRecycleBin?: unknown } | null)?.skipRecycleBin === true
    const targets = ids === 'all' ? binIds(library) : idList(ids)
    deleting = true
    try {
      // Default: originals go to the OS recycle bin (Windows Recycle Bin / macOS Trash) as a last safety net.
      const removeFile = skipRecycleBin ? (p: string) => unlink(p) : (p: string) => shell.trashItem(p)
      await snapshotDatabase(library, 'before-delete') // catalogue copy before anything irreversible
      const result = await deletePermanently(library, targets, {
        removeFile,
        onProgress: (p) => getWindow()?.webContents.send('bin:progress', p)
      })
      changed('favorite')
      return result
    } finally {
      deleting = false
    }
  })
  ipcMain.handle('bin:forgetDeleted', () => forgetDeleted(lib()))
  ipcMain.handle('library:rotate', async (_e, ids: unknown, degrees: unknown) => {
    if (degrees !== 90 && degrees !== -90 && degrees !== 180) throw new Error('Invalid rotation')
    const changedIds = rotateAssets(lib(), idList(ids), degrees)
    for (const id of changedIds) await controller.thumbnails?.rerender(id)
    controller.hashes?.kick()
    changed('favorite')
  })
  let exporting = false
  ipcMain.handle('library:export', async (_e, ids: unknown) => {
    if (exporting) throw new Error('An export is already running.')
    const list = idList(ids)
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: tr(`Choose a folder to export ${list.length} item${list.length === 1 ? '' : 's'} to`, `Escolha uma pasta para exportar ${list.length} ${list.length === 1 ? 'item' : 'itens'}`),
      properties: ['openDirectory', 'createDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    exporting = true
    try {
      const result = await exportOriginals(lib(), list, r.filePaths[0], { onProgress: (p) => getWindow()?.webContents.send('export:progress', p) })
      if (result.exported > 0) void shell.openPath(result.folder)
      return result
    } finally {
      exporting = false
    }
  })
  ipcMain.handle('library:hide', (_e, ids: unknown, hidden: unknown) => {
    setHidden(lib(), idList(ids), hidden === true)
    changed('favorite')
  })
  ipcMain.handle('library:hideByQuery', (_e, q: unknown, hidden: unknown) => {
    const n = setHiddenByQuery(lib(), query(q) ?? {}, hidden === true)
    lib().logger.info('assets.hidden_by_query', { query: q, hidden: hidden === true, count: n })
    changed('favorite')
    return n
  })
  ipcMain.handle('library:nearDuplicates', async (_e, offset: unknown, limit: unknown) => {
    await controller.ensureNearDuplicateGroups()
    return nearDuplicates(lib(), int(offset, 'offset'), int(limit, 'limit', 1))
  })
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:setToken', (_e, token: unknown) => setUpdateToken(typeof token === 'string' && token.trim() ? token.trim().slice(0, 300) : null))
  ipcMain.handle('update:install', () => installUpdateNow())
  ipcMain.handle('memories:list', () => memories(lib(), new Date(), languageOf(settings)))
  ipcMain.handle('share:prepare', async (_e, ids: unknown, opts: unknown) => {
    const o = (opts ?? {}) as { size?: unknown; includeDate?: unknown }
    const size = o.size === 'original' || o.size === 'small' ? o.size : 'large'
    const r = await prepareShare(lib(), idList(ids), { size, includeDate: o.includeDate !== false })
    if (r.files > 0) void shell.openPath(r.folder)
    return r
  })
  const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : [])
  ipcMain.handle('tags:set', (_e, ids: unknown, add: unknown, remove: unknown) => {
    setTags(lib(), idList(ids), strList(add), strList(remove))
    changed('albums')
  })
  ipcMain.handle('tags:all', () => allTags(lib()))
  ipcMain.handle('asset:setDescription', (_e, id: unknown, text: unknown) => {
    setDescription(lib(), int(id, 'id', 1), typeof text === 'string' ? text : null)
    changed('albums')
  })
  ipcMain.handle('asset:setLocation', (_e, ids: unknown, loc: unknown) => {
    const l = loc as { lat?: unknown; lon?: unknown } | null
    setLocation(lib(), idList(ids), l && typeof l.lat === 'number' && typeof l.lon === 'number' ? { lat: l.lat, lon: l.lon } : null)
    fillPlaces(lib())
    changed('albums')
  })
  ipcMain.handle('smart:list', () => smartAlbums(lib()))
  ipcMain.handle('smart:create', (_e, name: unknown, q: unknown) => {
    const r = createSmartAlbum(lib(), str(name, 'name'), query(q) ?? {})
    changed('albums')
    return r
  })
  ipcMain.handle('smart:update', (_e, id: unknown, patch: unknown) => {
    const p = (patch ?? {}) as { name?: unknown; query?: unknown }
    updateSmartAlbum(lib(), int(id, 'id', 1), { name: typeof p.name === 'string' ? p.name : undefined, query: p.query ? query(p.query) : undefined })
    changed('albums')
  })
  ipcMain.handle('smart:delete', (_e, id: unknown) => {
    deleteSmartAlbum(lib(), int(id, 'id', 1))
    changed('albums')
  })
  ipcMain.handle('faces:ofAsset', (_e, id: unknown) => assetFaces(lib(), int(id, 'id', 1)))
  ipcMain.handle('faces:add', async (_e, id: unknown, box: unknown) => {
    const b = (box ?? {}) as Record<string, unknown>
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
    const clean = { x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h) }
    if (clean.w < 0.005 || clean.h < 0.005) throw new Error('Draw a box around the face.')
    if (!controller.people) throw new Error('No library is open.')
    const assetId = int(id, 'id', 1)
    const faceId = await controller.people.addFace(assetId, clean)
    changed('albums')
    return assetFaces(lib(), assetId).find((f) => f.id === faceId)
  })
  ipcMain.handle('faces:delete', (_e, faceId: unknown) => {
    deleteFace(lib(), int(faceId, 'face', 1))
    changed('albums')
  })
  ipcMain.handle('people:status', () => controller.people?.get() ?? null)
  ipcMain.handle('people:enable', (_e, on: unknown) => controller.people?.enable(on === true))
  ipcMain.handle('people:clear', () => controller.people?.clear())
  ipcMain.handle('people:list', () => listPeople(lib()))
  ipcMain.handle('people:get', (_e, id: unknown) => getPerson(lib(), int(id, 'id', 1)))
  ipcMain.handle('people:rename', (_e, id: unknown, name: unknown) => {
    const r = renamePerson(lib(), int(id, 'id', 1), typeof name === 'string' ? name : null)
    changed('albums')
    return r
  })
  ipcMain.handle('people:merge', (_e, target: unknown, sources: unknown) => {
    mergePeople(lib(), int(target, 'target', 1), idList(sources))
    changed('albums')
  })
  ipcMain.handle('people:hide', (_e, id: unknown, hidden: unknown) => {
    setPersonHidden(lib(), int(id, 'id', 1), hidden === true)
    changed('albums')
  })
  ipcMain.handle('people:suggestions', () => peopleSuggestions(lib()))
  ipcMain.handle('people:different', (_e, a: unknown, b: unknown) => {
    markDifferentPeople(lib(), int(a, 'a', 1), int(b, 'b', 1))
  })
  ipcMain.handle('people:merges', (_e, id: unknown) => personMerges(lib(), int(id, 'id', 1)))
  ipcMain.handle('people:undoMerge', (_e, id: unknown) => {
    const r = undoMerge(lib(), int(id, 'id', 1))
    changed('albums')
    return r
  })
  ipcMain.handle('people:faces', (_e, id: unknown) => personFaces(lib(), int(id, 'id', 1)))
  ipcMain.handle('people:moveFaces', (_e, ids: unknown, target: unknown) => {
    const t = target as { personId?: unknown; newName?: unknown } | null
    const dest =
      t && typeof t.personId === 'number'
        ? { personId: int(t.personId, 'person', 1) }
        : t && 'newName' in t
          ? { newName: typeof t.newName === 'string' ? t.newName.slice(0, 100) : null }
          : null
    const r = moveFaces(lib(), idList(ids), dest)
    changed('albums')
    return r
  })
  ipcMain.handle('people:remove', (_e, id: unknown, assetIds: unknown) => {
    const n = removeFromPerson(lib(), int(id, 'id', 1), idList(assetIds))
    changed('albums')
    return n
  })
  ipcMain.handle('captions:status', () => controller.captions?.get() ?? null)
  ipcMain.handle('captions:enable', (_e, on: unknown) => controller.captions?.enable(on === true))
  ipcMain.handle('smart:pets', () => controller.smart?.pets() ?? [])
  ipcMain.handle('smart:status', () => controller.smart?.get() ?? null)
  ipcMain.handle('smart:enable', (_e, on: unknown) => controller.smart?.enable(on === true))
  ipcMain.handle('smart:search', async (_e, text: unknown) => {
    const t = str(text, 'text').trim().slice(0, 300)
    if (!t || !controller.smart) return []
    return (await controller.smart.search(t)).map((r) => r.id)
  })
  ipcMain.handle('watch:list', () => controller.watch?.list() ?? [])
  ipcMain.handle('watch:add', async () => {
    lib()
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = { title: tr('Choose a folder to watch for new photos', 'Escolha uma pasta a vigiar para novas fotografias'), properties: ['openDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return controller.watch!.add(r.filePaths[0])
  })
  ipcMain.handle('watch:remove', (_e, id: unknown) => controller.watch?.remove(int(id, 'id', 1)))
  ipcMain.handle('watch:setEnabled', (_e, id: unknown, enabled: unknown) => controller.watch?.setEnabled(int(id, 'id', 1), enabled === true))
  ipcMain.handle('watch:check', () => controller.watch?.checkAll())
  ipcMain.handle('library:mapClusters', (_e, v: unknown, q: unknown) => {
    const o = (v ?? {}) as Record<string, unknown>
    const num = (x: unknown, name: string): number => {
      if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`Invalid ${name}`)
      return x
    }
    const view = { south: num(o.south, 'south'), west: num(o.west, 'west'), north: num(o.north, 'north'), east: num(o.east, 'east'), zoom: num(o.zoom, 'zoom') }
    return mapClusters(lib(), view, query(q))
  })
  ipcMain.handle('library:similarPhotos', (_e, offset: unknown, limit: unknown) => similarPhotos(lib(), int(offset, 'offset'), int(limit, 'limit', 1)))
  ipcMain.handle('library:dismissNearDuplicates', (_e, ids: unknown) => {
    dismissNearDuplicates(lib(), idList(ids))
    changed('favorite')
  })
  ipcMain.handle('library:hideAllNearDuplicateExtras', async () => {
    await controller.ensureNearDuplicateGroups()
    const n = hideAllNearDuplicateExtras(lib())
    lib().logger.info('near_duplicates.hide_all_extras', { hidden: n })
    changed('favorite')
    return n
  })
  ipcMain.handle('albums:list', () => listAlbums(lib()))
  ipcMain.handle('albums:get', (_e, id: unknown) => getAlbum(lib(), int(id, 'id', 1)))
  ipcMain.handle('albums:create', (_e, name: unknown, ids: unknown) => {
    const a = createAlbum(lib(), str(name, 'name'), idList(ids))
    changed('albums')
    return a
  })
  ipcMain.handle('albums:update', (_e, id: unknown, patch: unknown) => {
    const p = (patch ?? {}) as { name?: unknown; description?: unknown; coverAssetId?: unknown }
    const a = updateAlbum(lib(), int(id, 'id', 1), {
      name: p.name === undefined ? undefined : str(p.name, 'name'),
      description: p.description === undefined ? undefined : p.description === null ? null : String(p.description).slice(0, 4000),
      coverAssetId: p.coverAssetId === undefined ? undefined : p.coverAssetId === null ? null : int(p.coverAssetId, 'cover', 1)
    })
    changed('albums')
    return a
  })
  ipcMain.handle('albums:delete', (_e, id: unknown) => {
    deleteAlbum(lib(), int(id, 'id', 1))
    changed('albums')
  })
  ipcMain.handle('albums:add', (_e, id: unknown, ids: unknown) => {
    const n = addAssets(lib(), int(id, 'id', 1), idList(ids))
    changed('albums')
    return n
  })
  ipcMain.handle('albums:remove', (_e, id: unknown, ids: unknown) => {
    const n = removeAssets(lib(), int(id, 'id', 1), idList(ids))
    changed('albums')
    return n
  })
  ipcMain.handle('library:asset', (_e, id: unknown) => assetDetail(lib(), int(id, 'id', 1)))
  ipcMain.handle('library:favorite', (_e, id: unknown, fav: unknown) => {
    setFavorite(lib(), int(id, 'id', 1), fav === true)
    changed('favorite')
  })
  ipcMain.handle('library:showInFolder', (_e, id: unknown) => {
    const src = originalPathFor(lib(), int(id, 'id', 1))
    if (src) shell.showItemInFolder(src.absolutePath)
  })
  ipcMain.handle('library:openFolder', () => shell.openPath(lib().root))

  // --- Viewer context menu ------------------------------------------------------------------
  const assetSource = (id: unknown): { absolutePath: string; mime: string; rotation: number; name: string } => {
    const assetId = int(id, 'id', 1)
    const src = originalPathFor(lib(), assetId)
    const name = lib().db.get<{ original_filename: string }>('SELECT original_filename FROM assets WHERE id = ?', [assetId])?.original_filename
    if (!src || !name) throw new Error('This item has no original file in the library.')
    return { ...src, name }
  }
  /** Copies the picture itself (as you see it, rotation included) to the clipboard. */
  ipcMain.handle('asset:copyImage', async (_e, id: unknown) => {
    const src = assetSource(id)
    // PNG of the picture as shown: EXIF-oriented, user rotation applied, at most 4096 px (HEIC/WebP included).
    let pipeline = sharp(src.absolutePath, { failOn: 'none' }).rotate().resize(4096, 4096, { fit: 'inside', withoutEnlargement: true })
    if (src.rotation) pipeline = sharp(await pipeline.png().toBuffer()).rotate(src.rotation)
    const png = await pipeline.png({ compressionLevel: 3 }).toBuffer()
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  })
  /** Copies the file, so it can be pasted into Explorer or a chat as a file (a copy; the original stays). */
  ipcMain.handle('asset:copyFile', async (_e, id: unknown) => {
    const src = assetSource(id)
    if (process.platform !== 'win32') return clipboard.writeText(src.absolutePath)
    // Windows file-drop format: pasting in Explorer or a chat inserts a copy of the file.
    const format = 'electron application/osclipboard;format="FileNameW"'
    await clipboard.write([new ClipboardItem({ [format]: new Blob([new Uint8Array(Buffer.from(`${src.absolutePath}\0`, 'ucs2'))]) })])
  })
  ipcMain.handle('edit:state', (_e, id: unknown) => editState(lib(), int(id, 'id', 1)))
  ipcMain.handle('edit:preview', (_e, id: unknown, rotation: unknown, edits: unknown, opts: unknown) => {
    const o = (opts ?? {}) as { skipCrop?: unknown; size?: unknown }
    return editPreview(lib(), int(id, 'id', 1), typeof rotation === 'number' ? rotation : 0, edits, {
      skipCrop: o.skipCrop === true,
      size: typeof o.size === 'number' ? o.size : undefined
    })
  })
  ipcMain.handle('edit:save', async (_e, id: unknown, rotation: unknown, edits: unknown) => {
    const assetId = int(id, 'id', 1)
    saveEdits(lib(), assetId, typeof rotation === 'number' ? rotation : 0, edits)
    await controller.thumbnails?.rerender(assetId)
    controller.hashes?.kick()
    changed('favorite')
  })
  ipcMain.handle('edit:saveCopy', async (_e, id: unknown) => {
    const { jpeg, name } = await renderEdited(lib(), int(id, 'id', 1))
    const win = getWindow()
    const opts: Electron.SaveDialogOptions = { title: tr('Save edited copy', 'Guardar cópia editada'), defaultPath: name, filters: [{ name: 'JPEG', extensions: ['jpg'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, jpeg)
    return true
  })
  ipcMain.handle('video:prepare', async (_e, id: unknown) => {
    const assetId = int(id, 'id', 1)
    let last = 0
    await playableVideo(lib(), assetId, (fraction) => {
      if (fraction - last >= 0.02 || fraction === 1) {
        last = fraction
        getWindow()?.webContents.send('video:progress', { assetId, fraction })
      }
    })
  })
  ipcMain.handle('asset:copyPath', (_e, id: unknown) => clipboard.writeText(assetSource(id).absolutePath))
  /** Opens a temporary COPY in the default app, so editing there can never change the archived original. */
  ipcMain.handle('asset:openExternal', async (_e, id: unknown) => {
    const src = assetSource(id)
    const dir = joinPath(tmpdir(), 'Photo Vault', String(Date.now()))
    await mkdir(dir, { recursive: true })
    const copy = joinPath(dir, src.name.replace(/[<>:"/\\|?*]/g, '_'))
    await copyFile(src.absolutePath, copy)
    const err = await shell.openPath(copy)
    if (err) throw new Error(err)
  })
  /** "Save a copy as…": the original file, byte for byte, wherever the user chooses. */
  ipcMain.handle('asset:saveCopy', async (_e, id: unknown) => {
    const src = assetSource(id)
    const win = getWindow()
    const opts: Electron.SaveDialogOptions = { title: tr('Save a copy', 'Guardar uma cópia'), defaultPath: src.name }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return false
    await copyFile(src.absolutePath, r.filePath)
    return true
  })
  ipcMain.handle('library:duplicates', (_e, offset: unknown, limit: unknown) => duplicateGroups(lib(), int(offset, 'offset'), int(limit, 'limit', 1)))

  ipcMain.handle('import:chooseSources', async (_e, kind: unknown) => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions =
      kind === 'zip'
        ? {
            title: tr('Choose ZIP archives to import (e.g. Google Takeout)', 'Escolha arquivos ZIP para importar (p. ex. Google Takeout)'),
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'ZIP archives', extensions: ['zip'] }]
          }
        : { title: tr('Choose a folder of photos to import', 'Escolha uma pasta de fotografias para importar'), properties: ['openDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths
  })
  ipcMain.handle('phone:list', () => listPhones())
  ipcMain.handle('phone:copy', (e, device: unknown) => copyPhone(lib().root, str(device, 'device'), (p) => e.sender.send('phone:progress', p)))
  ipcMain.handle('phone:cancel', () => cancelPhoneCopy())
  ipcMain.handle('import:start', (_e, sources: unknown) => {
    lib()
    if (!Array.isArray(sources) || sources.length === 0 || sources.length > 500) throw new Error('Invalid sources')
    return controller.imports!.start(sources.map((p, i) => str(p, `source ${i}`)))
  })
  ipcMain.handle('import:resume', (_e, id: unknown) => {
    lib()
    return controller.imports!.resume(int(id, 'id', 1))
  })
  ipcMain.handle('import:commit', (_e, id: unknown) => controller.imports?.commit(int(id, 'id', 1)))
  ipcMain.handle('import:cancel', (_e, id: unknown) => controller.imports?.cancel(int(id, 'id', 1)))
  ipcMain.handle('import:dismiss', (_e, id: unknown) => controller.imports?.dismiss(int(id, 'id', 1)))
  ipcMain.handle('import:current', () => controller.imports?.current() ?? null)
  ipcMain.handle('import:list', () => listImports(lib()))
  ipcMain.handle('import:items', (_e, id: unknown, cls: unknown, offset: unknown, limit: unknown) => {
    if (typeof cls !== 'string' || !CLASSIFICATIONS.has(cls as ItemClassification)) throw new Error('Invalid classification')
    return importItems(lib(), int(id, 'id', 1), cls as ItemClassification | 'all', int(offset, 'offset'), int(limit, 'limit', 1))
  })

  ipcMain.handle('verify:start', () => {
    lib()
    return controller.verify!.start()
  })
  ipcMain.handle('verify:cancel', () => controller.verify?.cancel())
  ipcMain.handle('verify:current', () => controller.verify?.current() ?? null)
  ipcMain.handle('verify:issues', (_e, offset: unknown, limit: unknown) => verifyIssues(lib(), int(offset, 'offset'), int(limit, 'limit', 1)))

  ipcMain.handle('backup:status', () => {
    lib()
    return controller.backups!.status()
  })
  ipcMain.handle('backup:add', async () => {
    const backups = controller.backups
    if (!backups) throw new Error('No library is open.')
    const win = getWindow()
    const opts = {
      title: tr('Choose a backup location (ideally another drive)', 'Escolha um local de cópia (de preferência noutro disco)'),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'] as Array<'openDirectory' | 'createDirectory' | 'promptToCreate'>
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const target = backups.addTarget(r.filePaths[0])
    void backups.run(target.id).catch(() => undefined)
    return target
  })
  ipcMain.handle('backup:remove', (_e, id: unknown) => controller.backups?.removeTarget(int(id, 'id', 1)))
  ipcMain.handle('backup:label', (_e, id: unknown, label: unknown) => controller.backups?.setLabel(int(id, 'id', 1), typeof label === 'string' ? label : null))
  ipcMain.handle('db:restoreSnapshot', (_e, name: unknown) => {
    controller.restoreSnapshot(str(name, 'snapshot'))
    changed('opened')
  })
  ipcMain.handle('backup:auto', (_e, id: unknown, auto: unknown) => controller.backups?.setAuto(int(id, 'id', 1), auto === true))
  ipcMain.handle('backup:run', (_e, id: unknown, verifyAll: unknown) => {
    lib()
    return controller.backups!.run(int(id, 'id', 1), { verifyAll: verifyAll === true })
  })
  ipcMain.handle('backup:cancel', () => controller.backups?.cancel())
  ipcMain.handle('backup:current', () => controller.backups?.current() ?? null)
  ipcMain.handle('db:snapshots', () => listSnapshots(lib()))
  ipcMain.handle('db:snapshotNow', async () => {
    await snapshotDatabase(lib(), 'manual')
  })
  ipcMain.handle('db:openSnapshots', () => shell.openPath(snapshotDir(lib())))

  ipcMain.handle('settings:get', (): Settings => ({ theme: settings.theme, language: languageOf(settings) }))
  ipcMain.handle('settings:set', (_e, patch: unknown): Settings => {
    const p = (patch ?? {}) as Partial<Settings>
    if (p.theme === 'system' || p.theme === 'light' || p.theme === 'dark') settings = { ...settings, theme: p.theme }
    if (p.language === 'en' || p.language === 'pt') settings = { ...settings, language: p.language }
    saveSettings(settings)
    applyTheme(settings)
    return { theme: settings.theme, language: languageOf(settings) }
  })

  nativeTheme.on('updated', () => applyTheme(settings))
}
