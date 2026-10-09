import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { exportOriginals } from '@core/library/export'
import { rotateAssets } from '@core/library/rotate'
import { mapClusters } from '@core/repo/geo'
import { createAlbum, updateAlbum } from '@core/repo/albums'
import { moveToBin, deletePermanently } from '@core/library/bin'
import { assetDetail, assetIdsInRange, assetsPage, thumbnailPath, timeline } from '@core/repo/queries'
import { ThumbnailQueue, originalPathFor } from '@core/thumbnails/thumbnails'
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

const idOf = (name: string): number => lib.db.get<{ id: number }>('SELECT id FROM assets WHERE original_filename = ?', [name])!.id

describe('export', () => {
  it('copies originals byte for byte, never overwrites, and dates the copies', async () => {
    await makeJpeg(join(sb.source, 'a', 'IMG_1.jpg'), { color: '#102030', dateTimeOriginal: '2019:05:04 10:11:12' })
    await makeJpeg(join(sb.source, 'b', 'IMG_1.jpg'), { color: '#302010' }) // same name, different photo
    await runImport(lib, sb.source)
    const out = join(sb.dir, 'export')
    mkdirSync(out)
    writeFileSync(join(out, 'IMG_1.jpg'), 'someone else’s file')

    const ids = assetIdsInRange(lib, undefined, 0, 100)
    const r = await exportOriginals(lib, ids, out)
    expect(r).toMatchObject({ exported: 2, failed: 0 })
    expect(readdirSync(out).sort()).toEqual(['IMG_1 (2).jpg', 'IMG_1 (3).jpg', 'IMG_1.jpg'])
    expect(readFileSync(join(out, 'IMG_1.jpg'), 'utf8')).toBe('someone else’s file') // untouched

    const dated = readdirSync(out).find((f) => f !== 'IMG_1.jpg' && statSync(join(out, f)).mtime.getFullYear() === 2019)!
    const m = statSync(join(out, dated)).mtime
    expect([m.getMonth(), m.getDate(), m.getHours(), m.getMinutes()]).toEqual([4, 4, 10, 11])
    const src = originalPathFor(lib, idOf('IMG_1.jpg'))!.absolutePath
    const copies = readdirSync(out).filter((f) => f !== 'IMG_1.jpg').map((f) => readFileSync(join(out, f)))
    expect(copies.some((b) => b.equals(readFileSync(src)))).toBe(true)
  })
})

describe('rotation', () => {
  it('rotates the thumbnail, not the original', async () => {
    await makeJpeg(join(sb.source, 'wide.jpg'), { width: 200, height: 100, color: '#456789' })
    await runImport(lib, sb.source)
    const q = new ThumbnailQueue(lib)
    await q.drain()
    const id = idOf('wide.jpg')
    const original = readFileSync(originalPathFor(lib, id)!.absolutePath)

    expect(rotateAssets(lib, [id], 90)).toEqual([id])
    await q.rerender(id)
    const meta = await sharp(thumbnailPath(lib, id, 'thumb')!).metadata()
    expect([meta.width, meta.height]).toEqual([100, 200])
    expect(readFileSync(originalPathFor(lib, id)!.absolutePath).equals(original)).toBe(true)
    const d = assetDetail(lib, id)!
    expect(d.rotation).toBe(90)
    expect(d.fullView).toBe('preview')

    rotateAssets(lib, [id], 270)
    expect(assetDetail(lib, id)!.rotation).toBe(0)
    expect(assetDetail(lib, id)!.fullView).toBe('original')
  })
})

describe('recently added', () => {
  it('orders and groups by import time instead of date taken', async () => {
    await makeJpeg(join(sb.source, 'old.jpg'), { color: '#111111', dateTimeOriginal: '2001:01:01 00:00:00' })
    await runImport(lib, sb.source)
    const second = join(sb.dir, 'more')
    await makeJpeg(join(second, 'new.jpg'), { color: '#222222', dateTimeOriginal: '2020:01:01 00:00:00' })
    await makeJpeg(join(second, 'older.jpg'), { color: '#333333', dateTimeOriginal: '1999:01:01 00:00:00' })
    await runImport(lib, second)
    lib.db.run("UPDATE assets SET created_at = '2024-03-05T10:00:00.000Z' WHERE original_filename = 'old.jpg'")

    const names = (ids: number[]): string[] => ids.map((id) => assetDetail(lib, id)!.originalFilename)
    expect(names(assetIdsInRange(lib, undefined, 0, 10))).toEqual(['new.jpg', 'old.jpg', 'older.jpg'])
    const added = names(assetIdsInRange(lib, { sort: 'added' }, 0, 10))
    expect(added[2]).toBe('old.jpg')
    expect(assetsPage(lib, 0, 10, { sort: 'added' }).map((a) => a.id)).toEqual(assetIdsInRange(lib, { sort: 'added' }, 0, 10))
    const months = timeline(lib, { sort: 'added' })
    expect(months.at(-1)).toEqual({ month: '2024-03-05', count: 1 })
    expect(months.reduce((s, m) => s + m.count, 0)).toBe(3)
  })
})

describe('map', () => {
  it('clusters located items by zoom and filters by area', async () => {
    const gps = (lat: string, lon: string) => ({ lat, latRef: 'N' as const, lon, lonRef: 'W' as const })
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#aa0000', gps: gps('40/1 25/1 0/1', '3/1 42/1 0/1') }) // Madrid
    await makeJpeg(join(sb.source, 'b.jpg'), { color: '#00aa00', gps: gps('40/1 25/1 30/1', '3/1 42/1 10/1') }) // Madrid, ~1 km away
    await makeJpeg(join(sb.source, 'c.jpg'), { color: '#0000aa', gps: gps('51/1 30/1 0/1', '0/1 7/1 0/1') }) // London
    await makeJpeg(join(sb.source, 'd.jpg'), { color: '#aaaa00' }) // no location
    await runImport(lib, sb.source)
    const world = { south: -85, west: -180, north: 85, east: 180 }
    const far = mapClusters(lib, { ...world, zoom: 3 })
    expect(far.map((c) => c.count).sort()).toEqual([1, 2])
    const near = mapClusters(lib, { ...world, zoom: 14 })
    expect(near).toHaveLength(3)
    const madrid = far.find((c) => c.count === 2)!
    expect(assetIdsInRange(lib, { bbox: madrid.bounds }, 0, 10)).toHaveLength(2)
    expect(timeline(lib, { located: true }).reduce((s, m) => s + m.count, 0)).toBe(3)
    // Antimeridian-crossing box (west > east) still works.
    expect(assetIdsInRange(lib, { bbox: [30, 170, 60, 10] }, 0, 10)).toHaveLength(3)
  })
})

describe('full-text search', () => {
  it('finds names, folders, cameras and albums — ignoring case and accents — and stays current', async () => {
    await makeJpeg(join(sb.source, 'Férias Algarve', 'IMG_4801.JPG'), { color: '#101010', make: 'FUJIFILM', model: 'X-T4' })
    await makeJpeg(join(sb.source, 'Natal', 'DSC_0001.jpg'), { color: '#202020' })
    await runImport(lib, sb.source)
    const find = (text: string): string[] =>
      assetIdsInRange(lib, { text }, 0, 10).map((id) => assetDetail(lib, id)!.originalFilename).sort()

    expect(find('4801')).toEqual(['IMG_4801.JPG'])
    expect(find('ferias')).toEqual(['IMG_4801.JPG']) // folder name, accent-insensitive
    expect(find('x-t4')).toEqual(['IMG_4801.JPG'])
    expect(find('natal dsc')).toEqual(['DSC_0001.jpg']) // every word must match
    expect(find('ds')).toEqual(['DSC_0001.jpg']) // short tokens work too
    expect(find('jpg')).toHaveLength(2)

    const id = idOf('DSC_0001.jpg')
    const album = createAlbum(lib, 'Christmas 2019', [id])
    expect(find('christmas')).toEqual(['DSC_0001.jpg'])
    updateAlbum(lib, album.id, { name: 'Consoada' })
    expect(find('christmas')).toEqual([])
    expect(find('consoada')).toEqual(['DSC_0001.jpg'])

    moveToBin(lib, [id])
    await deletePermanently(lib, [id])
    expect(find('consoada')).toEqual([])
    expect(lib.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM asset_search')!.n).toBe(1)
  })
})

describe('smart search plumbing', () => {
  it('keeps clear standouts only and orders results best first', async () => {
    const { selectMatches } = await import('@core/ai/clip')
    const ids = Int32Array.from({ length: 1000 }, (_, i) => i + 1)
    const scores = Float32Array.from({ length: 1000 }, (_, i) => 0.2 + ((i * 7919) % 100) / 5000) // noise 0.20–0.22
    scores[499] = 0.31
    scores[9] = 0.29
    const m = selectMatches(ids, scores)
    expect(m.slice(0, 2).map((x) => x.id)).toEqual([500, 10])
    expect(m.length).toBeLessThanOrEqual(12) // nothing else stands out: a few best guesses at most

    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#111111', dateTimeOriginal: '2020:01:01 00:00:00' })
    await makeJpeg(join(sb.source, 'b.jpg'), { color: '#222222', dateTimeOriginal: '2021:01:01 00:00:00' })
    await makeJpeg(join(sb.source, 'c.jpg'), { color: '#333333', dateTimeOriginal: '2022:01:01 00:00:00' })
    await runImport(lib, sb.source)
    const [a, b] = [idOf('a.jpg'), idOf('b.jpg')]
    expect(assetIdsInRange(lib, { ids: [a, b], sort: 'relevance' }, 0, 10)).toEqual([a, b])
    expect(assetIdsInRange(lib, { ids: [a, b] }, 0, 10)).toEqual([b, a]) // date order
    expect(timeline(lib, { ids: [a, b], sort: 'relevance' })).toEqual([{ month: 'matches', count: 2 }])
    expect(assetIdsInRange(lib, { ids: [] }, 0, 10)).toEqual([])
  })
})

describe('pets (zero-shot)', () => {
  it('keeps only clear winners of the target labels', async () => {
    const { zeroShot, CLIP_DIM } = await import('@core/ai/clip')
    const axis = (k: number): Float32Array => {
      const v = new Float32Array(CLIP_DIM)
      v[k] = 1
      return v
    }
    const mix = (a: number, b: number, wa: number): Float32Array => {
      const v = new Float32Array(CLIP_DIM)
      v[a] = wa
      v[b] = Math.sqrt(1 - wa * wa)
      return v
    }
    // Labels: 0 dog, 1 cat, 2 person. Images: clear dog, clear cat, a person, a dog/person toss-up.
    const images = [axis(0), axis(1), axis(2), mix(0, 2, Math.SQRT1_2)]
    const data = new Float32Array(images.length * CLIP_DIM)
    images.forEach((v, i) => data.set(v, i * CLIP_DIM))
    const found = zeroShot(Int32Array.from([10, 11, 12, 13]), data, [axis(0), axis(1), axis(2)], [0, 1], 0.6)
    expect(found.get(0)?.map((r) => r.id)).toEqual([10])
    expect(found.get(1)?.map((r) => r.id)).toEqual([11])
  })
})
