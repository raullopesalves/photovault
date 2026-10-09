// Types shared by the main process, preload bridge and renderer.
// Everything here must be plain serialisable data (it crosses the IPC boundary).

export type MediaType = 'photo' | 'video'

export type CaptureTimeSource =
  | 'exif_original'
  | 'exif_digitized'
  | 'xmp'
  | 'takeout'
  | 'icloud'
  | 'quicktime'
  | 'filename'
  | 'exif_modified'
  /** Interpolated from neighbouring files (Android media ids). */
  | 'estimated'
  /** Borrowed from a visually identical copy that records its date. */
  | 'duplicate'
  /** Set by the user. */
  | 'manual'

/** Where the timeline position of an asset came from when no trustworthy capture time exists. */
export type SortTimeSource = CaptureTimeSource | 'file_modified'

export type ThumbStatus = 'pending' | 'ready' | 'failed'

/** Where an item came from, as far as Photo Vault can tell (see classify.ts for the rules). */
export type AssetOrigin =
  | 'camera'
  | 'whatsapp'
  | 'telegram'
  | 'signal'
  | 'messenger'
  | 'snapchat'
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'twitter'
  | 'screenshot'
  | 'screen_recording'
  | 'download'
  | 'shared'
  /** Probable, not certain: no camera data at all and no other clue. */
  | 'received'

/** What kind of item it is. 'loop' = short silent video (how chat apps store GIFs). */
export type AssetKind = 'photo' | 'video' | 'loop' | 'animated' | 'sticker'

export interface LibraryInfo {
  path: string
  assetCount: number
  photoCount: number
  videoCount: number
  totalBytes: number
  pendingThumbnails: number
  hiddenCount: number
  binCount: number
  binBytes: number
  /** Content the user deleted permanently; re-imports of it are skipped. */
  deletedCount: number
  /** Items without a verified copy in any backup location (all of them when no backup is set up). */
  unprotectedCount: number
}

export type AppState =
  | { kind: 'no-library'; error?: string }
  | { kind: 'ready'; library: LibraryInfo }

export interface TimelineGroup {
  /** Group key: YYYY-MM (wall-clock month taken), 'undated' (the "No date" section, always last), or YYYY-MM-DD (import day, when sorted by Recently added). */
  month: string
  count: number
}

export interface AssetSummary {
  id: number
  mediaType: MediaType
  mimeType: string
  width: number | null
  height: number | null
  durationMs: number | null
  /** Wall-clock time (ms, encoded as if UTC) used for ordering. */
  sortTime: number
  captureKnown: boolean
  thumb: ThumbStatus
  favorite: boolean
  hidden: boolean
  /** In the Bin. */
  trashed: boolean
  /** Apple Live Photo: id of the attached motion clip. */
  liveVideoId: number | null
  /** User rotation in degrees clockwise (non-destructive; already applied to thumbnails/previews). */
  rotation: number
  /** Has non-destructive edits (crop, adjustments, filter). */
  edited: boolean
  /** Changes whenever the rendered look changes (rotation/edits): use it to refresh cached images. */
  rev: string
  kind: AssetKind | null
}

/** Filters for the timeline. All fields optional; combined with AND. */
export interface AssetQuery {
  text?: string
  mediaType?: MediaType
  favorite?: boolean
  year?: number
  cameraMake?: string | null
  cameraModel?: string
  sourceType?: string
  albumId?: number
  origin?: AssetOrigin | 'unknown'
  /** Sub-group of a probable origin; 'none' = no size clue. */
  originHint?: 'whatsapp_size' | 'social_size' | 'none'
  kind?: AssetKind
  /** Hidden items: shown by default; 'exclude' for the main timeline, 'only' for the Hidden group. */
  hidden?: 'exclude' | 'only'
  /** Items in the Bin are excluded everywhere unless this is 'only' (the Bin view). */
  trash?: 'only'
  /** Timeline order: by date taken (default) or by when items entered the library ("Recently added"). */
  sort?: 'taken' | 'added' | 'relevance'
  /** Only items with a location inside [south, west, north, east] (degrees; west > east crosses the antimeridian). */
  bbox?: [number, number, number, number]
  /** Only items with a location. */
  located?: boolean
  /** Only photos of this person. */
  personId?: number
  /** Only items with this tag. */
  tag?: string
  /** Only these items (smart search results). */
  ids?: number[]
  /** Display only: the smart search that produced `ids`. */
  smartText?: string

  /* Multi-select filters (the filter bar): any value within one filter matches (OR); filters combine with AND. */
  /** 'photo' / 'video' = any photo / video; 'loop' | 'animated' | 'sticker' = that kind. */
  types?: Array<MediaType | 'loop' | 'animated' | 'sticker'>
  years?: number[]
  cameras?: Array<{ make: string | null; model: string }>
  sourceTypes?: string[]
  origins?: Array<AssetOrigin | 'unknown'>
}

export interface Facets {
  years: Array<{ year: number; count: number }>
  cameras: Array<{ make: string | null; model: string; count: number }>
  sources: Array<{ type: string; count: number }>
  favorites: number
  videos: number
  origins: Array<{ origin: AssetOrigin | 'unknown'; count: number; hidden: number }>
  kinds: Array<{ kind: AssetKind; count: number; hidden: number }>
  /** Sub-groups of 'received' (probably received or saved) by size clue. */
  receivedHints: Array<{ hint: 'whatsapp_size' | 'social_size' | 'none'; count: number; hidden: number }>
  hidden: number
  /** Items still waiting to be labelled. */
  unclassified: number
}

export interface AlbumSummary {
  id: number
  name: string
  description: string | null
  /** 'takeout' albums were recreated from Google Takeout album folders. */
  kind: 'user' | 'takeout'
  count: number
  coverAssetId: number | null
  coverThumb: ThumbStatus | null
  updatedAt: string
}

export interface AssetFileInfo {
  id: number
  locationName: string
  relativePath: string
  absolutePath: string
  sizeBytes: number
  verifiedAt: string | null
}

export interface ProvenanceInfo {
  id: number
  sourceType: string
  sourceRoot: string
  sourcePath: string
  originalFilename: string
  sizeBytes: number
  fsCreatedAt: string | null
  fsModifiedAt: string | null
  firstImportId: number
  firstSeenAt: string
  lastSeenAt: string
  timesSeen: number
  /** ZIP archive the file was found in, if any. */
  containerPath: string | null
  /** Path of the export sidecar (e.g. Google Takeout JSON) matched to this file. */
  sidecarPath: string | null
  /** Takeout album folder title. */
  album: string | null
}

/** How the lightbox should display the asset at full size. */
export type FullView = 'original' | 'preview' | 'thumb' | 'video'

export interface AssetDetail extends AssetSummary {
  edits: PhotoEdits | null
  /** The user's keywords. */
  tags: string[]
  /** 'manual' when the user placed it on the map. */
  locationSource: string | null
  /** People recognised on this photo. */
  people: Array<{ id: number; name: string | null }>
  sha256: string
  sizeBytes: number
  originalFilename: string
  captureTime: string | null
  captureOffsetMinutes: number | null
  captureTimeSource: CaptureTimeSource | null
  sortTimeSource: SortTimeSource
  latitude: number | null
  longitude: number | null
  altitude: number | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  orientation: number | null
  importedAt: string
  description: string | null
  fullView: FullView
  exposure: Record<string, string>
  albums: Array<{ id: number; name: string }>
  /** Copies in backup locations. */
  backups: Array<{ path: string; status: string; verifiedAt: string | null }>
  /** Why an inferred or manual date was chosen. */
  dateEvidence: string[]
  origin: AssetOrigin | null
  originConfidence: 'certain' | 'probable' | null
  originEvidence: string[]
  kindEvidence: string[]
  hasAudio: boolean | null
  files: AssetFileInfo[]
  sources: ProvenanceInfo[]
}

export type ImportPhase =
  | 'scanning'
  | 'sidecars'
  | 'analyzing'
  | 'classifying'
  | 'ready'
  | 'importing'
  | 'linking'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface ImportSummary {
  importId: number
  /** 'watch' when a watched folder started it. */
  trigger: 'user' | 'watch'
  /** LOCAL_FOLDER, ZIP or GOOGLE_TAKEOUT. */
  sourceType: string
  sourcePath: string
  /** Every folder/ZIP selected for this import. */
  sources: string[]
  status: string
  startedAt: string
  completedAt: string | null
  filesScanned: number
  photosFound: number
  videosFound: number
  sidecarsFound: number
  ignoredFound: number
  archivesFound: number
  /** Media files paired with a Google Takeout JSON sidecar. */
  sidecarsMatched: number
  /** Unchanged files recognised from an earlier import without re-reading them. */
  hashesReused: number
  takeoutItems: number
  newAssets: number
  newPhotos: number
  newVideos: number
  /** Already in the library before this import. */
  duplicatesLibrary: number
  /** Repeated more than once inside this source. */
  duplicatesBatch: number
  /** Permanently deleted before; skipped. */
  deletedBefore: number
  unsupported: number
  errors: number
  bytesNew: number
  bytesDuplicate: number
  assetsCreated: number
  filesFailed: number
  /** Interrupted after analysis with work left: can be continued. */
  resumable: boolean
}

export interface ImportProgress {
  importId: number
  phase: ImportPhase
  sourcePath: string
  filesDiscovered: number
  photosFound: number
  videosFound: number
  sidecarsFound: number
  ignoredFound: number
  archivesFound: number
  sidecarsRead: number
  sidecarsMatched: number
  hashesReused: number
  analyzed: number
  analyzeTotal: number
  committed: number
  commitTotal: number
  bytesProcessed: number
  /** Bytes the importing phase will copy (known once analysis is done). */
  bytesTotal: number
  /** Estimated seconds left in the current phase; null when it can't be estimated honestly yet. */
  etaSeconds: number | null
  /** Recent throughput in `rateUnit` per second. */
  rate: number | null
  rateUnit: 'files' | 'bytes' | null
  /** Seconds since the current phase started. */
  elapsedSeconds: number
  currentFile: string | null
  summary: ImportSummary | null
  error: string | null
  trigger: 'user' | 'watch'
}

export interface WatchFolder {
  id: number
  path: string
  enabled: boolean
  /** False while the folder cannot be reached (e.g. an unplugged drive). */
  available: boolean
  lastCheckedAt: string | null
  lastImportId: number | null
  /** New items added by the last automatic import. */
  lastImported: number
  lastError: string | null
}

export type ItemClassification =
  | 'pending'
  | 'new'
  | 'duplicate_library'
  | 'duplicate_batch'
  /** Permanently deleted by the user before; not imported again. */
  | 'deleted_before'
  | 'unsupported'
  | 'error'

export type ItemOutcome = 'imported' | 'linked' | 'skipped' | 'failed'

export interface ImportItemInfo {
  id: number
  relativePath: string
  filename: string
  sizeBytes: number
  mediaType: MediaType | null
  classification: ItemClassification
  outcome: ItemOutcome | null
  sha256: string | null
  assetId: number | null
  error: string | null
  /** For duplicates: what the matching asset is called in the library. */
  matchFilename: string | null
  matchRelativePath: string | null
}

export interface DuplicateGroup {
  asset: AssetSummary
  sha256: string
  originalFilename: string
  sizeBytes: number
  sources: ProvenanceInfo[]
}

export interface VerifyProgress {
  id: number
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'
  startedAt: string
  completedAt: string | null
  filesTotal: number
  bytesTotal: number
  filesChecked: number
  bytesChecked: number
  ok: number
  missing: number
  mismatched: number
  error: string | null
  etaSeconds?: number | null
  rate?: number | null
}

export interface VerifyIssue {
  fileId: number
  assetId: number
  relativePath: string
  status: 'missing' | 'mismatch'
  expectedSha256: string
  missingSince: string | null
}

export interface NearDuplicateMember {
  asset: AssetSummary
  sizeBytes: number
  originalFilename: string
  camera: string | null
  origin: AssetOrigin | null
  originConfidence: 'certain' | 'probable' | null
}

/** Copies that look the same but are not byte-identical (re-saved, resized, recompressed). */
export interface NearDuplicateGroup {
  key: string
  /** Suggested copy to keep (camera data → resolution → file size → date taken). */
  bestId: number
  bestReason: string
  /** At most one copy is still visible in Photos. */
  resolved: boolean
  members: NearDuplicateMember[]
}

export interface NearDuplicates {
  totalGroups: number
  unresolvedGroups: number
  /** Visible copies that would be hidden by keeping only the best one in each group. */
  extraCopies: number
  /** Fingerprinting progress. */
  hashed: number
  hashable: number
  groups: NearDuplicateGroup[]
}

export interface Person {
  id: number
  /** Null until the user names them. */
  name: string | null
  hidden: boolean
  photos: number
  /** Best face, for the round picture (pv-media://face/<id>). */
  coverFaceId: number | null
}

/** Non-destructive edits. Adjustments run from -1 to 1; crop is a fraction of the (rotated) picture. */
export interface PhotoEdits {
  crop?: { x: number; y: number; w: number; h: number }
  /** Mirror left–right. */
  flip?: boolean
  light?: number
  contrast?: number
  color?: number
  warmth?: number
  filter?: 'vivid' | 'warm' | 'cool' | 'fade' | 'bw' | 'sepia'
}

export interface Memory {
  key: string
  kind: 'on_this_day' | 'trip' | 'event'
  title: string
  subtitle: string
  count: number
  coverIds: number[]
  ids: number[]
  /** First day (YYYY-MM-DD). */
  start: string
}

export interface ShareOptions {
  size: 'original' | 'large' | 'small'
  /** Keep the date taken in the copies (location and camera details are always removed). */
  includeDate: boolean
}

export interface SmartAlbum {
  id: number
  name: string
  query: AssetQuery
  count: number
  coverId: number | null
}

/** A face on a photo, box in fractions of the (rotated) picture. */
export interface AssetFace {
  id: number
  x: number
  y: number
  w: number
  h: number
  personId: number | null
  personName: string | null
  manual: boolean
}

export interface PersonMerge {
  id: number
  /** Name the merged person had (if any). */
  name: string | null
  /** Faces from that merge still with this person (what undo would move back). */
  faces: number
  totalFaces: number
  sampleFaceIds: number[]
  automatic: boolean
  mergedAt: string
}

export interface PeopleSuggestion {
  a: Person
  b: Person
  similarity: number
  /** A few of each person's best faces (pv-media://face/<id>). */
  aFaces: number[]
  bFaces: number[]
}

export interface PeopleStatus {
  enabled: boolean
  phase: 'off' | 'downloading' | 'scanning' | 'grouping' | 'ready' | 'error'
  scanned: number
  total: number
  faces: number
  people: number
  download: { loaded: number; total: number } | null
  error: string | null
}

export interface SmartSearchStatus {
  enabled: boolean
  phase: 'off' | 'loading' | 'downloading' | 'indexing' | 'ready' | 'error'
  indexed: number
  total: number
  /** Model download progress in bytes. */
  download: { loaded: number; total: number } | null
  error: string | null
}

export interface MapCluster {
  lat: number
  lon: number
  count: number
  /** [south, west, north, east] of the items in this cluster. */
  bounds: [number, number, number, number]
  coverId: number
}

export interface ExportProgress {
  done: number
  total: number
  failed: number
  bytes: number
}

export interface ExportResult {
  exported: number
  failed: number
  bytes: number
  folder: string
  errors: string[]
}

export interface BinDeleteProgress {
  done: number
  total: number
  failed: number
  bytes: number
}

export interface BinDeleteResult {
  deleted: number
  failed: number
  bytes: number
  errors: string[]
}

export interface DbSnapshot {
  name: string
  path: string
  sizeBytes: number
  createdAt: string
  reason: string
}

export interface BackupTargetInfo {
  id: number
  path: string
  /** The user's name for it ("Drive at home"); null = show the path. */
  label: string | null
  /** Library items that do not have a verified copy here yet. */
  missingAssets: number
  auto: boolean
  /** The drive/folder is currently connected. */
  reachable: boolean
  filesBackedUp: number
  filesWithProblems: number
  bytesBackedUp: number
  lastRunAt: string | null
  lastCompletedAt: string | null
  lastVerifiedAt: string | null
  lastError: string | null
}

export interface BackupStatus {
  /** When the library's own files were last checked completely (null = never). */
  lastLibraryCheck: string | null
  totalFiles: number
  totalBytes: number
  totalAssets: number
  /** Items with at least one verified copy in a backup location. */
  protectedAssets: number
  targets: BackupTargetInfo[]
}

export interface BackupProgress {
  targetId: number
  mode: 'copy' | 'verify'
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  filesTotal: number
  filesDone: number
  bytesTotal: number
  bytesDone: number
  copied: number
  alreadyThere: number
  failed: number
  etaSeconds: number | null
  rate: number | null
  error: string | null
}

export type ThemePreference = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemePreference
}

export type LibraryChangeReason = 'import' | 'thumbnails' | 'favorite' | 'opened' | 'albums'

export interface PhotoVaultApi {
  getState(): Promise<AppState>
  createLibrary(): Promise<AppState>
  openLibrary(): Promise<AppState>
  timeline(query?: AssetQuery): Promise<TimelineGroup[]>
  assetsPage(offset: number, limit: number, query?: AssetQuery): Promise<AssetSummary[]>
  facets(): Promise<Facets>
  asset(id: number): Promise<AssetDetail | null>
  setFavorite(id: number, favorite: boolean): Promise<void>
  setFavorites(ids: number[], favorite: boolean): Promise<void>
  /** Hide from / show in the main timeline. Never deletes anything. */
  setHidden(ids: number[], hidden: boolean): Promise<void>
  moveToBin(ids: number[]): Promise<number>
  restoreFromBin(ids: number[] | 'all'): Promise<number>
  /** Permanently deletes items that are in the Bin. By default originals go to the OS recycle bin. */
  deleteFromBin(ids: number[] | 'all', opts: { skipRecycleBin: boolean }): Promise<BinDeleteResult>
  /** Allow previously deleted content to be imported again. */
  forgetDeleted(): Promise<number>
  /** Asset ids of a timeline range (for shift-click / select-all), in timeline order. */
  assetIdsInRange(query: AssetQuery | undefined, offset: number, limit: number): Promise<number[]>
  /** Sets a date by hand (wall clock "YYYY-MM-DDTHH:MM:SS"), or removes a manual/estimated one with null. */
  setDates(ids: number[], wall: string | null): Promise<void>
  memories(): Promise<Memory[]>
  /** Prepares shareable copies in a new folder and opens it. */
  share(assetIds: number[], opts: ShareOptions): Promise<{ folder: string; files: number; failed: number }>
  setTags(assetIds: number[], add: string[], remove: string[]): Promise<void>
  allTags(): Promise<Array<{ tag: string; count: number }>>
  setDescription(assetId: number, text: string | null): Promise<void>
  /** Places items on the map by hand (null clears a hand-set location). */
  setLocation(assetIds: number[], location: { lat: number; lon: number } | null): Promise<void>
  smartAlbums(): Promise<SmartAlbum[]>
  createSmartAlbum(name: string, query: AssetQuery): Promise<SmartAlbum>
  updateSmartAlbum(id: number, patch: { name?: string; query?: AssetQuery }): Promise<void>
  deleteSmartAlbum(id: number): Promise<void>
  assetFaces(assetId: number): Promise<AssetFace[]>
  /** Marks a face the scan missed (box in fractions); finds and fingerprints it when possible. */
  addFace(assetId: number, box: { x: number; y: number; w: number; h: number }): Promise<AssetFace>
  /** Removes a wrong detection ("not a face"). */
  deleteFace(faceId: number): Promise<void>
  peopleStatus(): Promise<PeopleStatus>
  /** Turns face grouping on (downloads the models once, then scans in the background) or off. */
  setPeopleEnabled(enabled: boolean): Promise<void>
  /** Turns face grouping off and deletes all face data of this library (photos are untouched). */
  clearPeople(): Promise<void>
  people(): Promise<Person[]>
  person(id: number): Promise<Person | null>
  /** Returns the other person when the name is already taken (nothing changed then). */
  renamePerson(id: number, name: string | null): Promise<{ conflict: Person | null }>
  mergePeople(targetId: number, sourceIds: number[]): Promise<void>
  setPersonHidden(id: number, hidden: boolean): Promise<void>
  /** "Same person?" questions, most likely first. */
  peopleSuggestions(): Promise<PeopleSuggestion[]>
  /** "Different people": never merged or suggested again. */
  markDifferentPeople(a: number, b: number): Promise<void>
  personMerges(personId: number): Promise<PersonMerge[]>
  /** Undoes a merge; resolves with the restored person's id. */
  undoMerge(mergeId: number): Promise<number>
  personFaces(personId: number): Promise<Array<{ id: number; assetId: number }>>
  /** Moves faces to a person, to a new person (`{ newName }`), or out of every person (null). */
  moveFaces(faceIds: number[], target: { personId: number } | { newName: string | null } | null): Promise<number | null>
  /** "Not this person" for the selected photos. */
  removeFromPerson(personId: number, assetIds: number[]): Promise<number>
  onPeopleStatus(cb: (s: PeopleStatus) => void): () => void
  /** Names a backup location ("Drive at home"). */
  setBackupLabel(id: number, label: string | null): Promise<void>
  /** Replaces the catalogue with a snapshot (the current one is kept first) and reopens the library. */
  restoreSnapshot(name: string): Promise<void>
  smartSearchStatus(): Promise<SmartSearchStatus>
  /** Turns smart search on (downloads the model once, then indexes in the background) or off. */
  setSmartSearch(enabled: boolean): Promise<void>
  /** Items that look like the description, best first. */
  smartSearch(text: string): Promise<number[]>
  onSmartSearchStatus(cb: (s: SmartSearchStatus) => void): () => void
  watchFolders(): Promise<WatchFolder[]>
  /** Asks for a folder to watch. Null if cancelled. */
  addWatchFolder(): Promise<WatchFolder | null>
  removeWatchFolder(id: number): Promise<void>
  setWatchFolderEnabled(id: number, enabled: boolean): Promise<void>
  checkWatchFolders(): Promise<void>
  mapClusters(view: { south: number; west: number; north: number; east: number; zoom: number }, query?: AssetQuery): Promise<MapCluster[]>
  /** Rotates photos by 90° steps without touching the originals. */
  rotate(ids: number[], degrees: 90 | -90 | 180): Promise<void>
  /** Asks for a folder and copies the originals there (never overwriting). Null if cancelled. */
  exportOriginals(ids: number[]): Promise<ExportResult | null>
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  /** Hide or show everything matching a filter (e.g. all WhatsApp loops). Returns how many changed. */
  setHiddenByQuery(query: AssetQuery, hidden: boolean): Promise<number>

  albums(): Promise<AlbumSummary[]>
  album(id: number): Promise<AlbumSummary | null>
  createAlbum(name: string, assetIds: number[]): Promise<AlbumSummary>
  updateAlbum(id: number, patch: { name?: string; description?: string | null; coverAssetId?: number | null }): Promise<AlbumSummary>
  deleteAlbum(id: number): Promise<void>
  addToAlbum(id: number, assetIds: number[]): Promise<number>
  removeFromAlbum(id: number, assetIds: number[]): Promise<number>
  showInFolder(assetId: number): Promise<void>
  /** Makes a playable copy of a video Chromium cannot decode (HEVC…); resolves when pv-media://playable/<id> is ready. */
  prepareVideo(assetId: number): Promise<void>
  onVideoProgress(cb: (p: { assetId: number; fraction: number }) => void): () => void
  /** Photo editor: current edits, a quick preview of edits (data: URL), and saving them (null = revert). */
  editState(assetId: number): Promise<{ edits: PhotoEdits | null; rotation: number }>
  editPreview(assetId: number, rotation: number, edits: PhotoEdits | null, opts: { skipCrop?: boolean; size?: number }): Promise<string>
  saveEdits(assetId: number, rotation: number, edits: PhotoEdits | null): Promise<void>
  /** "Save edited copy…": a JPEG with the edits applied. */
  saveEditedCopy(assetId: number): Promise<boolean>
  /** Viewer right-click actions. */
  copyImage(assetId: number): Promise<void>
  copyFile(assetId: number): Promise<void>
  copyPath(assetId: number): Promise<void>
  openExternal(assetId: number): Promise<void>
  saveCopy(assetId: number): Promise<boolean>
  openLibraryFolder(): Promise<void>

  /** Opens a picker for one folder or several ZIP archives. */
  chooseImportSources(kind: 'folder' | 'zip'): Promise<string[] | null>
  startImport(sources: string[]): Promise<number>
  resumeImport(importId: number): Promise<ImportProgress>
  commitImport(importId: number): Promise<void>
  cancelImport(importId: number): Promise<void>
  dismissImport(importId: number): Promise<void>
  currentImport(): Promise<ImportProgress | null>
  imports(): Promise<ImportSummary[]>
  importItems(importId: number, classification: ItemClassification | 'all', offset: number, limit: number): Promise<ImportItemInfo[]>
  duplicates(offset: number, limit: number): Promise<{ total: number; groups: DuplicateGroup[] }>
  nearDuplicates(offset: number, limit: number): Promise<NearDuplicates>
  /** Bursts and repeated takes of the same moment, with the sharpest shot suggested. */
  similarPhotos(offset: number, limit: number): Promise<NearDuplicates>
  /** "Not duplicates": never group these together again. */
  dismissNearDuplicates(assetIds: number[]): Promise<void>
  /** Keep the best copy of every group visible and hide the others. Returns how many were hidden. */
  hideAllNearDuplicateExtras(): Promise<number>

  startVerify(): Promise<VerifyProgress>
  cancelVerify(): Promise<void>
  currentVerify(): Promise<VerifyProgress | null>
  verifyIssues(offset: number, limit: number): Promise<VerifyIssue[]>

  backupStatus(): Promise<BackupStatus>
  /** Opens a folder picker and adds the chosen folder as a backup location. */
  addBackupTarget(): Promise<BackupTargetInfo | null>
  removeBackupTarget(id: number): Promise<void>
  setBackupAuto(id: number, auto: boolean): Promise<void>
  runBackup(id: number, verifyAll: boolean): Promise<BackupProgress>
  cancelBackup(): Promise<void>
  currentBackup(): Promise<BackupProgress | null>
  onBackupProgress(cb: (p: BackupProgress) => void): () => void
  dbSnapshots(): Promise<DbSnapshot[]>
  snapshotNow(): Promise<void>
  openSnapshotsFolder(): Promise<void>

  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>

  pathForFile(file: File): string
  onImportProgress(cb: (p: ImportProgress) => void): () => void
  onLibraryChanged(cb: (reason: LibraryChangeReason) => void): () => void
  onVerifyProgress(cb: (p: VerifyProgress) => void): () => void
  onBinProgress(cb: (p: BinDeleteProgress) => void): () => void
}

export const MEDIA_PROTOCOL = 'pv-media'
