import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { backup } from 'node:sqlite'
import type { DbSnapshot } from '@shared/types'
import type { Library } from './library'

export type SnapshotReason = 'daily' | 'import' | 'before-delete' | 'manual'

/** Automatic snapshots kept (pre-upgrade copies are kept separately, the newest 5). */
const KEEP = 10
const KEEP_UPGRADE = 5

export function snapshotDir(library: Library): string {
  return join(library.paths.database, 'backups')
}

/** Consistent online copy of the catalogue (SQLite backup API), then pruning of old snapshots. */
export async function snapshotDatabase(library: Library, reason: SnapshotReason): Promise<string> {
  const dir = snapshotDir(library)
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `photovault-${stamp}-${reason}.db`)
  await backup(library.db.raw, file)
  prune(dir)
  library.logger.info('db.snapshot', { reason, file })
  return file
}

function prune(dir: string): void {
  const files = readdirSync(dir).filter((f) => f.endsWith('.db'))
  const upgrade = files.filter((f) => f.includes('before-upgrade')).sort().reverse()
  const auto = files.filter((f) => !f.includes('before-upgrade')).sort().reverse()
  for (const f of [...auto.slice(KEEP), ...upgrade.slice(KEEP_UPGRADE)]) {
    try {
      unlinkSync(join(dir, f))
    } catch {
      // in use or already gone
    }
  }
}

export function listSnapshots(library: Library): DbSnapshot[] {
  const dir = snapshotDir(library)
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.db'))
  } catch {
    return []
  }
  return names
    .map((name) => {
      const st = statSync(join(dir, name))
      const reason = /before-upgrade/.test(name) ? 'before-upgrade' : /before-restore/.test(name) ? 'before-restore' : (/-(daily|import|before-delete|manual)\.db$/.exec(name)?.[1] ?? 'unknown')
      return { name, path: join(dir, name), sizeBytes: st.size, createdAt: st.mtime.toISOString(), reason }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Puts a catalogue snapshot back in place of the current catalogue. The library must be closed. The current
 * catalogue is kept first (`…-before-restore.db`), so a restore can itself be undone. Original files are not
 * touched; items imported after the snapshot are still on disk and come back with a re-import of their source.
 */
export function restoreSnapshotFile(libraryRoot: string, snapshotName: string): string {
  const dir = join(libraryRoot, 'database', 'backups')
  if (!/^[\w.-]+\.db$/.test(snapshotName)) throw new Error('Invalid snapshot name')
  const snap = join(dir, snapshotName)
  if (!existsSync(snap)) throw new Error('That catalogue copy no longer exists.')
  const db = join(libraryRoot, 'database', 'photovault.db')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const keep = join(dir, `photovault-${stamp}-before-restore.db`)
  copyFileSync(db, keep)
  for (const extra of ['-wal', '-shm']) rmSync(`${db}${extra}`, { force: true })
  copyFileSync(snap, db)
  return keep
}

/** Takes a 'daily' snapshot when the newest automatic one is older than ~20 hours. */
export async function maybeDailySnapshot(library: Library): Promise<string | null> {
  const newest = listSnapshots(library).find((s) => s.reason !== 'before-upgrade')
  if (newest && Date.now() - Date.parse(newest.createdAt) < 20 * 3600_000) return null
  return snapshotDatabase(library, 'daily')
}
