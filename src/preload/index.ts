import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BackupProgress, BinDeleteProgress, ExportProgress, ImportProgress, PeopleStatus, SmartSearchStatus, UpdateStatus, PhoneCopyProgress, CaptionStatus, LibraryChangeReason, PhotoVaultApi, VerifyProgress } from '@shared/types'

// The only surface the renderer gets: typed calls into the main process. No Node, no fs.
const api: PhotoVaultApi = {
  getState: () => ipcRenderer.invoke('app:state'),
  createLibrary: () => ipcRenderer.invoke('library:create'),
  openLibrary: () => ipcRenderer.invoke('library:open'),
  timeline: (query) => ipcRenderer.invoke('library:timeline', query),
  assetsPage: (offset, limit, query) => ipcRenderer.invoke('library:page', offset, limit, query),
  facets: (base) => ipcRenderer.invoke('library:facets', base),
  asset: (id) => ipcRenderer.invoke('library:asset', id),
  setFavorite: (id, favorite) => ipcRenderer.invoke('library:favorite', id, favorite),
  setFavorites: (ids, favorite) => ipcRenderer.invoke('library:favorites', ids, favorite),
  setHidden: (ids, hidden) => ipcRenderer.invoke('library:hide', ids, hidden),
  setDates: (ids, wall) => ipcRenderer.invoke('library:setDates', ids, wall),
  memories: () => ipcRenderer.invoke('memories:list'),
  share: (ids, opts) => ipcRenderer.invoke('share:prepare', ids, opts),
  setTags: (ids, add, remove) => ipcRenderer.invoke('tags:set', ids, add, remove),
  allTags: () => ipcRenderer.invoke('tags:all'),
  setDescription: (id, text) => ipcRenderer.invoke('asset:setDescription', id, text),
  setLocation: (ids, loc) => ipcRenderer.invoke('asset:setLocation', ids, loc),
  smartAlbums: () => ipcRenderer.invoke('smart:list'),
  createSmartAlbum: (name, q) => ipcRenderer.invoke('smart:create', name, q),
  updateSmartAlbum: (id, patch) => ipcRenderer.invoke('smart:update', id, patch),
  deleteSmartAlbum: (id) => ipcRenderer.invoke('smart:delete', id),
  assetFaces: (id) => ipcRenderer.invoke('faces:ofAsset', id),
  addFace: (id, box) => ipcRenderer.invoke('faces:add', id, box),
  deleteFace: (id) => ipcRenderer.invoke('faces:delete', id),
  peopleStatus: () => ipcRenderer.invoke('people:status'),
  setPeopleEnabled: (enabled) => ipcRenderer.invoke('people:enable', enabled),
  clearPeople: () => ipcRenderer.invoke('people:clear'),
  people: () => ipcRenderer.invoke('people:list'),
  person: (id) => ipcRenderer.invoke('people:get', id),
  renamePerson: (id, name) => ipcRenderer.invoke('people:rename', id, name),
  mergePeople: (target, sources) => ipcRenderer.invoke('people:merge', target, sources),
  setPersonHidden: (id, hidden) => ipcRenderer.invoke('people:hide', id, hidden),
  peopleSuggestions: () => ipcRenderer.invoke('people:suggestions'),
  markDifferentPeople: (a, b) => ipcRenderer.invoke('people:different', a, b),
  personMerges: (id) => ipcRenderer.invoke('people:merges', id),
  undoMerge: (id) => ipcRenderer.invoke('people:undoMerge', id),
  personFaces: (id) => ipcRenderer.invoke('people:faces', id),
  moveFaces: (ids, target) => ipcRenderer.invoke('people:moveFaces', ids, target),
  removeFromPerson: (id, assetIds) => ipcRenderer.invoke('people:remove', id, assetIds),
  onPeopleStatus: (cb) => {
    const listener = (_e: unknown, s: PeopleStatus): void => cb(s)
    ipcRenderer.on('people:status', listener)
    return () => ipcRenderer.removeListener('people:status', listener)
  },
  editState: (id) => ipcRenderer.invoke('edit:state', id),
  editPreview: (id, rotation, edits, opts) => ipcRenderer.invoke('edit:preview', id, rotation, edits, opts),
  saveEdits: (id, rotation, edits) => ipcRenderer.invoke('edit:save', id, rotation, edits),
  saveEditedCopy: (id) => ipcRenderer.invoke('edit:saveCopy', id),
  prepareVideo: (id) => ipcRenderer.invoke('video:prepare', id),
  onVideoProgress: (cb) => {
    const listener = (_e: unknown, p: { assetId: number; fraction: number }): void => cb(p)
    ipcRenderer.on('video:progress', listener)
    return () => ipcRenderer.removeListener('video:progress', listener)
  },
  copyImage: (id) => ipcRenderer.invoke('asset:copyImage', id),
  copyFile: (id) => ipcRenderer.invoke('asset:copyFile', id),
  copyPath: (id) => ipcRenderer.invoke('asset:copyPath', id),
  openExternal: (id) => ipcRenderer.invoke('asset:openExternal', id),
  saveCopy: (id) => ipcRenderer.invoke('asset:saveCopy', id),
  setBackupLabel: (id, label) => ipcRenderer.invoke('backup:label', id, label),
  restoreSnapshot: (name) => ipcRenderer.invoke('db:restoreSnapshot', name),
  listPhones: () => ipcRenderer.invoke('phone:list'),
  copyFromPhone: (device) => ipcRenderer.invoke('phone:copy', device),
  cancelPhoneCopy: () => ipcRenderer.invoke('phone:cancel'),
  onPhoneProgress: (cb) => {
    const listener = (_e: unknown, p: PhoneCopyProgress): void => cb(p)
    ipcRenderer.on('phone:progress', listener)
    return () => ipcRenderer.removeListener('phone:progress', listener)
  },
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  setUpdateToken: (token) => ipcRenderer.invoke('update:setToken', token),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => {
    const listener = (_e: unknown, s: UpdateStatus): void => cb(s)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  pets: () => ipcRenderer.invoke('smart:pets'),
  models: () => ipcRenderer.invoke('models:list'),
  importModels: () => ipcRenderer.invoke('models:import'),
  exportModels: () => ipcRenderer.invoke('models:export'),
  captionStatus: () => ipcRenderer.invoke('captions:status'),
  setCaptionsEnabled: (on) => ipcRenderer.invoke('captions:enable', on),
  onCaptionStatus: (cb) => {
    const listener = (_e: unknown, s: CaptionStatus): void => cb(s)
    ipcRenderer.on('captions:status', listener)
    return () => ipcRenderer.removeListener('captions:status', listener)
  },
  smartSearchStatus: () => ipcRenderer.invoke('smart:status'),
  setSmartSearch: (enabled) => ipcRenderer.invoke('smart:enable', enabled),
  smartSearch: (text) => ipcRenderer.invoke('smart:search', text),
  onSmartSearchStatus: (cb) => {
    const listener = (_e: unknown, s: SmartSearchStatus): void => cb(s)
    ipcRenderer.on('smart:status', listener)
    return () => ipcRenderer.removeListener('smart:status', listener)
  },
  watchFolders: () => ipcRenderer.invoke('watch:list'),
  addWatchFolder: () => ipcRenderer.invoke('watch:add'),
  removeWatchFolder: (id) => ipcRenderer.invoke('watch:remove', id),
  setWatchFolderEnabled: (id, enabled) => ipcRenderer.invoke('watch:setEnabled', id, enabled),
  checkWatchFolders: () => ipcRenderer.invoke('watch:check'),
  mapPlaces: (view, minPopulation) => ipcRenderer.invoke('geo:places', view, minPopulation),
  mapClusters: (view, query) => ipcRenderer.invoke('library:mapClusters', view, query),
  libraryPlaces: () => ipcRenderer.invoke('library:places'),
  rotate: (ids, degrees) => ipcRenderer.invoke('library:rotate', ids, degrees),
  exportOriginals: (ids) => ipcRenderer.invoke('library:export', ids),
  photoBook: (ids, title, layout) => ipcRenderer.invoke('library:photoBook', ids, title, layout),
  exportWebGallery: (ids, title, description) => ipcRenderer.invoke('library:exportWeb', ids, title, description),
  onExportProgress: (cb) => {
    const listener = (_e: unknown, p: ExportProgress): void => cb(p)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  moveToBin: (ids) => ipcRenderer.invoke('bin:move', ids),
  restoreFromBin: (ids) => ipcRenderer.invoke('bin:restore', ids),
  deleteFromBin: (ids, opts) => ipcRenderer.invoke('bin:delete', ids, opts),
  forgetDeleted: () => ipcRenderer.invoke('bin:forgetDeleted'),
  assetIdsInRange: (query, offset, limit) => ipcRenderer.invoke('library:idsInRange', query, offset, limit),
  setHiddenByQuery: (query, hidden) => ipcRenderer.invoke('library:hideByQuery', query, hidden),
  albums: () => ipcRenderer.invoke('albums:list'),
  album: (id) => ipcRenderer.invoke('albums:get', id),
  createAlbum: (name, ids) => ipcRenderer.invoke('albums:create', name, ids),
  updateAlbum: (id, patch) => ipcRenderer.invoke('albums:update', id, patch),
  deleteAlbum: (id) => ipcRenderer.invoke('albums:delete', id),
  addToAlbum: (id, ids) => ipcRenderer.invoke('albums:add', id, ids),
  removeFromAlbum: (id, ids) => ipcRenderer.invoke('albums:remove', id, ids),
  showInFolder: (id) => ipcRenderer.invoke('library:showInFolder', id),
  openLibraryFolder: () => ipcRenderer.invoke('library:openFolder'),

  chooseImportSources: (kind) => ipcRenderer.invoke('import:chooseSources', kind),
  startImport: (sources) => ipcRenderer.invoke('import:start', sources),
  resumeImport: (id) => ipcRenderer.invoke('import:resume', id),
  commitImport: (id) => ipcRenderer.invoke('import:commit', id),
  cancelImport: (id) => ipcRenderer.invoke('import:cancel', id),
  dismissImport: (id) => ipcRenderer.invoke('import:dismiss', id),
  currentImport: () => ipcRenderer.invoke('import:current'),
  imports: () => ipcRenderer.invoke('import:list'),
  importItems: (id, cls, offset, limit) => ipcRenderer.invoke('import:items', id, cls, offset, limit),
  duplicates: (offset, limit) => ipcRenderer.invoke('library:duplicates', offset, limit),
  nearDuplicates: (offset, limit) => ipcRenderer.invoke('library:nearDuplicates', offset, limit),
  similarPhotos: (offset, limit) => ipcRenderer.invoke('library:similarPhotos', offset, limit),
  dismissNearDuplicates: (ids) => ipcRenderer.invoke('library:dismissNearDuplicates', ids),
  hideAllNearDuplicateExtras: () => ipcRenderer.invoke('library:hideAllNearDuplicateExtras'),

  startVerify: () => ipcRenderer.invoke('verify:start'),
  cancelVerify: () => ipcRenderer.invoke('verify:cancel'),
  currentVerify: () => ipcRenderer.invoke('verify:current'),
  verifyIssues: (offset, limit) => ipcRenderer.invoke('verify:issues', offset, limit),

  backupStatus: () => ipcRenderer.invoke('backup:status'),
  addBackupTarget: () => ipcRenderer.invoke('backup:add'),
  removeBackupTarget: (id) => ipcRenderer.invoke('backup:remove', id),
  setBackupAuto: (id, auto) => ipcRenderer.invoke('backup:auto', id, auto),
  runBackup: (id, verifyAll) => ipcRenderer.invoke('backup:run', id, verifyAll),
  cancelBackup: () => ipcRenderer.invoke('backup:cancel'),
  currentBackup: () => ipcRenderer.invoke('backup:current'),
  onBackupProgress: (cb) => {
    const listener = (_e: unknown, p: BackupProgress): void => cb(p)
    ipcRenderer.on('backup:progress', listener)
    return () => ipcRenderer.removeListener('backup:progress', listener)
  },
  dbSnapshots: () => ipcRenderer.invoke('db:snapshots'),
  snapshotNow: () => ipcRenderer.invoke('db:snapshotNow'),
  openSnapshotsFolder: () => ipcRenderer.invoke('db:openSnapshots'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  pathForFile: (file) => webUtils.getPathForFile(file),
  onImportProgress: (cb) => {
    const listener = (_e: unknown, p: ImportProgress): void => cb(p)
    ipcRenderer.on('import:progress', listener)
    return () => ipcRenderer.removeListener('import:progress', listener)
  },
  onLibraryChanged: (cb) => {
    const listener = (_e: unknown, reason: LibraryChangeReason): void => cb(reason)
    ipcRenderer.on('library:changed', listener)
    return () => ipcRenderer.removeListener('library:changed', listener)
  },
  onBinProgress: (cb) => {
    const listener = (_e: unknown, p: BinDeleteProgress): void => cb(p)
    ipcRenderer.on('bin:progress', listener)
    return () => ipcRenderer.removeListener('bin:progress', listener)
  },
  onVerifyProgress: (cb) => {
    const listener = (_e: unknown, p: VerifyProgress): void => cb(p)
    ipcRenderer.on('verify:progress', listener)
    return () => ipcRenderer.removeListener('verify:progress', listener)
  }
}

contextBridge.exposeInMainWorld('photoVault', api)
