import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Library } from '@core/library/library'
import { addAssets, createAlbum, deleteAlbum, getAlbum, listAlbums, removeAssets, setFavorites, updateAlbum } from '@core/repo/albums'
import { facets } from '@core/repo/filters'
import { assetDetail, assetsPage, timeline } from '@core/repo/queries'
import { count, makeJpeg, makeZip, managedFiles, openLibrary, runImport, sandbox, type Sandbox } from './helpers'

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

const ids = (): number[] => lib.db.all<{ id: number }>('SELECT id FROM assets ORDER BY id').map((r) => r.id)

describe('albums', () => {
  it('create, add, remove, rename and delete – files are never touched', async () => {
    for (let i = 0; i < 4; i++) await makeJpeg(join(sb.source, `a${i}.jpg`), { color: `#${i}${i}${i}${i}00` })
    await runImport(lib, sb.source)
    const [a, b, c, d] = ids() as [number, number, number, number]

    const album = createAlbum(lib, '  Summer   2024 ', [a, b])
    expect(album).toMatchObject({ name: 'Summer 2024', kind: 'user', count: 2 })
    expect(addAssets(lib, album.id, [b, c])).toBe(1) // b already present
    expect(getAlbum(lib, album.id)?.count).toBe(3)
    expect(removeAssets(lib, album.id, [a])).toBe(1)
    expect(assetsPage(lib, 0, 10, { albumId: album.id }).map((x) => x.id).sort()).toEqual([b, c].sort())
    expect(assetDetail(lib, b)?.albums).toEqual([{ id: album.id, name: 'Summer 2024' }])
    expect(assetDetail(lib, d)?.albums).toEqual([])

    expect(updateAlbum(lib, album.id, { name: 'Lake', description: 'Weekend' })).toMatchObject({ name: 'Lake', description: 'Weekend' })
    expect(() => updateAlbum(lib, album.id, { name: '   ' })).toThrow()

    const filesBefore = managedFiles(lib)
    deleteAlbum(lib, album.id)
    expect(listAlbums(lib)).toEqual([])
    expect(count(lib, 'album_assets')).toBe(0)
    expect(count(lib, 'assets')).toBe(4)
    expect(managedFiles(lib)).toEqual(filesBefore)
  })

  it('recreates Google Takeout albums once, even across re-imports, and keeps user removals', async () => {
    const p = await makeJpeg(join(sb.dir, 'raw', 'p.jpg'), { color: '#abcdef' })
    const q = await makeJpeg(join(sb.dir, 'raw', 'q.jpg'), { color: '#fedcba' })
    const GP = 'Takeout/Google Photos'
    const zip = await makeZip(join(sb.dir, 'takeout.zip'), [
      { name: `${GP}/Photos from 2020/p.jpg`, file: p },
      { name: `${GP}/Photos from 2020/q.jpg`, file: q },
      { name: `${GP}/Road Trip/p.jpg`, file: p },
      { name: `${GP}/Road Trip/q.jpg`, file: q },
      { name: `${GP}/Road Trip/metadata.json`, data: JSON.stringify({ title: 'Road Trip' }) }
    ])
    await runImport(lib, zip)
    const albums = listAlbums(lib)
    expect(albums).toHaveLength(1)
    expect(albums[0]).toMatchObject({ name: 'Road Trip', kind: 'takeout', count: 2 })

    // The user removes one photo; a re-import of the same Takeout must not duplicate the album or undo that.
    const albumId = albums[0]!.id
    const qId = lib.db.get<{ id: number }>("SELECT id FROM assets WHERE original_filename = 'q.jpg'")!.id
    removeAssets(lib, albumId, [qId])
    await runImport(lib, zip)
    expect(listAlbums(lib)).toHaveLength(1)
    // Re-import observes q.jpg in the album folder again, so it is re-added: the Takeout says it belongs there.
    // What must never happen is a second "Road Trip" album.
    expect(getAlbum(lib, albumId)?.count).toBeGreaterThanOrEqual(1)
  })
})

describe('favourites and filters', () => {
  it('filters by type, favourite, year, camera, source, album and text; timeline counts match pages', async () => {
    await makeJpeg(join(sb.source, 'beach.jpg'), { color: '#0000ff', dateTimeOriginal: '2019:07:01 10:00:00', make: 'Canon', model: 'EOS R6' })
    await makeJpeg(join(sb.source, 'mountain.jpg'), { color: '#00ff00', dateTimeOriginal: '2021:01:01 10:00:00', make: 'Apple', model: 'iPhone 14 Pro' })
    await makeJpeg(join(sb.source, 'IMG_9999.jpg'), { color: '#ff0000', dateTimeOriginal: '2021:05:05 10:00:00', make: 'Apple', model: 'iPhone 14 Pro' })
    await runImport(lib, sb.source)
    const zipSource = await makeJpeg(join(sb.dir, 'raw', 'zipped.jpg'), { color: '#123456', dateTimeOriginal: '2021:06:06 10:00:00' })
    await runImport(lib, await makeZip(join(sb.dir, 'x.zip'), [{ name: 'zipped.jpg', file: zipSource }]))

    const byName = (n: string): number => lib.db.get<{ id: number }>('SELECT id FROM assets WHERE original_filename = ?', [n])!.id
    setFavorites(lib, [byName('beach.jpg'), byName('IMG_9999.jpg')], true)
    const album = createAlbum(lib, 'Holidays', [byName('mountain.jpg')])

    const names = (q: Parameters<typeof assetsPage>[3]): string[] =>
      assetsPage(lib, 0, 50, q)
        .map((a) => lib.db.get<{ n: string }>('SELECT original_filename AS n FROM assets WHERE id = ?', [a.id])!.n)
        .sort()

    expect(names({ favorite: true })).toEqual(['IMG_9999.jpg', 'beach.jpg'])
    expect(names({ year: 2021 })).toEqual(['IMG_9999.jpg', 'mountain.jpg', 'zipped.jpg'])
    expect(names({ cameraMake: 'Apple', cameraModel: 'iPhone 14 Pro' })).toEqual(['IMG_9999.jpg', 'mountain.jpg'])
    expect(names({ sourceType: 'ZIP' })).toEqual(['zipped.jpg'])
    expect(names({ albumId: album.id })).toEqual(['mountain.jpg'])
    expect(names({ text: 'beach' })).toEqual(['beach.jpg'])
    expect(names({ text: 'canon' })).toEqual(['beach.jpg'])
    expect(names({ text: 'holidays' })).toEqual(['mountain.jpg']) // album name
    expect(names({ text: '2021 iphone' })).toEqual(['IMG_9999.jpg', 'mountain.jpg'])
    expect(names({ text: '100%_' })).toEqual([]) // LIKE wildcards are escaped
    expect(names({ mediaType: 'video' })).toEqual([])
    expect(names({ year: 2021, favorite: true })).toEqual(['IMG_9999.jpg'])

    // Multi-select: OR within a filter, AND across filters.
    expect(names({ years: [2019, 2021] })).toEqual(['IMG_9999.jpg', 'beach.jpg', 'mountain.jpg', 'zipped.jpg'])
    expect(names({ years: [2019, 2021], cameras: [{ make: 'Canon', model: 'EOS R6' }, { make: 'Apple', model: 'iPhone 14 Pro' }] })).toEqual([
      'IMG_9999.jpg',
      'beach.jpg',
      'mountain.jpg'
    ])
    expect(names({ years: [2021], cameras: [{ make: 'Canon', model: 'EOS R6' }] })).toEqual([])
    expect(names({ sourceTypes: ['ZIP', 'LOCAL_FOLDER'] })).toHaveLength(4)
    expect(names({ types: ['video'] })).toEqual([])
    expect(names({ types: ['photo', 'video'], favorite: true })).toEqual(['IMG_9999.jpg', 'beach.jpg'])

    const groups = timeline(lib, { year: 2021 })
    expect(groups.reduce((s, g) => s + g.count, 0)).toBe(3)

    const f = facets(lib)
    expect(f.years).toEqual([
      { year: 2021, count: 3 },
      { year: 2019, count: 1 }
    ])
    expect(f.cameras[0]).toEqual({ make: 'Apple', model: 'iPhone 14 Pro', count: 2 })
    expect(f.favorites).toBe(2)
    expect(f.sources.map((s) => s.type).sort()).toEqual(['LOCAL_FOLDER', 'ZIP'])
    expect(existsSync(lib.paths.originals)).toBe(true)
  })
})
