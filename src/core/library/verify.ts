import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { VerifyIssue, VerifyProgress } from '@shared/types'
import { sha256File } from '../media/hash'
import { EtaEstimator } from '../eta'
import { errorMessage, mapPool } from '../util'
import type { Library } from './library'

interface FileRow {
  id: number
  asset_id: number
  relative_path: string
  sha256: string
  size_bytes: number
}

/**
 * Re-hashes every original in managed storage and compares it with the SHA-256 recorded at import.
 * Strictly read-only on disk: it only updates verification fields in the database
 * (files.verified_at / verify_status / missing_since) and logs a `verifications` row.
 */
export class VerifyService {
  private abort: AbortController | null = null
  private progress: VerifyProgress | null = null
  private task: Promise<void> | null = null
  private lastEmit = 0

  constructor(
    private readonly library: Library,
    private readonly hooks: { onProgress?: (p: VerifyProgress) => void; concurrency?: number } = {}
  ) {}

  current(): VerifyProgress | null {
    return this.progress ? { ...this.progress } : lastVerification(this.library)
  }

  private emit(force = false): void {
    if (!this.progress) return
    const now = Date.now()
    if (!force && now - this.lastEmit < 150) return
    this.lastEmit = now
    this.hooks.onProgress?.({ ...this.progress })
  }

  start(): VerifyProgress {
    if (this.progress?.status === 'running') return { ...this.progress }
    const db = this.library.db
    const totals = db.get<{ n: number; bytes: number | null }>('SELECT COUNT(*) AS n, SUM(size_bytes) AS bytes FROM files WHERE storage_location_id = ?', [
      this.library.managedLocationId
    ])
    const startedAt = new Date().toISOString()
    const id = db.run("INSERT INTO verifications (started_at, status, files_total) VALUES (?, 'running', ?)", [startedAt, totals?.n ?? 0]).lastInsertRowid
    this.abort = new AbortController()
    this.progress = {
      id,
      status: 'running',
      startedAt,
      completedAt: null,
      filesTotal: totals?.n ?? 0,
      bytesTotal: totals?.bytes ?? 0,
      filesChecked: 0,
      bytesChecked: 0,
      ok: 0,
      missing: 0,
      mismatched: 0,
      error: null
    }
    this.library.logger.info('verify.started', { id, files: this.progress.filesTotal })
    this.task = this.run(this.progress, this.abort.signal)
    this.emit(true)
    return { ...this.progress }
  }

  private async run(p: VerifyProgress, signal: AbortSignal): Promise<void> {
    const db = this.library.db
    const eta = new EtaEstimator()
    try {
      let lastId = 0
      for (;;) {
        signal.throwIfAborted()
        const rows = db.all<FileRow>(
          'SELECT id, asset_id, relative_path, sha256, size_bytes FROM files WHERE storage_location_id = ? AND id > ? ORDER BY id LIMIT 64',
          [this.library.managedLocationId, lastId]
        )
        if (rows.length === 0) break
        lastId = rows[rows.length - 1]!.id
        const results = await mapPool(
          rows,
          this.hooks.concurrency ?? 2,
          async (f) => {
            const abs = join(this.library.root, ...f.relative_path.split('/'))
            let status: 'ok' | 'missing' | 'mismatch'
            try {
              await stat(abs)
            } catch {
              return { f, status: 'missing' as const }
            }
            const actual = await sha256File(abs, signal)
            status = actual === f.sha256 ? 'ok' : 'mismatch'
            return { f, status }
          },
          signal
        )
        const now = new Date().toISOString()
        db.tx(() => {
          for (const { f, status } of results) {
            if (status === 'ok') {
              db.run("UPDATE files SET verified_at = ?, verify_status = 'ok', missing_since = NULL WHERE id = ?", [now, f.id])
              p.ok++
            } else if (status === 'missing') {
              db.run("UPDATE files SET verify_status = 'missing', missing_since = COALESCE(missing_since, ?) WHERE id = ?", [now, f.id])
              p.missing++
              this.library.logger.warn('verify.missing', { fileId: f.id, path: f.relative_path })
            } else {
              db.run("UPDATE files SET verify_status = 'mismatch' WHERE id = ?", [f.id])
              p.mismatched++
              this.library.logger.error('verify.mismatch', { fileId: f.id, path: f.relative_path, expected: f.sha256 })
            }
            p.filesChecked++
            p.bytesChecked += f.size_bytes
          }
          const e = eta.update(p.bytesChecked, p.bytesTotal)
          p.etaSeconds = e.etaSeconds
          p.rate = e.rate
          db.run('UPDATE verifications SET files_checked = ?, ok = ?, missing = ?, mismatched = ?, bytes_checked = ? WHERE id = ?', [
            p.filesChecked,
            p.ok,
            p.missing,
            p.mismatched,
            p.bytesChecked,
            p.id
          ])
        })
        this.emit()
      }
      p.status = 'completed'
    } catch (err) {
      p.status = signal.aborted ? 'cancelled' : 'failed'
      p.error = signal.aborted ? null : errorMessage(err)
    }
    p.completedAt = new Date().toISOString()
    try {
      db.run('UPDATE verifications SET status = ?, completed_at = ?, error = ? WHERE id = ?', [p.status, p.completedAt, p.error, p.id])
    } catch {
      // database already closed (shutdown); the run is marked interrupted on next open
    }
    this.library.logger.info('verify.finished', { ...p })
    this.emit(true)
  }

  cancel(): void {
    this.abort?.abort()
  }

  async settle(): Promise<void> {
    await this.task
  }
}

export function lastVerification(library: Library): VerifyProgress | null {
  const r = library.db.get<{
    id: number
    status: VerifyProgress['status']
    started_at: string
    completed_at: string | null
    files_total: number
    files_checked: number
    ok: number
    missing: number
    mismatched: number
    bytes_checked: number
    error: string | null
  }>('SELECT * FROM verifications ORDER BY id DESC LIMIT 1')
  if (!r) return null
  return {
    id: r.id,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    filesTotal: r.files_total,
    bytesTotal: r.bytes_checked,
    filesChecked: r.files_checked,
    bytesChecked: r.bytes_checked,
    ok: r.ok,
    missing: r.missing,
    mismatched: r.mismatched,
    error: r.error
  }
}

/** Files whose last verification found them missing or changed. */
export function verifyIssues(library: Library, offset: number, limit: number): VerifyIssue[] {
  return library.db
    .all<{ id: number; asset_id: number; relative_path: string; verify_status: 'missing' | 'mismatch'; sha256: string; missing_since: string | null }>(
      `SELECT id, asset_id, relative_path, verify_status, sha256, missing_since FROM files
        WHERE storage_location_id = ? AND verify_status IN ('missing', 'mismatch') ORDER BY relative_path LIMIT ? OFFSET ?`,
      [library.managedLocationId, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)]
    )
    .map((r) => ({
      fileId: r.id,
      assetId: r.asset_id,
      relativePath: r.relative_path,
      status: r.verify_status,
      expectedSha256: r.sha256,
      missingSince: r.missing_since
    }))
}
