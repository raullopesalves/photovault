import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { runDating, setManualDates } from '@core/dating/dating'
import { HashQueue } from '@core/library/hashQueue'
import { facets } from '@core/repo/filters'
import { assetDetail, assetsPage, timeline } from '@core/repo/queries'
import { ThumbnailQueue } from '@core/thumbnails/thumbnails'
import { makeJpeg, openLibrary, photoScene, runImport, sandbox, type Sandbox } from './helpers'

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

/** Distinct, textured image per index so files never look alike to the duplicate finder. */
async function distinctJpeg(path: string, i: number, exifDate?: string): Promise<void> {
  let img = sharp({ create: { width: 96, height: 72, channels: 3, background: '#000', noise: { type: 'gaussian', mean: 40 + i * 7, sigma: 30 + i } } }).jpeg()
  if (exifDate) img = img.withExif({ IFD0: { Make: 'Xiaomi', Model: 'M2012K11AG' }, IFD2: { DateTimeOriginal: exifDate } })
  writeFileSync(path, await img.toBuffer())
}

describe('dating pass', () => {
  it('estimates dates for Android media-id files between dated neighbours, with evidence, and skips uncertain ones', async () => {
    // Dated anchors (camera files saved with media-id names) …
    await distinctJpeg(join(sb.source, '1000040700.jpg'), 1, '2022:03:12 10:00:00')
    await distinctJpeg(join(sb.source, '1000040800.jpg'), 2, '2022:03:12 20:00:00')
    await distinctJpeg(join(sb.source, '1000050000.jpg'), 3, '2022:06:01 12:00:00') // > 30 days later
    // … an out-of-sequence anchor (an old photo saved later) that must be ignored …
    await distinctJpeg(join(sb.source, '1000040760.jpg'), 4, '2015:01:01 09:00:00')
    // … and undated media-id files (e.g. received via WhatsApp).
    await distinctJpeg(join(sb.source, '1000040750.jpg'), 5)
    await distinctJpeg(join(sb.source, '1000045000.jpg'), 6) // between 12 Mar and 1 Jun: too uncertain
    await distinctJpeg(join(sb.source, '1000060000.jpg'), 7) // after the last anchor: no estimate
    await distinctJpeg(join(sb.source, '46777.jpg'), 8) // not a media id
    await runImport(lib, sb.source)

    const r = runDating(lib)
    expect(r.estimated).toBe(1)
    const est = byName('1000040750.jpg')
    expect(est.captureTimeSource).toBe('estimated')
    expect(est.captureTime).toBe('2022-03-12T15:00:00') // halfway by id between 10:00 and 20:00
    expect(est.dateEvidence[0]).toMatch(/1000040700\.jpg.*1000040800\.jpg/)
    expect(est.dateEvidence.join(' ')).toMatch(/same day/)
    for (const n of ['1000045000.jpg', '1000060000.jpg', '46777.jpg']) expect(byName(n).captureTime).toBeNull()

    // Idempotent, and skipped when nothing changed.
    expect(runDating(lib).skipped).toBe(true)
    expect(runDating(lib, { force: true }).estimated).toBe(1)
  })

  it('borrows the date of a visually identical copy (e.g. a WhatsApp copy of a camera photo)', async () => {
    const original = await sharp(photoScene(5))
      .jpeg({ quality: 92 })
      .withExif({ IFD0: { Make: 'Xiaomi', Model: 'M2012K11AG' }, IFD2: { DateTimeOriginal: '2021:08:20 18:30:00' } })
      .toBuffer()
    writeFileSync(join(sb.source, 'IMG_20210820_183000.jpg'), original)
    await sharp(original).resize(600).jpeg({ quality: 55 }).toFile(join(sb.source, '46777.jpg')) // stripped copy
    await runImport(lib, sb.source)
    await new ThumbnailQueue(lib).drain()
    await new HashQueue(lib).drain()
    expect(runDating(lib).borrowed).toBe(1)
    const copy = byName('46777.jpg')
    expect(copy.captureTimeSource).toBe('duplicate')
    expect(copy.captureTime).toBe('2021-08-20T18:30:00')
    expect(copy.dateEvidence[0]).toMatch(/Same picture as “IMG_20210820_183000\.jpg”/)
  })

  it('undated items form a "No date" section at the end; manual dates move them and are never overwritten', async () => {
    await makeJpeg(join(sb.source, 'dated.jpg'), { color: '#123456', dateTimeOriginal: '2020:05:05 10:00:00' })
    await makeJpeg(join(sb.source, '46777.jpg'), { color: '#654321' })
    await makeJpeg(join(sb.source, '46778.jpg'), { color: '#224466' })
    await runImport(lib, sb.source)

    expect(timeline(lib)).toEqual([
      { month: '2020-05', count: 1 },
      { month: 'undated', count: 2 }
    ])
    const page = assetsPage(lib, 0, 10)
    expect(page[0]!.captureKnown).toBe(true) // dated first, undated last – same order as the groups
    expect(facets(lib).years).toEqual([
      { year: 2020, count: 1 },
      { year: 0, count: 2 }
    ])
    expect(assetsPage(lib, 0, 10, { years: [0] })).toHaveLength(2)

    const id = byName('46777.jpg').id
    setManualDates(lib, [id], '2019-12-24T18:00:00')
    expect(byName('46777.jpg')).toMatchObject({ captureTime: '2019-12-24T18:00:00', captureTimeSource: 'manual' })
    runDating(lib, { force: true })
    expect(byName('46777.jpg').captureTimeSource).toBe('manual')
    expect(timeline(lib).map((g) => g.month)).toEqual(['2020-05', '2019-12', 'undated'])

    // Removing a manual date puts it back under "No date"; a date recorded in the file cannot be removed.
    setManualDates(lib, [id], null)
    expect(byName('46777.jpg').captureTime).toBeNull()
    setManualDates(lib, [byName('dated.jpg').id], null)
    expect(byName('dated.jpg').captureTime).toBe('2020-05-05T10:00:00')
  })
})
