import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { makeJpeg, openLibrary, runImport, sandbox, type Sandbox } from './helpers'
import { exportWebGallery } from '../src/main/webGallery'

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

describe('web gallery', () => {
  it('makes an offline web page with resized photos, oldest first, without location', async () => {
    await makeJpeg(join(sb.source, 'later.jpg'), { width: 3000, height: 2000, color: '#335577', dateTimeOriginal: '2022:08:01 10:00:00' })
    await makeJpeg(join(sb.source, 'first.jpg'), {
      width: 1200,
      height: 900,
      color: '#775533',
      dateTimeOriginal: '2021:03:04 05:06:07',
      gps: { lat: '38/1 43/1 0/1', latRef: 'N', lon: '9/1 8/1 0/1', lonRef: 'W' }
    })
    await runImport(lib, sb.source)
    const ids = lib.db.all<{ id: number }>('SELECT id FROM assets').map((r) => r.id)
    lib.db.run("UPDATE assets SET description = 'Beach <day>' WHERE original_filename = 'first.jpg'")

    const r = await exportWebGallery(lib, ids, sb.dir, { title: 'Summer: "trip"', description: 'Two days' })
    expect(r).toMatchObject({ exported: 2, failed: 0 })
    expect(r.folder.endsWith('Summer_ _trip_ (web)')).toBe(true)
    expect(readdirSync(join(r.folder, 'photos')).sort()).toEqual(['00001.jpg', '00002.jpg'])

    const index = readFileSync(join(r.folder, 'index.html'), 'utf8')
    expect(index).toContain('<title>Summer: &quot;trip&quot;</title>')
    expect(index).toContain(String.raw`Beach \u003cday>`) // captions cannot break out of the script
    expect(index.indexOf('2021-03-04')).toBeLessThan(index.indexOf('2022-08-01')) // oldest first

    const big = await sharp(join(r.folder, 'photos', '00002.jpg')).metadata()
    expect(Math.max(big.width ?? 0, big.height ?? 0)).toBe(2048)
    const first = await sharp(join(r.folder, 'photos', '00001.jpg')).metadata()
    expect(first.exif).toBeUndefined() // no GPS or camera details
  })
})
