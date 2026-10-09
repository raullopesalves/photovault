import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { extractRawPreview } from '@core/media/raw'
import { assetDetail } from '@core/repo/queries'
import { ThumbnailQueue } from '@core/thumbnails/thumbnails'
import { openLibrary, photoScene, runImport, sandbox, type Sandbox } from './helpers'

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

/** A TIFF-style "RAW" file: header, a small JPEG thumbnail, then the big preview whose EXIF holds yet another JPEG. */
async function fakeRaw(path: string): Promise<void> {
  const big = await sharp(photoScene(4)).resize(1200, 900).jpeg({ quality: 85 }).toBuffer()
  const nested = await sharp(photoScene(4)).resize(160, 120).jpeg().toBuffer()
  const small = await sharp(photoScene(4)).resize(320, 240).jpeg().toBuffer()
  const app1Body = Buffer.concat([Buffer.from('Exif\0\0'), nested])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(app1Body.length + 2) >> 8, (app1Body.length + 2) & 0xff]), app1Body])
  const preview = Buffer.concat([big.subarray(0, 2), app1, big.subarray(2)])
  const header = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(2000)])
  writeFileSync(path, Buffer.concat([header, small, Buffer.alloc(500), preview, Buffer.alloc(3000)]))
}

describe('camera RAW files', () => {
  it('uses the embedded full-size preview for thumbnails and viewing', async () => {
    await fakeRaw(join(sb.source, 'DSC_0042.NEF'))
    const preview = await extractRawPreview(join(sb.source, 'DSC_0042.NEF'))
    const meta = await sharp(preview!).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 900]) // the big preview, not a nested thumbnail

    await runImport(lib, sb.source)
    await new ThumbnailQueue(lib).drain()
    const id = lib.db.get<{ id: number }>('SELECT id FROM assets')!.id
    const t = lib.db.get<{ generator: string; width: number }>("SELECT generator, width FROM asset_thumbnails WHERE asset_id = ? AND variant = 'thumb'", [id])
    expect(t).toEqual({ generator: 'raw-preview', width: 512 })
    expect(assetDetail(lib, id)).toMatchObject({ mimeType: 'image/x-nikon-nef', fullView: 'preview', thumb: 'ready' })
  })
})
