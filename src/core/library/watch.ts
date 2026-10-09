import { existsSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { WatchFolder } from '@shared/types'
import { classifyByExtension } from '../media/formats'
import type { ImportService } from '../import/service'
import { errorMessage } from '../util'
import type { Library } from './library'

interface Row {
  id: number
  path: string
  enabled: number
  created_at: string
  last_checked_at: string | null
  last_import_id: number | null
  last_imported: number | null
  last_error: string | null
}

const FINISHED = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const MAX_FILES = 250_000

/**
 * Watched folders: new photos appearing in a folder (a phone-sync or camera-upload folder, Downloads…) are
 * imported automatically through the normal import pipeline — copy, verify, deduplicate, provenance.
 * A check first lists the folder and compares each media file's size/mtime with what earlier imports saw,
 * so nothing is read or imported unless something is new or changed; quiet checks leave no trace.
 * Sources are never modified, and removing a watch never touches the library.
 */
export class WatchService {
  private watchers = new Map<number, FSWatcher>()
  private timer: ReturnType<typeof setInterval> | null = null
  private debounce: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private stopped = false

  constructor(
    private readonly library: Library,
    private readonly imports: ImportService,
    private readonly opts: { onChanged?: () => void; intervalMs?: number; debounceMs?: number } = {}
  ) {}

  list(): WatchFolder[] {
    return this.library.db.all<Row>('SELECT * FROM watch_folders ORDER BY id').map((r) => ({
      id: r.id,
      path: r.path,
      enabled: r.enabled === 1,
      available: existsSync(r.path),
      lastCheckedAt: r.last_checked_at,
      lastImportId: r.last_import_id,
      lastImported: r.last_imported ?? 0,
      lastError: r.last_error
    }))
  }

  add(path: string): WatchFolder {
    let abs = resolve(path)
    try {
      abs = realpathSync.native(abs)
    } catch {
      /* checked just below */
    }
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error('That folder does not exist.')
    const lib = resolve(this.library.root)
    const inside = (a: string, b: string): boolean => a === b || a.startsWith(b.endsWith(sep) ? b : b + sep)
    if (inside(abs, lib)) throw new Error('This folder is inside the library. Choose a folder outside it.')
    if (inside(lib, abs)) throw new Error('The library is inside this folder. Choose a more specific folder.')
    this.library.db.run('INSERT OR IGNORE INTO watch_folders (path, enabled, created_at) VALUES (?, 1, ?)', [abs, new Date().toISOString()])
    this.library.logger.info('watch.added', { path: abs })
    this.rewatch()
    this.schedule(1000)
    return this.list().find((f) => f.path === abs) as WatchFolder
  }

  remove(id: number): void {
    this.library.db.run('DELETE FROM watch_folders WHERE id = ?', [id])
    this.rewatch()
  }

  setEnabled(id: number, enabled: boolean): void {
    this.library.db.run('UPDATE watch_folders SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id])
    this.rewatch()
    if (enabled) this.schedule(1000)
  }

  /** Starts file-system watching plus a periodic check (catches drives that come back, missed events). */
  start(): void {
    this.stopped = false
    this.rewatch()
    this.timer = setInterval(() => this.schedule(0), this.opts.intervalMs ?? 15 * 60_000)
    this.schedule(10_000)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
  }

  /** Checks soon; repeated calls (bursts of file events while a phone syncs) collapse into one. */
  schedule(delayMs = this.opts.debounceMs ?? 20_000): void {
    if (this.stopped) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      void this.checkAll()
    }, delayMs)
  }

  /** Checks every enabled folder now (one at a time). */
  checkAll(): Promise<void> {
    if (this.running) return this.running
    const run = (async () => {
      for (const f of this.list()) {
        if (this.stopped) break
        if (f.enabled) await this.checkOne(f)
      }
    })()
    // Clear only after assigning: with nothing to check, `run` settles before this line runs.
    this.running = run.finally(() => {
      if (this.running === guarded) this.running = null
    })
    const guarded = this.running
    return guarded
  }

  /** Media files in the folder that no earlier import has seen with this size and modification time. */
  async unseenFiles(folder: string): Promise<string[]> {
    const found = new Map<string, string>()
    const libRoot = resolve(this.library.root)
    const walk = async (dir: string): Promise<void> => {
      if (found.size >= MAX_FILES || dir === libRoot) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return // unreadable sub-folder: skip
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name.startsWith('$')) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) await walk(p)
        else if (e.isFile() && classifyByExtension(e.name).kind === 'media') {
          try {
            const st = await stat(p)
            found.set(p, `f:${st.size}:${Math.round(st.mtimeMs)}`)
          } catch {
            /* vanished */
          }
        }
      }
    }
    await walk(folder)
    const prefix = folder.endsWith(sep) ? folder : folder + sep
    const upper = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)
    const seen = new Set<string>()
    for (const r of this.library.db.all<{ source_path: string; source_fingerprint: string | null }>(
      'SELECT source_path, source_fingerprint FROM import_items WHERE source_path >= ? AND source_path < ? AND source_fingerprint IS NOT NULL',
      [prefix, upper]
    ))
      seen.add(`${r.source_path}\u0000${r.source_fingerprint}`)
    return [...found].filter(([p, fp]) => !seen.has(`${p}\u0000${fp}`)).map(([p]) => p)
  }

  private async checkOne(f: WatchFolder): Promise<void> {
    const db = this.library.db
    const now = (): string => new Date().toISOString()
    if (!existsSync(f.path)) {
      db.run('UPDATE watch_folders SET last_checked_at = ?, last_error = ? WHERE id = ?', [now(), 'Folder not available (drive disconnected?)', f.id])
      return
    }
    try {
      const unseen = await this.unseenFiles(f.path)
      db.run('UPDATE watch_folders SET last_checked_at = ?, last_error = NULL WHERE id = ?', [now(), f.id])
      if (unseen.length === 0) return
      const cur = this.imports.current()
      if (cur && !FINISHED.has(cur.phase)) return // the user is importing or reviewing: try again later
      if (cur) this.imports.dismiss(cur.importId)

      this.library.logger.info('watch.import', { path: f.path, unseen: unseen.length })
      const id = await this.imports.start([f.path], { trigger: 'watch' })
      await this.imports.settle()
      let p = this.imports.current()
      if (p?.importId === id && p.phase === 'ready') {
        await this.imports.commit(id)
        await this.imports.settle()
        p = this.imports.current()
      }
      if (p?.importId === id && p.phase === 'completed') {
        db.run('UPDATE watch_folders SET last_import_id = ?, last_imported = ? WHERE id = ?', [id, p.summary?.newAssets ?? 0, f.id])
        this.imports.dismiss(id)
      } else if (p?.importId === id) {
        db.run('UPDATE watch_folders SET last_error = ? WHERE id = ?', [p.error ?? `Import ${p.phase}`, f.id])
      }
    } catch (err) {
      db.run('UPDATE watch_folders SET last_error = ? WHERE id = ?', [errorMessage(err), f.id])
      this.library.logger.warn('watch.failed', { path: f.path, error: errorMessage(err) })
    } finally {
      this.opts.onChanged?.()
    }
  }

  private rewatch(): void {
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
    if (this.stopped) return
    for (const f of this.list()) {
      if (!f.enabled || !f.available) continue
      try {
        const w = watch(f.path, { recursive: true }, (_event, name) => {
          if (name && classifyByExtension(String(name)).kind === 'media') this.schedule()
        })
        w.on('error', () => w.close())
        this.watchers.set(f.id, w)
      } catch {
        /* recursive watching unsupported here: the periodic check still runs */
      }
    }
  }
}
