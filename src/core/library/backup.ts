import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, realpathSync } from 'node:fs'
import { copyFile, mkdir, rename, stat, unlink, utimes } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { backup as sqliteBackup } from 'node:sqlite'
import type { BackupProgress, BackupStatus, BackupTargetInfo } from '@shared/types'
import { EtaEstimator } from '../eta'
import { sha256File } from '../media/hash'
import { errorMessage } from '../util'
import { LIBRARY_MARKER, type Library } from './library'
import { SIDECAR_EXT } from './metadataExport'

const TMP_DIR = '.photovault-tmp'
const DISPLACED_DIR = '.photovault-displaced'

interface TargetRow {
  id: number
  path: string
  auto: number
  created_at: string
  last_run_at: string | null
  last_completed_at: string | null
  last_verified_at: string | null
  last_error: string | null
  label: string | null
}

interface FileRow {
  id: number
  relative_path: string
  sha256: string
  size_bytes: number
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel))
}

function accessible(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Keeps verified second copies of the library on other drives/folders. A target mirrors the library
 * layout (originals/…) plus a database snapshot and the library marker, so if the main drive dies the
 * backup folder can be opened directly in Photo Vault ("Open another library…").
 *
 * Safety: every copy is written to a temp file, hashed, and only then moved into place; nothing in a
 * target is ever overwritten (a stray different file at a destination is moved aside, not replaced),
 * and nothing is deleted from a target automatically — items deleted from the library stay in the backup.
 */
export class BackupService {
  private abort: AbortController | null = null
  private progress: BackupProgress | null = null
  private lastEmit = 0

  constructor(
    private readonly library: Library,
    private readonly hooks: { onProgress?: (p: BackupProgress) => void } = {}
  ) {}

  current(): BackupProgress | null {
    return this.progress ? { ...this.progress } : null
  }

  private emit(force = false): void {
    if (!this.progress) return
    const now = Date.now()
    if (!force && now - this.lastEmit < 150) return
    this.lastEmit = now
    this.hooks.onProgress?.({ ...this.progress })
  }

  addTarget(path: string): BackupTargetInfo {
    if (!accessible(resolve(path))) throw new Error('That folder does not exist or is not reachable.')
    const target = realpathSync.native(resolve(path)) // canonical form, so "inside the library" checks are reliable
    if (isInside(target, this.library.root) || isInside(this.library.root, target)) {
      throw new Error('A backup must be outside the library folder (ideally on another drive).')
    }
    const markerPath = join(target, LIBRARY_MARKER)
    if (existsSync(markerPath)) {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { id?: string }
      if (marker.id !== this.library.id) throw new Error('That folder already contains a different Photo Vault library.')
    } else if (readdirSync(target).filter((n) => !n.startsWith('.') && n !== 'System Volume Information' && n !== '$RECYCLE.BIN').length > 0) {
      // Never mix with unrelated files: use a dedicated sub-folder.
      return this.addTarget(this.ensureSubfolder(target))
    }
    const now = new Date().toISOString()
    this.library.db.run('INSERT OR IGNORE INTO backup_targets (path, auto, created_at) VALUES (?, 1, ?)', [target, now])
    this.library.logger.info('backup.target_added', { path: target })
    return this.status().targets.find((t) => t.path === target) as BackupTargetInfo
  }

  private ensureSubfolder(parent: string): string {
    const sub = join(parent, 'Photo Vault Backup')
    mkdirSync(sub, { recursive: true })
    return sub
  }

  /**
   * A library opened from its own backup drive (the original was lost) still lists that drive as its backup target, so
   * every item would look protected by a copy that is the library itself. Such targets are forgotten (their copy
   * records go with them), so the app says plainly that there is no second copy yet. Returns how many were forgotten.
   */
  forgetTargetsInsideLibrary(): number {
    const canon = (p: string): string => {
      try {
        return realpathSync.native(resolve(p))
      } catch {
        return resolve(p)
      }
    }
    let n = 0
    for (const t of this.library.db.all<{ id: number; path: string }>('SELECT id, path FROM backup_targets')) {
      const p = canon(t.path)
      if (p === this.library.root || isInside(p, this.library.root) || isInside(this.library.root, p)) {
        this.removeTarget(t.id)
        this.library.logger.warn('backup.target_is_library', { path: t.path })
        n++
      }
    }
    return n
  }

  /** Forgets a target. Its files are left exactly where they are. */
  removeTarget(id: number): void {
    this.library.db.run('DELETE FROM backup_targets WHERE id = ?', [id])
  }

  setLabel(id: number, label: string | null): void {
    this.library.db.run('UPDATE backup_targets SET label = ? WHERE id = ?', [label?.trim().slice(0, 60) || null, id])
  }

  setAuto(id: number, auto: boolean): void {
    this.library.db.run('UPDATE backup_targets SET auto = ? WHERE id = ?', [auto ? 1 : 0, id])
  }

  status(): BackupStatus {
    const db = this.library.db
    const loc = this.library.managedLocationId
    const totals = db.get<{ files: number; bytes: number | null; assets: number }>(
      `SELECT COUNT(*) AS files, SUM(f.size_bytes) AS bytes, COUNT(DISTINCT f.asset_id) AS assets
         FROM files f JOIN assets a ON a.id = f.asset_id WHERE f.storage_location_id = ?`,
      [loc]
    )
    const targets = db.all<TargetRow>('SELECT * FROM backup_targets ORDER BY id').map((t) => {
      const c = db.get<{ ok: number; bad: number; bytes: number | null }>(
        `SELECT SUM(b.status = 'ok') AS ok, SUM(b.status <> 'ok') AS bad, SUM(CASE WHEN b.status = 'ok' THEN b.size_bytes ELSE 0 END) AS bytes
           FROM backup_files b JOIN files f ON f.id = b.file_id WHERE b.target_id = ? AND f.sha256 = b.sha256`,
        [t.id]
      )
      const missing =
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM assets a WHERE a.trashed_at IS NULL AND NOT EXISTS (
             SELECT 1 FROM files f JOIN backup_files b ON b.file_id = f.id AND b.target_id = ? AND b.status = 'ok' AND b.sha256 = f.sha256
              WHERE f.asset_id = a.id AND f.storage_location_id = ?)`,
          [t.id, loc]
        )?.n ?? 0
      return {
        id: t.id,
        path: t.path,
        label: t.label ?? null,
        missingAssets: missing,
        auto: t.auto === 1,
        reachable: accessible(t.path),
        filesBackedUp: c?.ok ?? 0,
        filesWithProblems: c?.bad ?? 0,
        bytesBackedUp: c?.bytes ?? 0,
        lastRunAt: t.last_run_at,
        lastCompletedAt: t.last_completed_at,
        lastVerifiedAt: t.last_verified_at,
        lastError: t.last_error
      }
    })
    const protectedAssets =
      db.get<{ n: number }>(
        `SELECT COUNT(DISTINCT f.asset_id) AS n FROM files f JOIN backup_files b ON b.file_id = f.id AND b.status = 'ok' AND b.sha256 = f.sha256
          WHERE f.storage_location_id = ?`,
        [loc]
      )?.n ?? 0
    const lastCheck = db.get<{ t: string | null }>("SELECT MAX(completed_at) AS t FROM verifications WHERE status = 'completed'")?.t ?? null
    return { lastLibraryCheck: lastCheck, totalFiles: totals?.files ?? 0, totalBytes: totals?.bytes ?? 0, totalAssets: totals?.assets ?? 0, protectedAssets, targets }
  }

  /** Copies every original that the target does not have yet (verified), then refreshes the database snapshot. */
  async run(targetId: number, opts: { verifyAll?: boolean } = {}): Promise<BackupProgress> {
    if (this.progress?.status === 'running') throw new Error('A backup is already running.')
    const db = this.library.db
    const t = db.get<TargetRow>('SELECT * FROM backup_targets WHERE id = ?', [targetId])
    if (!t) throw new Error('Unknown backup location.')
    const now = new Date().toISOString()
    db.run('UPDATE backup_targets SET last_run_at = ?, last_error = NULL WHERE id = ?', [now, targetId])

    const verifyAll = opts.verifyAll === true
    const todo = db.all<FileRow>(
      verifyAll
        ? `SELECT f.id, f.relative_path, f.sha256, f.size_bytes FROM files f WHERE f.storage_location_id = ? ORDER BY f.id`
        : `SELECT f.id, f.relative_path, f.sha256, f.size_bytes FROM files f
             LEFT JOIN backup_files b ON b.file_id = f.id AND b.target_id = ?
            WHERE f.storage_location_id = ? AND (b.file_id IS NULL OR b.status <> 'ok' OR b.sha256 <> f.sha256)
            ORDER BY f.id`,
      verifyAll ? [this.library.managedLocationId] : [targetId, this.library.managedLocationId]
    )
    this.abort = new AbortController()
    const signal = this.abort.signal
    const p: BackupProgress = {
      targetId,
      mode: verifyAll ? 'verify' : 'copy',
      status: 'running',
      filesTotal: todo.length,
      filesDone: 0,
      bytesTotal: todo.reduce((s, f) => s + f.size_bytes, 0),
      bytesDone: 0,
      copied: 0,
      alreadyThere: 0,
      failed: 0,
      etaSeconds: null,
      rate: null,
      error: null
    }
    this.progress = p
    this.emit(true)
    const eta = new EtaEstimator()

    try {
      if (!accessible(t.path)) throw new Error(`The backup location is not reachable: ${t.path} (is the drive connected?)`)
      // The backup is a self-contained library: marker + README first.
      writeFileSync(join(t.path, LIBRARY_MARKER), readFileSync(join(this.library.root, LIBRARY_MARKER)))
      if (existsSync(join(this.library.root, 'README.txt'))) copyFileSync(join(this.library.root, 'README.txt'), join(t.path, 'README.txt'))
      await mkdir(join(t.path, TMP_DIR), { recursive: true })

      for (const f of todo) {
        signal.throwIfAborted()
        try {
          const outcome = await this.copyOne(t.path, f)
          db.run(
            `INSERT INTO backup_files (target_id, file_id, relative_path, sha256, size_bytes, copied_at, verified_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'ok')
             ON CONFLICT (target_id, file_id) DO UPDATE SET relative_path = excluded.relative_path, sha256 = excluded.sha256,
               size_bytes = excluded.size_bytes, copied_at = COALESCE(excluded.copied_at, backup_files.copied_at),
               verified_at = excluded.verified_at, status = 'ok'`,
            [targetId, f.id, f.relative_path, f.sha256, f.size_bytes, outcome === 'copied' ? new Date().toISOString() : null, new Date().toISOString()]
          )
          if (outcome === 'copied') p.copied++
          else p.alreadyThere++
        } catch (err) {
          if (signal.aborted) throw err
          p.failed++
          db.run(
            `INSERT INTO backup_files (target_id, file_id, relative_path, sha256, size_bytes, status) VALUES (?, ?, ?, ?, ?, 'missing')
             ON CONFLICT (target_id, file_id) DO UPDATE SET status = 'missing'`,
            [targetId, f.id, f.relative_path, f.sha256, f.size_bytes]
          )
          this.library.logger.error('backup.file_failed', { target: t.path, file: f.relative_path, error: errorMessage(err) })
        }
        p.filesDone++
        p.bytesDone += f.size_bytes
        const e = eta.update(p.bytesDone, p.bytesTotal)
        p.etaSeconds = e.etaSeconds
        p.rate = e.rate
        this.emit()
      }

      // Metadata outside the app (D96): every original's XMP sidecar and the metadata/ folder, so the backup drive alone
      // is a complete archive any photo program can read.
      await this.copyMetadata(t.path, signal)

      // Catalogue snapshot into the backup (consistent copy via the SQLite backup API).
      await mkdir(join(t.path, 'database'), { recursive: true })
      const tmpDb = join(t.path, TMP_DIR, `photovault-${randomUUID()}.db`)
      await sqliteBackup(this.library.db.raw, tmpDb)
      await rename(tmpDb, join(t.path, 'database', 'photovault.db'))
      for (const extra of ['photovault.db-wal', 'photovault.db-shm']) await unlink(join(t.path, 'database', extra)).catch(() => undefined)

      p.status = 'completed'
      const done = new Date().toISOString()
      db.run(`UPDATE backup_targets SET last_completed_at = ?${verifyAll ? ', last_verified_at = ?' : ''} WHERE id = ?`, verifyAll ? [done, done, targetId] : [done, targetId])
    } catch (err) {
      p.status = signal.aborted ? 'cancelled' : 'failed'
      p.error = signal.aborted ? null : errorMessage(err)
      db.run('UPDATE backup_targets SET last_error = ? WHERE id = ?', [p.error, targetId])
    }
    this.library.logger.info('backup.finished', { target: t.path, ...p })
    this.emit(true)
    const result = { ...p }
    this.progress = null
    return result
  }

  /** Copies (or, when verifying, re-checks) one original. Never overwrites a different file. */
  /** Copies sidecars and metadata/ files that are new or changed (by size and modification time). */
  private async copyMetadata(targetRoot: string, signal: AbortSignal): Promise<void> {
    const changed = async (src: string, dest: string): Promise<boolean> => {
      const a = await stat(src).catch(() => null)
      if (!a) return false
      const b = await stat(dest).catch(() => null)
      return !b || b.size !== a.size || Math.abs(b.mtimeMs - a.mtimeMs) > 2000
    }
    const copyIfChanged = async (rel: string[]): Promise<void> => {
      const src = join(this.library.root, ...rel)
      const dest = join(targetRoot, ...rel)
      if (!(await changed(src, dest))) return
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(src, dest)
      const s = await stat(src)
      await utimes(dest, s.atime, s.mtime) // keeps the next comparison exact
    }
    let copied = 0
    const files = this.library.db.all<{ relative_path: string }>("SELECT relative_path FROM files WHERE storage_location_id = ? AND role = 'original'", [
      this.library.managedLocationId
    ])
    try {
      for (const f of files) {
        signal.throwIfAborted()
        const parts = (f.relative_path + SIDECAR_EXT).split('/')
        if (!existsSync(join(this.library.root, ...parts))) continue
        await copyIfChanged(parts)
        copied++
      }
      const metaDir = join(this.library.root, 'metadata')
      if (existsSync(metaDir)) for (const name of readdirSync(metaDir)) if (!name.includes('.tmp-')) await copyIfChanged(['metadata', name])
    } catch (err) {
      if (signal.aborted) throw err
      this.library.logger.warn('backup.metadata_failed', { target: targetRoot, error: errorMessage(err) })
    }
    this.library.logger.info('backup.metadata', { target: targetRoot, sidecars: copied })
  }

  private async copyOne(targetRoot: string, f: FileRow): Promise<'copied' | 'present'> {
    const src = join(this.library.root, ...f.relative_path.split('/'))
    const dest = join(targetRoot, ...f.relative_path.split('/'))
    if (existsSync(dest)) {
      // A file already there is only relied on if its bytes match (checked by hash).
      if ((await stat(dest)).size === f.size_bytes && (await sha256File(dest)) === f.sha256) return 'present'
      // Something different is at this path (e.g. a deleted item's old file): move it aside, never overwrite.
      const aside = join(targetRoot, DISPLACED_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}`, ...f.relative_path.split('/'))
      await mkdir(dirname(aside), { recursive: true })
      await rename(dest, aside)
    }
    if (!existsSync(src)) throw new Error(`Original missing in the library: ${f.relative_path}`)
    const tmp = join(targetRoot, TMP_DIR, `${f.sha256.slice(0, 16)}-${randomUUID()}.part`)
    try {
      await copyFile(src, tmp)
      if ((await sha256File(tmp)) !== f.sha256) throw new Error(`Copy verification failed for ${f.relative_path}`)
      const st = await stat(src)
      await utimes(tmp, st.atime, st.mtime)
      await mkdir(dirname(dest), { recursive: true })
      await rename(tmp, dest)
    } catch (err) {
      await unlink(tmp).catch(() => undefined)
      throw err
    }
    return 'copied'
  }

  cancel(): void {
    this.abort?.abort()
  }

  /** Targets that should run automatically now (reachable, auto enabled). */
  autoTargets(): number[] {
    return this.status()
      .targets.filter((t) => t.auto && t.reachable)
      .map((t) => t.id)
  }
}
