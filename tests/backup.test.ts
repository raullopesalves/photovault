import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '@core/db/database'
import { migrations, runMigrations } from '@core/db/migrations'
import { BackupService } from '@core/library/backup'
import { listSnapshots, snapshotDatabase } from '@core/library/dbSnapshots'
import { Library } from '@core/library/library'
import { sha256File } from '@core/media/hash'
import { makeJpeg, openLibrary, runImport, sandbox, type Sandbox } from './helpers'

let sb: Sandbox
let lib: Library
beforeEach(() => {
  sb = sandbox()
  lib = openLibrary(sb.libraryRoot)
})
afterEach(() => {
  lib.close()
  sb.cleanup()
})

async function importSome(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await makeJpeg(join(sb.source, `p${i}.jpg`), { color: `#${i}${i}a0${i}${i}`, dateTimeOriginal: `2021:0${i + 1}:01 10:00:00` })
  await runImport(lib, sb.source)
}

describe('mirror backup', () => {
  it('copies every original verified, makes an openable library copy, and is incremental', async () => {
    await importSome(3)
    const target = join(sb.dir, 'E-drive')
    mkdirSync(target)
    const svc = new BackupService(lib)
    const t = svc.addTarget(target)
    expect(t.reachable).toBe(true)

    const r1 = await svc.run(t.id)
    expect(r1).toMatchObject({ status: 'completed', copied: 3, failed: 0 })
    expect(svc.status()).toMatchObject({ totalAssets: 3, protectedAssets: 3 })
    for (const f of lib.db.all<{ relative_path: string; sha256: string }>('SELECT relative_path, sha256 FROM files')) {
      expect(await sha256File(join(target, ...f.relative_path.split('/')))).toBe(f.sha256)
    }
    // The backup folder opens as a library with the same contents.
    const copy = Library.open(target)
    expect(copy.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM assets')?.n).toBe(3)
    // Opened as the library (the original was lost), it is not its own backup: no item counts as protected.
    const copySvc = new BackupService(copy)
    expect(copySvc.status()).toMatchObject({ protectedAssets: 3 })
    expect(copySvc.forgetTargetsInsideLibrary()).toBe(1)
    expect(copySvc.status()).toMatchObject({ totalAssets: 3, protectedAssets: 0, targets: [] })
    copy.close()

    const r2 = await svc.run(t.id)
    expect(r2).toMatchObject({ copied: 0, filesTotal: 0 })

    // New import → only the new file is copied.
    await makeJpeg(join(sb.source, 'p9.jpg'), { color: '#999999' })
    await runImport(lib, sb.source)
    expect((await svc.run(t.id)).copied).toBe(1)
  })

  it('verify re-checks every copy and repairs missing or damaged ones; never overwrites a different file', async () => {
    await importSome(2)
    const target = join(sb.dir, 'backup')
    mkdirSync(target)
    const svc = new BackupService(lib)
    const t = svc.addTarget(target)
    const files = lib.db.all<{ relative_path: string }>('SELECT relative_path FROM files ORDER BY id')
    // A stray, different file already sits where the first original will go.
    const strayPath = join(target, ...files[0]!.relative_path.split('/'))
    mkdirSync(join(strayPath, '..'), { recursive: true })
    writeFileSync(strayPath, 'not the photo')
    const r = await svc.run(t.id)
    expect(r.copied).toBe(2)
    const displaced = readdirSync(join(target, '.photovault-displaced'), { recursive: true }).map(String).filter((p) => p.endsWith('.jpg'))
    expect(displaced).toHaveLength(1)
    expect(readFileSync(join(target, '.photovault-displaced', displaced[0]!), 'utf8')).toBe('not the photo')

    // Damage the backup: delete one copy, corrupt the other.
    rmSync(join(target, ...files[0]!.relative_path.split('/')))
    writeFileSync(join(target, ...files[1]!.relative_path.split('/')), 'bit rot')
    const v = await svc.run(t.id, { verifyAll: true })
    expect(v).toMatchObject({ status: 'completed', copied: 2, alreadyThere: 0, failed: 0 })
    for (const f of lib.db.all<{ relative_path: string; sha256: string }>('SELECT relative_path, sha256 FROM files')) {
      expect(await sha256File(join(target, ...f.relative_path.split('/')))).toBe(f.sha256)
    }
  })

  it('refuses unsafe locations and uses a sub-folder inside non-empty folders', async () => {
    const svc = new BackupService(lib)
    expect(() => svc.addTarget(join(sb.libraryRoot, 'originals'))).toThrow(/outside the library/)
    const other = Library.create(join(sb.dir, 'other-lib'))
    other.close()
    expect(() => svc.addTarget(join(sb.dir, 'other-lib'))).toThrow(/different Photo Vault library/)
    const busy = join(sb.dir, 'busy')
    mkdirSync(busy)
    writeFileSync(join(busy, 'notes.txt'), 'x')
    expect(svc.addTarget(busy).path).toBe(join(busy, 'Photo Vault Backup'))
  })

  it('reports an unreachable location instead of failing silently', async () => {
    await importSome(1)
    const target = join(sb.dir, 'usb')
    mkdirSync(target)
    const svc = new BackupService(lib)
    const t = svc.addTarget(target)
    rmSync(target, { recursive: true })
    const r = await svc.run(t.id)
    expect(r.status).toBe('failed')
    expect(r.error).toMatch(/not reachable/)
    expect(svc.status().targets[0]).toMatchObject({ reachable: false })
  })
})

describe('database snapshots', () => {
  it('takes consistent, openable snapshots and keeps the newest 10', async () => {
    await importSome(1)
    for (let i = 0; i < 12; i++) await snapshotDatabase(lib, 'manual')
    const snaps = listSnapshots(lib)
    expect(snaps).toHaveLength(10)
    const db = new DatabaseSync(snaps[0]!.path, { readOnly: true })
    expect((db.prepare('SELECT COUNT(*) AS n FROM assets').get() as { n: number }).n).toBe(1)
    db.close()
  })

  it('copies the database before a schema upgrade', () => {
    const dir = join(sb.dir, 'old')
    mkdirSync(dir)
    const v1 = new Database(new DatabaseSync(join(dir, 'photovault.db')))
    runMigrations(v1, migrations.slice(0, 1))
    v1.close()
    const upgraded = Database.open(join(dir, 'photovault.db'), { preMigrationBackupDir: join(dir, 'backups') })
    upgraded.close()
    const copies = readdirSync(join(dir, 'backups'))
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatch(/^photovault-v1-before-upgrade-/)
  })
})
