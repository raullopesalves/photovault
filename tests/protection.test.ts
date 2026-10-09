import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupService } from '@core/library/backup'
import { listSnapshots, restoreSnapshotFile, snapshotDatabase } from '@core/library/dbSnapshots'
import { Library } from '@core/library/library'
import { createAlbum, listAlbums } from '@core/repo/albums'
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

describe('rotating backup drives', () => {
  it('knows how far behind each drive is and names it', async () => {
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#111111' })
    await runImport(lib, sb.source)
    const drive = join(sb.dir, 'drive-a')
    mkdirSync(drive)
    const svc = new BackupService(lib)
    const t = svc.addTarget(drive)
    expect(svc.status().targets[0]).toMatchObject({ missingAssets: 1, label: null })
    await svc.run(t.id)
    expect(svc.status().targets[0]!.missingAssets).toBe(0)
    svc.setLabel(t.id, '  Drive at home ')
    expect(svc.status().targets[0]!.label).toBe('Drive at home')

    await makeJpeg(join(sb.dir, 'more', 'b.jpg'), { color: '#222222' })
    await runImport(lib, join(sb.dir, 'more'))
    expect(svc.status().targets[0]!.missingAssets).toBe(1) // the new photo is not on this drive yet
    expect(svc.status().lastLibraryCheck).toBeNull()
  })
})

describe('catalogue restore', () => {
  it('puts a snapshot back and keeps the current catalogue so the restore can be undone', async () => {
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#111111' })
    await runImport(lib, sb.source)
    createAlbum(lib, 'Before')
    await snapshotDatabase(lib, 'manual')
    createAlbum(lib, 'After')
    const root = lib.root
    const snap = listSnapshots(lib).find((s) => s.reason === 'manual')!
    lib.close()

    const kept = restoreSnapshotFile(root, snap.name)
    lib = Library.open(root)
    expect(listAlbums(lib).map((a) => a.name)).toEqual(['Before'])
    expect(listSnapshots(lib).some((s) => s.reason === 'before-restore')).toBe(true)
    lib.close()

    // Undo: restore the copy taken just before.
    restoreSnapshotFile(root, kept.split(/[\\/]/).pop()!)
    lib = Library.open(root)
    expect(listAlbums(lib).map((a) => a.name).sort()).toEqual(['After', 'Before'])
    expect(() => restoreSnapshotFile(root, '../evil.db')).toThrow(/Invalid/)
  })
})
