import { describe, expect, it } from 'vitest'
import { mediaKey, parseSidecarName, SidecarIndex } from '@core/takeout/match'
import { looksLikeTakeoutPath, parseTakeoutAlbum, parseTakeoutSidecar } from '@core/takeout/sidecar'
import { resolveMetadata } from '@core/media/resolve'
import { emptyMetadata } from '@core/media/metadata'

describe('sidecar file names', () => {
  it('parses the naming variants Google uses', () => {
    expect(parseSidecarName('IMG_1234.jpg.json')).toEqual({ base: 'IMG_1234.jpg', n: 0 })
    expect(parseSidecarName('IMG_1234.jpg.supplemental-metadata.json')).toEqual({ base: 'IMG_1234.jpg', n: 0 })
    expect(parseSidecarName('IMG_1234.jpg.supplemental-met.json')).toEqual({ base: 'IMG_1234.jpg', n: 0 })
    expect(parseSidecarName('IMG_1234.jpg.s.json')).toEqual({ base: 'IMG_1234.jpg', n: 0 })
    expect(parseSidecarName('IMG_1234.jpg(1).json')).toEqual({ base: 'IMG_1234.jpg', n: 1 })
    expect(parseSidecarName('IMG_1234.jpg.supplemental-metadata(2).json')).toEqual({ base: 'IMG_1234.jpg', n: 2 })
    expect(parseSidecarName('IMG_1234.json')).toEqual({ base: 'IMG_1234', n: 0 })
    expect(parseSidecarName('IMG_1234.jpg')).toBeNull()
  })

  it('normalises media names', () => {
    expect(mediaKey('IMG_1234(1).jpg')).toEqual({ name: 'IMG_1234.jpg', n: 1, edited: false })
    expect(mediaKey('IMG_1234-edited.jpg')).toEqual({ name: 'IMG_1234.jpg', n: 0, edited: true })
    expect(mediaKey('IMG_1234-bearbeitet(2).jpg')).toEqual({ name: 'IMG_1234.jpg', n: 2, edited: true })
  })
})

describe('SidecarIndex.match', () => {
  const dir = 'Takeout/Google Photos/Photos from 2019'
  const longName = 'Screenshot_20190815-112233_Some Very Long App Name.png'
  const index = new SidecarIndex<string>()
  index.add(dir, 'IMG_0001.jpg.supplemental-metadata.json', 'IMG_0001.jpg', 'A')
  index.add(dir, 'IMG_0001.jpg.supplemental-metadata(1).json', 'IMG_0001.jpg', 'A1')
  index.add(dir, `${longName.slice(0, 46)}.json`, longName, 'LONG')
  index.add(dir, 'PXL_2019.jpg.json', 'PXL_2019.jpg', 'PXL')
  index.add(dir, 'IMG_5555.HEIC.json', 'IMG_5555.HEIC', 'LIVE')
  index.add(dir, 'renamed-by-google.json', 'original upload name.jpg', 'TITLE')
  index.add('Takeout/Google Photos/Other', 'IMG_0001.jpg.json', 'IMG_0001.jpg', 'OTHER')

  const m = (name: string, d = dir): string | null => index.match(d, name)?.value ?? null

  it('matches exact, numbered, edited and truncated names', () => {
    expect(m('IMG_0001.jpg')).toBe('A')
    expect(m('IMG_0001(1).jpg')).toBe('A1')
    expect(m('IMG_0001-edited.jpg')).toBe('A')
    expect(m(longName)).toBe('LONG')
    expect(m('PXL_2019.jpg')).toBe('PXL')
  })

  it('pairs live-photo videos and falls back to the title', () => {
    expect(m('IMG_5555.MP4')).toBe('LIVE')
    expect(m('original upload name.jpg')).toBe('TITLE')
  })

  it('only matches within the same export folder and never guesses', () => {
    expect(m('IMG_0001.jpg', 'Takeout/Google Photos/Other')).toBe('OTHER')
    expect(m('IMG_9999.jpg')).toBeNull()
    expect(m('IMG_0001.jpg', 'Takeout/Google Photos/Nowhere')).toBeNull()
  })
})

describe('Takeout JSON', () => {
  it('parses photo metadata and treats 0/0 as no location', () => {
    const s = parseTakeoutSidecar({
      title: 'IMG_1.jpg',
      description: ' Lake ',
      photoTakenTime: { timestamp: '1565860800', formatted: '…' },
      geoData: { latitude: 46.5, longitude: 7.25, altitude: 1200 },
      favorited: true,
      people: [{ name: 'Ana' }]
    })
    expect(s).toMatchObject({ title: 'IMG_1.jpg', description: 'Lake', photoTakenTime: 1565860800, latitude: 46.5, favorited: true, people: ['Ana'] })
    expect(parseTakeoutSidecar({ title: 'x', photoTakenTime: { timestamp: '1' }, geoData: { latitude: 0, longitude: 0 } })?.latitude).toBeNull()
    expect(parseTakeoutSidecar({ title: 'Summer Trip', description: '' })).toBeNull()
    expect(parseTakeoutAlbum({ title: 'Summer Trip', description: '' })).toEqual({ title: 'Summer Trip', description: null })
    expect(looksLikeTakeoutPath('Takeout/Google Photos/Photos from 2019/a.jpg')).toBe(true)
    expect(looksLikeTakeoutPath('Photos/a.jpg')).toBe(false)
  })

  it('metadata precedence: camera EXIF date beats Takeout; Takeout beats weaker hints; embedded GPS beats Takeout', () => {
    const sidecar = parseTakeoutSidecar({ title: 'a', photoTakenTime: { timestamp: '1565860800' }, geoData: { latitude: 1, longitude: 2 } })
    const exif = { ...emptyMetadata(), captureTime: '2019-08-15T13:20:00', captureTimeSource: 'exif_original' as const, latitude: 10, longitude: 20 }
    const r1 = resolveMetadata(exif, sidecar)
    expect(r1.captureTime).toBe('2019-08-15T13:20:00')
    expect(r1.captureTimeSource).toBe('exif_original')
    expect([r1.latitude, r1.longitude]).toEqual([10, 20])

    const weak = { ...emptyMetadata(), captureTime: '2001-01-01T00:00:00', captureTimeSource: 'filename' as const, captureOffsetMinutes: 120 }
    const r2 = resolveMetadata(weak, sidecar)
    expect(r2.captureTimeSource).toBe('takeout')
    expect(r2.captureTime).toBe('2019-08-15T11:20:00') // 09:20Z shown at the known +02:00 offset
    expect([r2.latitude, r2.longitude]).toEqual([1, 2])
  })
})
