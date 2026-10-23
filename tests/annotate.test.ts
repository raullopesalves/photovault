import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { addManualFace, allTags, assetFaces, createSmartAlbum, deleteFace, setDescription, setLocation, setTags, smartAlbums } from '@core/repo/annotate'
import { countryAt, memories } from '@core/repo/memories'
import { facets } from '@core/repo/filters'
import { listPeople, moveFaces } from '@core/repo/people'
import { assetDetail, assetIdsInRange } from '@core/repo/queries'
import { makeJpeg, openLibrary, runImport, sandbox, type Sandbox } from './helpers'
import { prepareShare } from '../src/main/share'

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

describe('annotations', () => {
  it('tags, captions and hand-set locations are stored, searchable and never overwritten', async () => {
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#101010' })
    await makeJpeg(join(sb.source, 'b.jpg'), { color: '#202020' })
    await runImport(lib, sb.source)
    const [a, b] = [idOf('a.jpg'), idOf('b.jpg')]

    setTags(lib, [a, b], ['Beach', ' family  '], [])
    setTags(lib, [b], [], ['beach']) // tags are case-insensitive
    expect(assetDetail(lib, a)!.tags).toEqual(['Beach', 'family'])
    expect(assetDetail(lib, b)!.tags).toEqual(['family'])
    expect(allTags(lib)).toEqual([
      { tag: 'family', count: 2 },
      { tag: 'Beach', count: 1 }
    ])
    expect(assetIdsInRange(lib, { text: 'beach' }, 0, 10)).toEqual([a])
    expect(assetIdsInRange(lib, { tag: 'family' }, 0, 10)).toHaveLength(2)

    setDescription(lib, a, '  Sunset at Comporta ')
    expect(assetDetail(lib, a)!.description).toBe('Sunset at Comporta')
    expect(assetIdsInRange(lib, { text: 'comporta' }, 0, 10)).toEqual([a])

    setLocation(lib, [a], { lat: 38.38, lon: -8.78 })
    expect(assetDetail(lib, a)).toMatchObject({ latitude: 38.38, longitude: -8.78, locationSource: 'manual' })
    setLocation(lib, [a], null)
    expect(assetDetail(lib, a)).toMatchObject({ latitude: null, locationSource: null })
    expect(() => setLocation(lib, [a], { lat: 95, lon: 0 })).toThrow()
  })

  it('smart albums keep matching what their search finds', async () => {
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#101010', dateTimeOriginal: '2019:05:01 10:00:00' })
    await makeJpeg(join(sb.source, 'b.jpg'), { color: '#202020', dateTimeOriginal: '2020:05:01 10:00:00' })
    await runImport(lib, sb.source)
    const album = createSmartAlbum(lib, 'Twenty-nineteen', { years: [2019], ids: [1, 2, 3], sort: 'added' })
    expect(album.query).toEqual({ years: [2019], hidden: 'exclude' }) // display-only state is not saved
    expect(album.count).toBe(1)
    await makeJpeg(join(sb.dir, 'more', 'c.jpg'), { color: '#303030', dateTimeOriginal: '2019:07:01 10:00:00' })
    await runImport(lib, join(sb.dir, 'more'))
    expect(smartAlbums(lib)[0]!.count).toBe(2)
  })

  it('the Photos timeline can leave screenshots out', async () => {
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#101010' })
    await makeJpeg(join(sb.source, 'b.jpg'), { color: '#202020' })
    await makeJpeg(join(sb.source, 'c.jpg'), { color: '#303030' })
    await runImport(lib, sb.source)
    const [a, b, c] = [idOf('a.jpg'), idOf('b.jpg'), idOf('c.jpg')]
    lib.db.run("UPDATE assets SET origin = 'screenshot' WHERE id = ?", [b])
    lib.db.run("UPDATE assets SET origin = 'camera' WHERE id = ?", [c])
    const ids = (q: Parameters<typeof assetIdsInRange>[1]): number[] => assetIdsInRange(lib, q, 0, 10).sort((x, y) => x - y)
    expect(ids({ excludeOrigins: ['screenshot', 'screen_recording'] })).toEqual([a, c].sort((x, y) => x - y)) // unknown origin stays
    expect(ids({ origins: ['screenshot', 'screen_recording'] })).toEqual([b])
    // Filter counts follow the view: the whole library by default, Photos without its screenshot.
    const yearTotal = (f: ReturnType<typeof facets>): number => f.years.reduce((s, y) => s + y.count, 0)
    expect(yearTotal(facets(lib))).toBe(3)
    const photos = facets(lib, { hidden: 'exclude', excludeOrigins: ['screenshot', 'screen_recording'] })
    expect(yearTotal(photos)).toBe(2)
    expect(photos.origins.some((o) => o.origin === 'screenshot')).toBe(false)
    lib.db.run('UPDATE assets SET favorite = 1 WHERE id = ?', [c])
    expect(facets(lib, { favorite: true }).years.reduce((s, y) => s + y.count, 0)).toBe(1)
  })

  it('hand-marked faces can be named and removed', async () => {
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#101010' })
    await runImport(lib, sb.source)
    const a = idOf('a.jpg')
    const face = addManualFace(lib, a, { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, null)
    expect(assetFaces(lib, a)).toEqual([{ id: face, x: 0.2, y: 0.2, w: 0.3, h: 0.3, personId: null, personName: null, manual: true }])
    const person = moveFaces(lib, [face], { newName: 'Avó Maria' })
    expect(listPeople(lib)).toMatchObject([{ id: person, name: 'Avó Maria', photos: 1 }])
    expect(assetIdsInRange(lib, { text: 'avo maria' }, 0, 10)).toEqual([a]) // names are searchable, accents ignored
    deleteFace(lib, face)
    expect(assetFaces(lib, a)).toEqual([])
    expect(listPeople(lib)).toEqual([])
  })
})

describe('memories', () => {
  it('finds this day in earlier years, trips away from home and big days', async () => {
    const gps = (lat: number, lon: number) => {
      const dms = (v: number): string => `${Math.floor(Math.abs(v))}/1 ${Math.round((Math.abs(v) % 1) * 60)}/1 0/1`
      return { lat: dms(lat), latRef: (lat >= 0 ? 'N' : 'S') as 'N' | 'S', lon: dms(lon), lonRef: (lon >= 0 ? 'E' : 'W') as 'E' | 'W' }
    }
    let i = 0
    const shot = async (day: string, hour: number, lat?: number, lon?: number): Promise<void> => {
      i++
      await makeJpeg(join(sb.source, `p${i}.jpg`), {
        color: `#${(i * 2654435).toString(16).slice(-6).padStart(6, '0')}`,
        dateTimeOriginal: `${day.replace(/-/g, ':')} ${String(hour).padStart(2, '0')}:00:00`,
        make: 'Test',
        model: 'Cam',
        ...(lat !== undefined && lon !== undefined ? { gps: gps(lat, lon) } : {})
      })
    }
    for (let d = 0; d < 20; d++) await shot(`2023-0${1 + (d % 8)}-1${d % 9}`, 10, 38.72, -9.14) // home: Lisbon
    for (let k = 0; k < 6; k++) await shot('2022-10-09', 9 + k, 38.72, -9.14) // "on this day"
    for (let k = 0; k < 12; k++) await shot(`2024-05-1${k < 6 ? 1 : 2}`, 9 + (k % 6), 40.42, -3.7) // trip to Madrid
    await runImport(lib, sb.source)
    lib.db.run("UPDATE assets SET origin = 'camera'")

    const m = memories(lib, new Date('2026-10-09T12:00:00'))
    expect(m.find((x) => x.kind === 'on_this_day')).toMatchObject({ title: '4 years ago', count: 6 })
    expect(m.find((x) => x.kind === 'trip')).toMatchObject({ title: 'Trip to Madrid', count: 12 })
    const pt = memories(lib, new Date('2026-10-09T12:00:00'), 'pt')
    expect(pt.find((x) => x.kind === 'on_this_day')).toMatchObject({ title: 'Há 4 anos', subtitle: '9 de outubro de 2022' })
    expect(pt.find((x) => x.kind === 'trip')?.title).toBe('Viagem a Madrid')
    expect(countryAt(38.72, -9.14)).toBe('Portugal')
    expect(countryAt(0, -30)).toBeNull() // at sea
  })
})

describe('sharing', () => {
  it('prepares JPEG copies at the chosen size without location', async () => {
    await makeJpeg(join(sb.source, 'big.jpg'), {
      width: 3000,
      height: 2000,
      color: '#446688',
      dateTimeOriginal: '2021:03:04 05:06:07',
      gps: { lat: '38/1 43/1 0/1', latRef: 'N', lon: '9/1 8/1 0/1', lonRef: 'W' }
    })
    await runImport(lib, sb.source)
    const r = await prepareShare(lib, [idOf('big.jpg')], { size: 'small', includeDate: true })
    expect(r).toMatchObject({ files: 1, failed: 0 })
    const file = join(r.folder, readdirSync(r.folder)[0] as string)
    const meta = await sharp(file).metadata()
    expect([meta.width, meta.height]).toEqual([1280, 853])
    const exif = await (await import('exifr')).default.parse(file, { gps: true })
    expect(exif?.latitude).toBeUndefined()
    expect(exif?.DateTimeOriginal).toBeInstanceOf(Date)
    rmSync(r.folder, { recursive: true, force: true })
  })
})

describe('place names', () => {
  it('names located photos after the nearest town, searchably, and updates when moved', async () => {
    const { fillPlaces } = await import('@core/geo/fillPlaces')
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#123456', gps: { lat: '38/1 43/1 20/1', latRef: 'N', lon: '9/1 8/1 21/1', lonRef: 'W' } })
    await runImport(lib, sb.source)
    const a = idOf('a.jpg')
    expect(fillPlaces(lib)).toBe(1)
    expect(assetDetail(lib, a)!.place).toBe('Lisbon, Portugal')
    expect(assetIdsInRange(lib, { text: 'lisbon' }, 0, 10)).toEqual([a])
    setLocation(lib, [a], { lat: 41.1496, lon: -8.611 })
    fillPlaces(lib)
    expect(assetDetail(lib, a)!.place).toBe('Porto, Portugal')
    expect(assetIdsInRange(lib, { text: 'lisbon' }, 0, 10)).toEqual([])
  })
})
