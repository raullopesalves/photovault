import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Library } from '@core/library/library'
import { binIds, moveToBin } from '@core/library/bin'
import { linkLivePhotos } from '@core/library/livePhotos'
import { utcToLocalWall } from '@core/media/metadata'
import { parseAppleDate, parseICloudDetails, parseXmpSidecar } from '@core/sources/sidecars'
import { assetDetail, assetsPage, libraryInfo, timeline } from '@core/repo/queries'
import { facets } from '@core/repo/filters'
import { makeJpeg, makeMp4, makeZip, openLibrary, runImport, sandbox, type Sandbox } from './helpers'

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

const byName = (n: string) => assetDetail(lib, lib.db.get<{ id: number }>('SELECT id FROM assets WHERE original_filename = ?', [n])!.id)!

describe('enrichment from later imports', () => {
  it('a later Takeout copy fills in the date and location of an undated item', async () => {
    const photo = await makeJpeg(join(sb.source, '46777.jpg'), { color: '#4a6b8c' })
    await runImport(lib, sb.source)
    expect(byName('46777.jpg').captureTime).toBeNull()

    const GP = 'Takeout/Google Photos/Photos from 2019'
    const zip = await makeZip(join(sb.dir, 'takeout.zip'), [
      { name: `${GP}/IMG_20190815.jpg`, file: photo },
      {
        name: `${GP}/IMG_20190815.jpg.json`,
        data: JSON.stringify({ title: 'IMG_20190815.jpg', photoTakenTime: { timestamp: '1565860800' }, geoData: { latitude: 46.5, longitude: 7.25 } })
      }
    ])
    const s = await runImport(lib, zip)
    expect(s.duplicatesLibrary).toBe(1)
    const d = byName('46777.jpg')
    expect(d.captureTimeSource).toBe('takeout')
    expect(d.captureTime).toBe(utcToLocalWall(1565860800_000).wall)
    expect([d.latitude, d.longitude]).toEqual([46.5, 7.25])
    expect(d.dateEvidence[0]).toMatch(/later import/)
  })
})

describe('XMP sidecars', () => {
  it('parses dates, GPS, rating and description in attribute and element form', () => {
    const x = parseXmpSidecar(`<x:xmpmeta><rdf:RDF><rdf:Description exif:DateTimeOriginal="2018-04-03T09:08:07.00" exif:GPSLatitude="46,30.6N" exif:GPSLongitude="7,15W" xmp:Rating="4">
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Lake day</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta>`)
    expect(x.dateTaken).toBe('2018-04-03T09:08:07')
    expect(x.latitude).toBeCloseTo(46.51, 2)
    expect(x.longitude).toBeCloseTo(-7.25, 2)
    expect(x.rating).toBe(4)
    expect(x.description).toBe('Lake day')
  })

  it('applies an XMP sidecar to a file without its own date', async () => {
    await makeJpeg(join(sb.source, 'scan.jpg'), { color: '#246810' })
    writeFileSync(join(sb.source, 'scan.jpg.xmp'), '<rdf:Description photoshop:DateCreated="1994-07-02" exif:GPSLatitude="40,0N" exif:GPSLongitude="3,30W"/>')
    await runImport(lib, sb.source)
    const d = byName('scan.jpg')
    expect(d.captureTime).toBe('1994-07-02T00:00:00')
    expect(d.captureTimeSource).toBe('xmp')
    expect(d.latitude).toBeCloseTo(40)
    expect(d.longitude).toBeCloseTo(-3.5)
  })
})

describe('iCloud export', () => {
  it('parses Apple’s Photo Details.csv', () => {
    expect(parseAppleDate('Saturday July 13,2019 12:52 PM GMT')).toBe(Date.UTC(2019, 6, 13, 12, 52))
    expect(parseAppleDate('Monday January 6,2020 12:05 AM GMT')).toBe(Date.UTC(2020, 0, 6, 0, 5))
    const m = parseICloudDetails('imgName,fileChecksum,favorite,hidden,deleted,originalCreationDate,viewCount,importDate\nIMG_0001.JPG,abc,yes,no,no,"Saturday July 13,2019 12:52 PM GMT",3,x\n')
    expect(m.get('img_0001.jpg')).toEqual({ createdUtcMs: Date.UTC(2019, 6, 13, 12, 52), favorite: true, hidden: false, deleted: false })
  })

  it('imports dates, favourites and hidden flags from an iCloud export', async () => {
    const dir = join(sb.source, 'iCloud Photos')
    mkdirSync(dir, { recursive: true })
    await makeJpeg(join(dir, 'IMG_0001.JPG'), { color: '#123123' })
    await makeJpeg(join(dir, 'IMG_0002.JPG'), { color: '#321321' })
    writeFileSync(
      join(dir, 'Photo Details.csv'),
      'imgName,fileChecksum,favorite,hidden,deleted,originalCreationDate,viewCount,importDate\n' +
        'IMG_0001.JPG,a,yes,no,no,"Saturday July 13,2019 12:52 PM GMT",1,x\n' +
        'IMG_0002.JPG,b,no,yes,no,"Monday January 6,2020 12:05 AM GMT",1,x\n'
    )
    const s = await runImport(lib, sb.source)
    expect(s.sourceType).toBe('ICLOUD_EXPORT')
    const one = byName('IMG_0001.JPG')
    expect(one.captureTimeSource).toBe('icloud')
    expect(one.captureTime).toBe(utcToLocalWall(Date.UTC(2019, 6, 13, 12, 52)).wall)
    expect(one.favorite).toBe(true)
    expect(byName('IMG_0002.JPG').hidden).toBe(true)
  })
})

describe('Live Photos', () => {
  it('pairs a still with its short motion clip; the clip follows the still', async () => {
    const dir = join(sb.source, 'iPhone')
    mkdirSync(dir, { recursive: true })
    await makeJpeg(join(dir, 'IMG_1234.JPG'), { color: '#778855' })
    writeFileSync(join(dir, 'IMG_1234.MOV'), makeMp4({ createdUtc: new Date('2023-01-01T10:00:00Z'), durationS: 2, width: 480, height: 640, audio: true }))
    writeFileSync(join(dir, 'IMG_9999.MOV'), makeMp4({ createdUtc: new Date('2023-01-01T11:00:00Z'), durationS: 2, width: 480, height: 640, audio: true }))
    await runImport(lib, sb.source)
    expect(linkLivePhotos(lib)).toBe(1)
    expect(linkLivePhotos(lib)).toBe(0) // idempotent

    const total = timeline(lib).reduce((s, g) => s + g.count, 0)
    expect(total).toBe(2) // the still + the unrelated clip; the live clip is not separate
    expect([libraryInfo(lib).assetCount, libraryInfo(lib).videoCount, facets(lib).videos]).toEqual([2, 1, 1])
    const still = assetsPage(lib, 0, 10).find((a) => a.mediaType === 'photo')!
    expect(still.liveVideoId).not.toBeNull()

    moveToBin(lib, [still.id])
    expect(binIds(lib)).toHaveLength(2) // still + its clip
  })
})


describe('edited versions', () => {
  it('shows the phone-edited version and keeps the original behind it', async () => {
    const { linkEditedVersions } = await import('@core/library/editedVersions')
    const { moveToBin } = await import('@core/library/bin')
    const dir = join(sb.source, 'iCloud')
    mkdirSync(dir, { recursive: true })
    await makeJpeg(join(dir, 'IMG_2001.JPG'), { color: '#334455' })
    await makeJpeg(join(dir, 'IMG_E2001.JPG'), { color: '#445566' })
    await makeJpeg(join(dir, 'Beach.jpg'), { color: '#556677' })
    await makeJpeg(join(dir, 'Beach-edited.jpg'), { color: '#667788' })
    await makeJpeg(join(dir, 'IMG_2002.JPG'), { color: '#778899' })
    await runImport(lib, sb.source)
    expect(linkEditedVersions(lib)).toBe(2)
    expect(linkEditedVersions(lib)).toBe(0) // idempotent

    const shown = assetsPage(lib, 0, 10).map((a) => a.id)
    const names = shown.map((id) => assetDetail(lib, id)!.originalFilename).sort()
    expect(names).toEqual(['Beach-edited.jpg', 'IMG_2002.JPG', 'IMG_E2001.JPG'])
    const edited = byName('IMG_E2001.JPG')
    expect(edited.originalVersionId).toBe(byName('IMG_2001.JPG').id)

    moveToBin(lib, [edited.id])
    expect(lib.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM assets WHERE trashed_at IS NOT NULL')!.n).toBe(2) // both versions
  })
})
