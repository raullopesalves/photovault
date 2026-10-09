import { realpath } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ImportProgress } from '@shared/types'
import type { Library } from '../library/library'
import { ZipPool } from '../sources/zip'
import { EtaEstimator } from '../eta'
import { errorMessage } from '../util'
import { analyzeCandidates, classifyItems, importSources, importSummary, readSidecars } from './analyze'
import { commitImport } from './commit'
import { scanSources } from './scan'

export class ImportBusyError extends Error {
  constructor() {
    super('Another import is already in progress.')
  }
}

interface Session {
  progress: ImportProgress
  abort: AbortController
  task: Promise<void> | null
  eta: EtaEstimator
}

const realpathNative = promisify(realpath.native)

async function isZipFile(path: string): Promise<boolean> {
  if (extname(path).toLowerCase() !== '.zip') return false
  const fh = await open(path, 'r')
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(4), 0, 4, 0)
    // Local file header "PK\3\4", or an empty archive "PK\5\6".
    return bytesRead === 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 3 || buffer[2] === 5)
  } finally {
    await fh.close()
  }
}

/** Validates user-chosen sources: folders or ZIP archives. Returns canonical paths (real casing on Windows). */
export async function resolveSources(paths: string[]): Promise<string[]> {
  if (paths.length === 0) throw new Error('Choose a folder or ZIP archive to import.')
  const out: string[] = []
  for (const p of paths) {
    const st = await stat(p)
    if (!st.isDirectory() && !(st.isFile() && (await isZipFile(p)))) {
      throw new Error(`Not a folder or ZIP archive: ${p}`)
    }
    const real = await realpathNative(resolve(p))
    if (!out.includes(real)) out.push(real)
  }
  return out.sort()
}

/**
 * Drives one import at a time through:
 *   scan -> read sidecars -> analyse (hash + metadata) -> classify -> [user confirms] -> commit.
 * All state that matters is persisted in the database; the in-memory session only carries live progress.
 */
export class ImportService {
  private session: Session | null = null
  private lastEmit = 0
  private shuttingDown = false

  constructor(
    private readonly library: Library,
    private readonly hooks: {
      onProgress?: (p: ImportProgress) => void
      onAssetsCreated?: (ids: number[]) => void
      concurrency?: number
    } = {}
  ) {}

  current(): ImportProgress | null {
    return this.session ? { ...this.session.progress } : null
  }

  private emit(force = false): void {
    if (!this.session) return
    const now = Date.now()
    if (!force && now - this.lastEmit < 120) return
    this.lastEmit = now
    this.hooks.onProgress?.({ ...this.session.progress })
  }

  private isActive(): boolean {
    const phase = this.session?.progress.phase
    return phase === 'scanning' || phase === 'sidecars' || phase === 'analyzing' || phase === 'classifying' || phase === 'importing' || phase === 'linking'
  }

  private newSession(importId: number, sourcePath: string, phase: ImportProgress['phase']): Session {
    return {
      abort: new AbortController(),
      task: null,
      eta: new EtaEstimator(),
      progress: {
        importId,
        phase,
        sourcePath,
        filesDiscovered: 0,
        photosFound: 0,
        videosFound: 0,
        sidecarsFound: 0,
        ignoredFound: 0,
        archivesFound: 0,
        sidecarsRead: 0,
        sidecarsMatched: 0,
        hashesReused: 0,
        analyzed: 0,
        analyzeTotal: 0,
        committed: 0,
        commitTotal: 0,
        bytesProcessed: 0,
        bytesTotal: 0,
        etaSeconds: null,
        rate: null,
        rateUnit: null,
        elapsedSeconds: 0,
        currentFile: null,
        summary: null,
        error: null,
        trigger: 'user'
      }
    }
  }

  /** Starts timing a new phase. */
  private phase(session: Session, phase: ImportProgress['phase'], unit: ImportProgress['rateUnit']): void {
    session.progress.phase = phase
    session.progress.rateUnit = unit
    session.progress.etaSeconds = null
    session.progress.rate = null
    session.progress.elapsedSeconds = 0
    session.eta = new EtaEstimator()
  }

  private tick(session: Session, done: number, total: number): void {
    const e = session.eta.update(done, total)
    session.progress.etaSeconds = e.etaSeconds
    session.progress.rate = e.rate
    session.progress.elapsedSeconds = Math.round(e.elapsedSeconds)
  }

  /** Starts scanning + analysing folders and/or ZIP archives. Resolves once the import record exists. */
  async start(paths: string | string[], opts: { trigger?: 'user' | 'watch' } = {}): Promise<number> {
    if (this.isActive() || this.session?.progress.phase === 'ready') throw new ImportBusyError()
    const roots = await resolveSources(Array.isArray(paths) ? paths : [paths])
    const first = roots[0] as string
    const db = this.library.db
    const trigger = opts.trigger ?? 'user'
    const importId = db.run(
      "INSERT INTO imports (source_type, source_path, sources_json, status, started_at, trigger) VALUES ('LOCAL_FOLDER', ?, ?, 'scanning', ?, ?)",
      [first, JSON.stringify(roots), new Date().toISOString(), trigger]
    ).lastInsertRowid
    this.library.logger.info('import.started', { importId, sources: roots, trigger })

    const session = this.newSession(importId, first, 'scanning')
    session.progress.trigger = trigger
    this.session = session
    session.task = this.runAnalysis(session, roots)
    this.emit(true)
    return importId
  }

  private async runAnalysis(session: Session, roots: string[]): Promise<void> {
    const db = this.library.db
    const p = session.progress
    const signal = session.abort.signal
    const zips = new ZipPool()
    try {
      const scan = await scanSources(roots, {
        excludeRoots: [this.library.root],
        zips,
        signal,
        onProgress: (c) => {
          Object.assign(p, {
            filesDiscovered: c.filesDiscovered,
            photosFound: c.photosFound,
            videosFound: c.videosFound,
            sidecarsFound: c.sidecarsFound,
            ignoredFound: c.ignoredFound,
            archivesFound: c.archivesFound
          })
          // Total unknown while scanning: only elapsed time is meaningful.
          this.tick(session, c.filesDiscovered, 0)
          this.emit()
        }
      })
      const c = scan.counts
      db.run(
        `UPDATE imports SET files_scanned = ?, photos_found = ?, videos_found = ?, sidecars_found = ?, ignored_found = ?, archives_found = ?
          WHERE id = ?`,
        [c.filesDiscovered, c.photosFound, c.videosFound, c.sidecarsFound, c.ignoredFound, c.archivesFound, p.importId]
      )

      this.phase(session, 'sidecars', 'files')
      this.emit(true)
      const catalog = await readSidecars({
        sidecars: scan.sidecars,
        zips,
        signal,
        onProgress: (read, total) => {
          p.sidecarsRead = read
          this.tick(session, read, total)
          this.emit()
        }
      })

      this.phase(session, 'analyzing', 'files')
      p.analyzeTotal = scan.candidates.length
      this.emit(true)
      const stats = await analyzeCandidates({
        db,
        importId: p.importId,
        candidates: scan.candidates,
        problems: scan.problems,
        catalog,
        zips,
        concurrency: this.hooks.concurrency,
        signal,
        onProgress: (a) => {
          p.analyzed = a.analyzed
          p.bytesProcessed = a.bytes
          p.hashesReused = a.hashesReused
          p.sidecarsMatched = a.sidecarsMatched
          p.currentFile = a.currentFile
          this.tick(session, a.analyzed, a.total)
          this.emit()
        }
      })

      this.phase(session, 'classifying', null)
      p.currentFile = null
      this.emit(true)
      classifyItems(db, p.importId)
      const type =
        db.get<{ t: string }>(
          `SELECT CASE WHEN SUM(source_type = 'GOOGLE_TAKEOUT') > 0 THEN 'GOOGLE_TAKEOUT'
                       WHEN SUM(source_type = 'ICLOUD_EXPORT') > 0 THEN 'ICLOUD_EXPORT'
                       WHEN SUM(source_type = 'ZIP') > 0 THEN 'ZIP' ELSE 'LOCAL_FOLDER' END AS t
             FROM import_items WHERE import_id = ?`,
          [p.importId]
        )?.t ?? 'LOCAL_FOLDER'
      db.run("UPDATE imports SET status = 'ready', analyzed_at = ?, source_type = ?, sidecars_matched = ?, hashes_reused = ? WHERE id = ?", [
        new Date().toISOString(),
        type,
        stats.sidecarsMatched,
        stats.hashesReused,
        p.importId
      ])
      p.summary = importSummary(db, p.importId)
      p.phase = 'ready'
      this.library.logger.info('import.analyzed', { importId: p.importId, ...p.summary })
    } catch (err) {
      this.fail(session, err)
    } finally {
      await zips.closeAll()
    }
    this.emit(true)
  }

  private fail(session: Session, err: unknown): void {
    // On shutdown the database state is left as-is: the next open marks the import 'interrupted' (resumable).
    if (this.shuttingDown) return
    const p = session.progress
    const cancelled = session.abort.signal.aborted
    p.phase = cancelled ? 'cancelled' : 'failed'
    p.error = cancelled ? null : errorMessage(err)
    this.library.db.run('UPDATE imports SET status = ?, completed_at = ?, error = ? WHERE id = ?', [
      cancelled ? 'cancelled' : 'failed',
      new Date().toISOString(),
      p.error,
      p.importId
    ])
    p.summary = importSummary(this.library.db, p.importId)
    if (cancelled) this.library.logger.info('import.cancelled', { importId: p.importId })
    else this.library.logger.error('import.failed', { importId: p.importId, error: p.error })
  }

  /**
   * Re-opens an interrupted import that had finished analysis so the user can review and continue it.
   * Items that already have an outcome are skipped; commit re-checks every hash against the library,
   * so bytes added by another import in the meantime are recognised as duplicates.
   */
  resume(importId: number): ImportProgress {
    if (this.isActive() || this.session?.progress.phase === 'ready') throw new ImportBusyError()
    const db = this.library.db
    const before = importSummary(db, importId)
    if (!before?.resumable) throw new Error('This import cannot be resumed. Start a new import of the same source instead.')
    db.run("UPDATE imports SET status = 'ready', completed_at = NULL, error = NULL WHERE id = ?", [importId])
    const summary = importSummary(db, importId)
    const session = this.newSession(importId, before.sources[0] ?? before.sourcePath, 'ready')
    Object.assign(session.progress, {
      summary,
      filesDiscovered: before.filesScanned,
      photosFound: before.photosFound,
      videosFound: before.videosFound,
      sidecarsFound: before.sidecarsFound,
      ignoredFound: before.ignoredFound,
      archivesFound: before.archivesFound,
      sidecarsMatched: before.sidecarsMatched,
      hashesReused: before.hashesReused
    })
    this.session = session
    this.library.logger.info('import.resumed', { importId })
    this.emit(true)
    return { ...session.progress }
  }

  /** User confirmed: copy new assets in and record provenance for duplicates. */
  async commit(importId: number): Promise<void> {
    const session = this.session
    if (!session || session.progress.importId !== importId || session.progress.phase !== 'ready') {
      throw new Error('This import is not ready to be committed.')
    }
    const p = session.progress
    const db = this.library.db
    db.run("UPDATE imports SET status = 'importing' WHERE id = ?", [importId])
    this.phase(session, 'importing', 'bytes')
    p.commitTotal = p.summary?.newAssets ?? 0
    p.committed = 0
    p.bytesProcessed = 0
    p.bytesTotal = p.summary?.bytesNew ?? 0
    this.emit(true)
    session.task = (async () => {
      try {
        await commitImport({
          library: this.library,
          importId,
          concurrency: this.hooks.concurrency,
          signal: session.abort.signal,
          onAssetsCreated: this.hooks.onAssetsCreated,
          onProgress: (c) => {
            if (c.phase !== p.phase) this.phase(session, c.phase, c.phase === 'importing' ? 'bytes' : 'files')
            if (c.phase === 'importing') {
              p.committed = c.done
              p.commitTotal = c.total
              this.tick(session, c.bytes, p.bytesTotal)
            } else {
              this.tick(session, c.done, c.total)
            }
            p.bytesProcessed = c.bytes
            p.currentFile = c.currentFile
            this.emit()
          }
        })
        db.run("UPDATE imports SET status = 'completed', completed_at = ? WHERE id = ?", [new Date().toISOString(), importId])
        p.phase = 'completed'
        p.currentFile = null
        p.summary = importSummary(db, importId)
        this.library.logger.info('import.completed', { importId, ...p.summary })
      } catch (err) {
        this.fail(session, err)
      }
      this.emit(true)
    })()
    await Promise.resolve()
  }

  async cancel(importId: number): Promise<void> {
    const session = this.session
    if (!session || session.progress.importId !== importId) return
    if (session.progress.phase === 'ready') {
      // Nothing has been written to the library yet; just close the import.
      session.abort.abort()
      this.fail(session, new Error('cancelled'))
      this.emit(true)
      return
    }
    session.abort.abort()
    await session.task?.catch(() => undefined)
  }

  /** Forget a finished session so a new import can start. */
  dismiss(importId: number): void {
    if (this.session?.progress.importId === importId && !this.isActive()) {
      if (this.session.progress.phase === 'ready') {
        this.session.abort.abort()
        this.fail(this.session, new Error('cancelled'))
      }
      this.session = null
    }
  }

  /** Stops any running work (app shutdown / library switch). Completed items stay committed. */
  shutdown(): void {
    this.shuttingDown = true
    this.session?.abort.abort()
  }

  /** Waits for the current background task (tests). */
  async settle(): Promise<void> {
    await this.session?.task
  }
}
