import { readdirSync, statSync, unlinkSync, mkdirSync } from 'node:fs'
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
      const reason = /before-upgrade/.test(name) ? 'before-upgrade' : (/-(daily|import|before-delete|manual)\.db$/.exec(name)?.[1] ?? 'unknown')
      return { name, path: join(dir, name), sizeBytes: st.size, createdAt: st.mtime.toISOString(), reason }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Takes a 'daily' snapshot when the newest automatic one is older than ~20 hours. */
export async function maybeDailySnapshot(library: Library): Promise<string | null> {
  const newest = listSnapshots(library).find((s) => s.reason !== 'before-upgrade')
  if (newest && Date.now() - Date.parse(newest.createdAt) < 20 * 3600_000) return null
  return snapshotDatabase(library, 'daily')
}
