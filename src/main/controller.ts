import { app, nativeImage } from 'electron'
import { createWriteStream, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import type { AppState, BackupProgress, ImportProgress, LibraryChangeReason, PeopleStatus, SmartSearchStatus, VerifyProgress } from '@shared/types'
import { ImportService } from '@core/import/service'
import { Library } from '@core/library/library'
import { VerifyService } from '@core/library/verify'
import { WatchService } from '@core/library/watch'
import { restoreSnapshotFile } from '@core/library/dbSnapshots'
import { buildSearchIndexInBackground } from '@core/repo/search'
import { fillPlaces, fillPlacesInBackground } from '@core/geo/fillPlaces'
import { nearDuplicatesCached, primeNearDuplicateGroups } from '@core/repo/nearDuplicates'
import { HeavyWork } from './heavyWork'
import { SmartSearchService } from './smartSearch'
import { PeopleService } from './people'
import { videoFramesToTemp } from './videos'
import { isSharpDecodable } from '@core/media/formats'
import { ClassifyQueue } from '@core/library/classifyQueue'
import { HashQueue } from '@core/library/hashQueue'
import { runDating } from '@core/dating/dating'
import { linkLivePhotos } from '@core/library/livePhotos'
import { linkEditedVersions } from '@core/library/editedVersions'
import { BackupService } from '@core/library/backup'
import { maybeDailySnapshot, snapshotDatabase } from '@core/library/dbSnapshots'
import { createLogger, type Logger } from '@core/log'
import { libraryInfo } from '@core/repo/queries'
import { ThumbnailQueue, originalPathFor, retryFailedThumbnailsOnce, type PlatformThumbnailer } from '@core/thumbnails/thumbnails'
import { errorMessage } from '@core/util'

/** OS thumbnailer: Windows shell / macOS QuickLook. Handles HEIC (with the OS codec), RAW and video frames. */
const platformThumbnailer: PlatformThumbnailer | undefined =
  process.platform === 'win32' || process.platform === 'darwin'
    ? async (path, size) => {
        const img = await nativeImage.createThumbnailFromPath(path, { width: size, height: size })
        return img.isEmpty() ? null : img.toPNG()
      }
    : undefined

export interface ControllerEvents {
  importProgress: (p: ImportProgress) => void
  libraryChanged: (reason: LibraryChangeReason) => void
  verifyProgress: (p: VerifyProgress) => void
  backupProgress: (p: BackupProgress) => void
  smartSearchStatus: (s: SmartSearchStatus) => void
  peopleStatus: (s: PeopleStatus) => void
}

/** Owns the open library and its long-lived services (imports, thumbnail worker, logging). */
export class LibraryController {
  library: Library | null = null
  imports: ImportService | null = null
  watch: WatchService | null = null
  private heavy = new HeavyWork()
  smart: SmartSearchService | null = null
  people: PeopleService | null = null
  private nearJob: Promise<void> | null = null
  thumbnails: ThumbnailQueue | null = null
  verify: VerifyService | null = null
  classify: ClassifyQueue | null = null
  hashes: HashQueue | null = null
  backups: BackupService | null = null
  private logStream: WriteStream | null = null
  private changeTimer: NodeJS.Timeout | null = null
  private pendingReason: LibraryChangeReason | null = null
  lastError: string | null = null

  constructor(private readonly events: ControllerEvents) {}

  private makeLogger(root: string): Logger {
    this.logStream?.end()
    const day = new Date().toISOString().slice(0, 10)
    this.logStream = createWriteStream(join(root, 'logs', `photovault-${day}.log`), { flags: 'a' })
    const stream = this.logStream
    return createLogger([(line) => stream.write(`${line}\n`), (line) => console.log(line)])
  }

  private datingTimer: NodeJS.Timeout | null = null

  /** Runs the dating pass shortly after imports / fingerprinting settle (debounced; it is a whole-library pass). */
  scheduleDating(): void {
    if (this.datingTimer) clearTimeout(this.datingTimer)
    this.datingTimer = setTimeout(() => {
      this.datingTimer = null
      const library = this.library
      if (!library) return
      void this.ensureNearDuplicateGroups().then(() => {
        if (this.library !== library) return
        try {
          linkLivePhotos(library)
          linkEditedVersions(library)
          const r = runDating(library)
          if (r.borrowed + r.estimated > 0) this.notifyChanged('import')
        } catch (err) {
          library.logger.error('dating.failed', { error: errorMessage(err) })
        }
      })
    }, 1500)
  }

  /**
   * Makes sure the probable-duplicate groups are cached, computing them on the worker thread (whole-library
   * pass: seconds at 100k items) so the main process keeps answering the window meanwhile.
   */
  ensureNearDuplicateGroups(): Promise<void> {
    const library = this.library
    if (!library || nearDuplicatesCached(library)) return Promise.resolve()
    if (this.nearJob) return this.nearJob
    this.nearJob = (async () => {
      try {
        // A couple of rounds in case fingerprints changed while the worker was busy.
        for (let i = 0; i < 3 && this.library === library && !nearDuplicatesCached(library); i++) {
          const t = Date.now()
          const r = await this.heavy.nearDuplicateGroups(library.paths.dbFile)
          library.logger.info('near_duplicates.worker', { groups: r.groups.length, ms: Date.now() - t })
          if (this.library === library) primeNearDuplicateGroups(library, r.key, r.groups)
        }
      } catch (err) {
        library.logger.warn('near_duplicates.worker_failed', { error: errorMessage(err) }) // callers fall back to computing inline
      } finally {
        this.nearJob = null
      }
    })()
    return this.nearJob
  }

  /** After an import: snapshot the catalogue and copy the new originals to connected backups. */
  private async afterImport(): Promise<void> {
    const library = this.library
    if (!library) return
    try {
      await snapshotDatabase(library, 'import')
    } catch (err) {
      library.logger.error('db.snapshot_failed', { error: errorMessage(err) })
    }
    await this.runAutoBackups()
  }

  async runAutoBackups(): Promise<void> {
    const backups = this.backups
    if (!backups || backups.current()) return
    for (const id of backups.autoTargets()) {
      if (this.backups !== backups) return
      await backups.run(id).catch(() => undefined)
    }
  }

  /** Coalesces change notifications so a busy import doesn't flood the renderer. */
  private notifyChanged(reason: LibraryChangeReason): void {
    this.pendingReason = reason
    if (this.changeTimer) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      if (this.pendingReason) this.events.libraryChanged(this.pendingReason)
      this.pendingReason = null
    }, 400)
  }

  open(root: string, create: boolean): void {
    this.close()
    const bootstrapLogger = createLogger([(line) => console.log(line)])
    const library = create ? Library.create(root, bootstrapLogger) : Library.open(root, bootstrapLogger)
    library.close()
    // Re-open with the file logger now that we know the final root (create may pick a sub-folder).
    const opened = Library.open(library.root, this.makeLogger(library.root))
    this.library = opened
    this.hashes = new HashQueue(opened, {
      onUpdated: () => this.notifyChanged('thumbnails'),
      // Once all fingerprints exist, duplicates can lend their dates: re-run the dating pass.
      onIdle: () => this.scheduleDating()
    })
    this.thumbnails = new ThumbnailQueue(opened, {
      platform: platformThumbnailer,
      onUpdated: () => {
        this.notifyChanged('thumbnails')
        this.hashes?.kick()
        this.smart?.kick()
        this.people?.kick()
      }
    })
    this.imports = new ImportService(opened, {
      onProgress: (p) => {
        this.events.importProgress(p)
        if (p.phase === 'completed') {
          void fillPlacesInBackground(opened, () => this.library === opened).then(() => buildSearchIndexInBackground(opened, () => this.library === opened))
          this.classify?.kick()
          this.scheduleDating()
          void this.afterImport()
        }
      },
      onAssetsCreated: () => {
        this.notifyChanged('import')
        this.thumbnails?.kick()
      }
    })
    this.smart = new SmartSearchService(opened, this.heavy, join(app.getPath('userData'), 'models'), (s) => this.events.smartSearchStatus(s))
    this.smart.start()
    this.people = new PeopleService(
      opened,
      this.heavy,
      join(app.getPath('userData'), 'models', 'faces'),
      async (id) => {
        const src = originalPathFor(opened, id)
        if (!src) return null
        if (src.mime.startsWith('video/')) {
          // Videos: one frame from the middle (ffmpeg applies the video's own rotation).
          const d = opened.db.get<{ duration_ms: number | null }>('SELECT duration_ms FROM assets WHERE id = ?', [id])
          const frames = await videoFramesToTemp(src.absolutePath, d?.duration_ms ?? null, [0.5], 1600)
          return frames.paths[0] ? { path: frames.paths[0], rotation: 0, cleanup: frames.cleanup } : (await frames.cleanup(), null)
        }
        if (isSharpDecodable(src.mime)) return { path: src.absolutePath, rotation: src.rotation }
        // HEIC etc.: the generated preview (already oriented and rotated).
        const preview = await this.thumbnails?.ensurePreview(id)
        return preview ? { path: preview, rotation: 0 } : null
      },
      (s) => this.events.peopleStatus(s),
      () => this.notifyChanged('albums')
    )
    this.people.start()
    this.watch = new WatchService(opened, this.imports, { onChanged: () => this.notifyChanged('import') })
    this.watch.start()
    this.verify = new VerifyService(opened, { onProgress: (p) => this.events.verifyProgress(p) })
    this.classify = new ClassifyQueue(opened, { onUpdated: () => this.notifyChanged('thumbnails') })
    retryFailedThumbnailsOnce(opened) // e.g. HEVC videos and HEIC photos that failed before ffmpeg/libheif existed
    this.thumbnails.kick()
    this.backups = new BackupService(opened, {
      onProgress: (p) => {
        this.events.backupProgress(p)
        if (p.status !== 'running') this.notifyChanged('import') // protection status changed
      }
    })
    this.classify.kick()
    this.hashes.kick()
    this.scheduleDating()
    void fillPlacesInBackground(opened, () => this.library === opened).then(() => buildSearchIndexInBackground(opened, () => this.library === opened))
    // Protection on open: a daily catalogue snapshot, then bring connected backups up to date.
    setTimeout(() => {
      if (this.library !== opened) return
      void maybeDailySnapshot(opened)
        .catch((err) => opened.logger.error('db.snapshot_failed', { error: errorMessage(err) }))
        .then(() => this.runAutoBackups())
    }, 5000)
    this.protectTimer = setInterval(() => void this.protectionTick(opened), 60_000)
    this.lastError = null
  }

  private protectTimer: ReturnType<typeof setInterval> | null = null
  private lastMonthlyCheck = 0

  /**
   * Runs every minute while a library is open:
   *  - a backup drive that was plugged back in (rotating drives) is brought up to date at once;
   *  - once a day, the monthly checks: the library's own files are re-verified when the last full check is older
   *    than 30 days, and each connected backup drive is re-verified on the same schedule.
   * Nothing runs while an import or another backup/verification is in progress.
   */
  private async protectionTick(library: Library): Promise<void> {
    const backups = this.backups
    if (this.library !== library || !backups || backups.current()) return
    const imp = this.imports?.current()
    if (imp && !['completed', 'failed', 'cancelled', 'interrupted'].includes(imp.phase)) return
    if (this.verify?.current()?.status === 'running') return
    try {
      const st = backups.status()
      for (const t of st.targets) {
        if (t.auto && t.reachable && t.missingAssets > 0) {
          library.logger.info('backup.drive_reconnected', { target: t.path, missing: t.missingAssets })
          await backups.run(t.id)
          return
        }
      }
      if (Date.now() - this.lastMonthlyCheck < 24 * 3600_000) return
      this.lastMonthlyCheck = Date.now()
      const month = 30 * 86_400_000
      const old = (iso: string | null): boolean => !iso || Date.now() - Date.parse(iso) > month
      if (st.totalFiles > 0 && old(st.lastLibraryCheck)) {
        library.logger.info('verify.monthly', { last: st.lastLibraryCheck })
        this.verify?.start()
        return
      }
      for (const t of st.targets) {
        if (t.reachable && t.lastCompletedAt && old(t.lastVerifiedAt)) {
          library.logger.info('backup.monthly_verify', { target: t.path })
          await backups.run(t.id, { verifyAll: true })
          return
        }
      }
    } catch (err) {
      library.logger.warn('protection.tick_failed', { error: errorMessage(err) })
    }
  }

  /** Puts a catalogue snapshot back (the current catalogue is kept first) and reopens the library. */
  restoreSnapshot(name: string): void {
    const library = this.library
    if (!library) throw new Error('No library is open.')
    const root = library.root
    library.logger.warn('db.restore', { snapshot: name })
    this.close()
    try {
      restoreSnapshotFile(root, name)
    } finally {
      this.open(root, false)
    }
    this.library?.logger.warn('db.restored', { snapshot: name })
  }

  tryOpen(root: string): void {
    try {
      this.open(root, false)
    } catch (err) {
      this.lastError = errorMessage(err)
      this.close()
    }
  }

  state(): AppState {
    if (!this.library) return { kind: 'no-library', error: this.lastError ?? undefined }
    return { kind: 'ready', library: libraryInfo(this.library) }
  }

  close(): void {
    if (this.protectTimer) clearInterval(this.protectTimer)
    this.protectTimer = null
    this.smart?.stop()
    this.smart = null
    this.people?.stop()
    this.people = null
    this.watch?.stop()
    this.watch = null
    this.imports?.shutdown()
    this.verify?.cancel()
    this.verify = null
    this.classify?.stop()
    this.classify = null
    this.hashes?.stop()
    this.hashes = null
    this.backups?.cancel()
    this.backups = null
    this.thumbnails?.stop()
    this.thumbnails = null
    this.imports = null
    this.library?.close()
    this.library = null
    this.logStream?.end()
    this.logStream = null
  }
}
