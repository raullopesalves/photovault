import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Library } from '@core/library/library'
import { binIds, deletePermanently, forgetDeleted, moveToBin, restoreFromBin } from '@core/library/bin'
import { sha256File } from '@core/media/hash'
import { createAlbum, getAlbum } from '@core/repo/albums'
import { facets } from '@core/repo/filters'
import { assetIdsInRange, libraryInfo, timeline } from '@core/repo/queries'
import { ThumbnailQueue } from '@core/thumbnails/thumbnails'
import { count, makeJpeg, managedFiles, openLibrary, runImport, sandbox, type Sandbox } from './helpers'

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

const total = (q?: Parameters<typeof timeline>[1]): number => timeline(lib, q).reduce((s, g) => s + g.count, 0)
const idOf = (name: string): number => lib.db.get<{ id: number }>('SELECT id FROM assets WHERE original_filename = ?', [name])!.id

describe('Bin', () => {
  it('binned items disappear from every view and come back on restore', async () => {
    for (let i = 0; i < 3; i++) await makeJpeg(join(sb.source, `b${i}.jpg`), { color: `#${i}0${i}0${i}0`, dateTimeOriginal: `2020:0${i + 1}:01 10:00:00` })
    await runImport(lib, sb.source)
    const album = createAlbum(lib, 'Trip', [idOf('b0.jpg'), idOf('b1.jpg')])

    expect(moveToBin(lib, [idOf('b0.jpg')])).toBe(1)
    expect(total()).toBe(2)
    expect(total({ trash: 'only' })).toBe(1)
    expect(total({ albumId: album.id })).toBe(1)
    expect(getAlbum(lib, album.id)?.count).toBe(1)
    expect(facets(lib).years.reduce((s, y) => s + y.count, 0)).toBe(2)
    expect(libraryInfo(lib)).toMatchObject({ assetCount: 2, binCount: 1 })
    expect(assetIdsInRange(lib, { trash: 'only' }, 0, 10)).toEqual([idOf('b0.jpg')])

    expect(restoreFromBin(lib, binIds(lib))).toBe(1)
    expect(total()).toBe(3)
    expect(getAlbum(lib, album.id)?.count).toBe(2)
  })

  it('permanently deletes only binned items, removes the managed file and thumbnails, never the source', async () => {
    await makeJpeg(join(sb.source, 'keep.jpg'), { color: '#112233' })
    const gone = await makeJpeg(join(sb.source, 'gone.jpg'), { color: '#332211' })
    const sourceHash = await sha256File(gone)
    await runImport(lib, sb.source)
    await new ThumbnailQueue(lib).drain()
    const goneId = idOf('gone.jpg')
    createAlbum(lib, 'A', [goneId])

    // Not in the Bin yet: refused.
    expect((await deletePermanently(lib, [goneId])).deleted).toBe(0)
    expect(managedFiles(lib)).toEqual(['undated/gone.jpg', 'undated/keep.jpg'])

    moveToBin(lib, [goneId])
    const removed: string[] = []
    const r = await deletePermanently(lib, [goneId], {
      removeFile: async (p) => {
        removed.push(p)
        const { unlink } = await import('node:fs/promises')
        await unlink(p)
      }
    })
    expect(r).toMatchObject({ deleted: 1, failed: 0 })
    expect(removed).toHaveLength(1)
    expect(managedFiles(lib)).toEqual(['undated/keep.jpg'])
    expect(count(lib, 'assets')).toBe(1)
    expect(count(lib, 'files')).toBe(1)
    expect(count(lib, 'album_assets')).toBe(0)
    expect(lib.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM asset_thumbnails WHERE asset_id = ?', [goneId])?.n).toBe(0)
    const thumbFiles = readdirSync(lib.paths.thumbnails, { recursive: true }).filter((f) => String(f).endsWith('.webp'))
    expect(thumbFiles).toHaveLength(1)
    // The source is untouched.
    expect(existsSync(gone)).toBe(true)
    expect(await sha256File(gone)).toBe(sourceHash)
    expect(statSync(gone).size).toBeGreaterThan(0)
    expect(libraryInfo(lib).deletedCount).toBe(1)
  })

  it('keeps an item in the Bin if its file cannot be removed', async () => {
    await makeJpeg(join(sb.source, 'stuck.jpg'), { color: '#445566' })
    await runImport(lib, sb.source)
    const id = idOf('stuck.jpg')
    moveToBin(lib, [id])
    const r = await deletePermanently(lib, [id], {
      removeFile: async () => {
        throw new Error('file is locked')
      }
    })
    expect(r).toMatchObject({ deleted: 0, failed: 1 })
    expect(r.errors[0]).toMatch(/locked/)
    expect(binIds(lib)).toEqual([id])
    expect(managedFiles(lib)).toEqual(['undated/stuck.jpg'])
  })

  it('does not bring deleted content back on re-import, unless the user allows it', async () => {
    await makeJpeg(join(sb.source, 'meme.jpg'), { color: '#778899' })
    await makeJpeg(join(sb.source, 'mine.jpg'), { color: '#998877' })
    await runImport(lib, sb.source)
    moveToBin(lib, [idOf('meme.jpg')])
    await deletePermanently(lib, binIds(lib))

    const again = await runImport(lib, sb.source)
    expect(again.deletedBefore).toBe(1)
    expect(again.newAssets).toBe(0)
    expect(again.duplicatesLibrary).toBe(1)
    expect(count(lib, 'assets')).toBe(1)

    expect(forgetDeleted(lib)).toBe(1)
    const third = await runImport(lib, sb.source)
    expect(third.newAssets).toBe(1)
    expect(count(lib, 'assets')).toBe(2)
  })
})
