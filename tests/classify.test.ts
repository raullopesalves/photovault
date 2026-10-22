import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { ClassifyQueue } from '@core/library/classifyQueue'
import { classifyAsset, deviceFoldersFromSidecar, type ClassifyInput } from '@core/media/classify'
import { facets, setHiddenByQuery } from '@core/repo/filters'
import { assetDetail, timeline } from '@core/repo/queries'
import { makeJpeg, makeMp4, makeZip, openLibrary, runImport, sandbox, writeText, type Sandbox } from './helpers'

function put(path: string, data?: Buffer): string {
  mkdirSync(dirname(path), { recursive: true })
  if (data) writeFileSync(path, data)
  return path
}

const base: ClassifyInput = {
  mediaType: 'photo',
  mime: 'image/jpeg',
  width: 1600,
  height: 1200,
  durationMs: null,
  hasAudio: null,
  frames: 1,
  cameraMake: null,
  cameraModel: null,
  tags: {},
  filenames: [],
  folders: [],
  deviceFolders: [],
  sharedWithMe: false,
  metadataStripped: false
}

describe('classifyAsset rules', () => {
  it('recognises chat-app media by file name, folder and Google Photos device folder', () => {
    expect(classifyAsset({ ...base, filenames: ['IMG-20190815-WA0012.jpg'] }).origin).toBe('whatsapp')
    expect(classifyAsset({ ...base, filenames: ['WhatsApp Image 2019-08-15 at 11.22.33.jpeg'] }).origin).toBe('whatsapp')
    expect(classifyAsset({ ...base, folders: ['Phone/WhatsApp/Media/WhatsApp Images'], filenames: ['x.jpg'] }).origin).toBe('whatsapp')
    expect(classifyAsset({ ...base, filenames: ['photo_2021-01-02_10-11-12.jpg'] }).origin).toBe('telegram')
    expect(classifyAsset({ ...base, filenames: ['FB_IMG_1565860800000.jpg'] }).origin).toBe('facebook')
    expect(classifyAsset({ ...base, filenames: ['Screenshot_20240101-101010_Chrome.png'] }).origin).toBe('screenshot')
    expect(classifyAsset({ ...base, mediaType: 'video', filenames: ['RPReplay_Final1612345678.mp4'] }).origin).toBe('screen_recording')

    const c = classifyAsset({ ...base, deviceFolders: ['WhatsApp Images'], filenames: ['IMG_1234.jpg'] })
    expect(c.origin).toBe('whatsapp')
    expect(c.originEvidence[0]).toMatch(/phone folder “WhatsApp Images”/)
    expect(c.originEvidence).toContain('No camera metadata (typical of re-sent or saved images)')
  })

  it('prefers stronger evidence: Google’s device folder beats file name, and camera EXIF is the weakest signal', () => {
    expect(classifyAsset({ ...base, deviceFolders: ['Screenshots'], filenames: ['IMG-20190815-WA0012.jpg'] }).origin).toBe('screenshot')
    expect(classifyAsset({ ...base, cameraMake: 'Apple', cameraModel: 'iPhone 14 Pro' }).origin).toBe('camera')
    expect(classifyAsset({ ...base, cameraMake: 'Apple', cameraModel: 'iPhone 14 Pro', filenames: ['IMG-20190815-WA0012.jpg'] }).origin).toBe('whatsapp')
    expect(classifyAsset({ ...base, filenames: ['IMG_1234.jpg'] }).origin).toBeNull() // no guessing
    expect(classifyAsset({ ...base, filenames: ['PXL_20240512_101010123.jpg'] }).origin).toBe('camera')
    expect(classifyAsset({ ...base, filenames: ['IMG_20240512_101010.jpg'] }).origin).toBe('camera')
    expect(classifyAsset({ ...base, filenames: ['IMG-20240512-WA0001.jpg'] }).origin).toBe('whatsapp')
    expect(classifyAsset({ ...base, filenames: ['DJI_0042.JPG'] }).origin).toBe('camera')
  })

  it('marks photos without any camera data as probably received or saved, sub-grouped by size', () => {
    const wa = classifyAsset({ ...base, metadataStripped: true, width: 1600, height: 1200, filenames: ['46777.jpg'] })
    expect(wa).toMatchObject({ origin: 'received', originConfidence: 'probable', originHint: 'whatsapp_size' })
    expect(wa.originEvidence.join(' ')).toMatch(/WhatsApp resizes/)
    expect(classifyAsset({ ...base, metadataStripped: true, width: 1536, height: 2048 })).toMatchObject({ origin: 'received', originHint: 'social_size' })
    expect(classifyAsset({ ...base, metadataStripped: true, width: 1080, height: 1920 })).toMatchObject({ origin: 'received', originHint: null })
    // Camera-sized photos with no metadata are probably the owner's own, edited or exported: no guess.
    expect(classifyAsset({ ...base, metadataStripped: true, width: 3840, height: 5120 }).origin).toBeNull()
    expect(classifyAsset({ ...base, metadataStripped: true, width: 1476, height: 3280 }).origin).toBeNull()
    // Direct evidence always wins over the inference, and videos are never inferred.
    expect(classifyAsset({ ...base, metadataStripped: true, filenames: ['Screenshot_20240101-101010.png'] })).toMatchObject({ origin: 'screenshot', originConfidence: 'certain' })
    expect(classifyAsset({ ...base, metadataStripped: false, width: 1600, height: 1200 }).origin).toBeNull()
    // Videos with no recording date: probably received; WhatsApp's re-encode sizes get the WhatsApp hint.
    expect(classifyAsset({ ...base, mediaType: 'video', mime: 'video/mp4', metadataStripped: true, width: 480, height: 848 })).toMatchObject({
      origin: 'received',
      originHint: 'whatsapp_size'
    })
    expect(classifyAsset({ ...base, mediaType: 'video', mime: 'video/mp4', metadataStripped: true, width: 1280, height: 720 }).originHint).toBeNull()
    expect(classifyAsset({ ...base, mediaType: 'video', mime: 'video/mp4', metadataStripped: false, width: 480, height: 848 }).origin).toBeNull()
    // iPhone screenshots are PNGs with IMG_ names.
    expect(classifyAsset({ ...base, mime: 'image/png', filenames: ['IMG_2078.PNG'] }).origin).toBe('screenshot')
    expect(classifyAsset({ ...base, mime: 'image/jpeg', filenames: ['IMG_2078.JPG'] }).origin).toBeNull()
  })

  it('reads app markers embedded in videos', () => {
    const c = classifyAsset({ ...base, mediaType: 'video', mime: 'video/mp4', tags: { VideoComment: 'vid:v12044gd0000abc' }, hasAudio: true, durationMs: 15000 })
    expect(c.origin).toBe('tiktok')
  })

  it('classifies kinds: silent short videos are loops (GIFs), stickers, animated images', () => {
    expect(classifyAsset({ ...base, mediaType: 'video', mime: 'video/mp4', hasAudio: false, durationMs: 4200 }).kind).toBe('loop')
    expect(classifyAsset({ ...base, mediaType: 'video', mime: 'video/mp4', hasAudio: true, durationMs: 4200 }).kind).toBe('video')
    expect(classifyAsset({ ...base, mediaType: 'video', mime: 'video/mp4', hasAudio: false, durationMs: 120_000 }).kind).toBe('video')
    expect(classifyAsset({ ...base, mime: 'image/webp', width: 512, height: 512 }).kind).toBe('sticker')
    expect(classifyAsset({ ...base, mime: 'image/gif', frames: 12 }).kind).toBe('animated')
    expect(classifyAsset({ ...base }).kind).toBe('photo')
  })

  it('finds Google Photos device folders anywhere under googlePhotosOrigin', () => {
    expect(
      deviceFoldersFromSidecar({ googlePhotosOrigin: { mobileUpload: { deviceFolder: { localFolderName: 'WhatsApp Video' }, deviceType: 'ANDROID_PHONE' } } })
    ).toEqual({ folders: ['WhatsApp Video'], shared: false })
    expect(deviceFoldersFromSidecar({ googlePhotosOrigin: { fromSharedAlbum: {} } })).toEqual({ folders: [], shared: true })
    expect(deviceFoldersFromSidecar({ title: 'x' })).toEqual({ folders: [], shared: false })
  })
})

describe('labelling a real import + hiding clutter', () => {
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

  it('labels a phone backup, filters by origin/kind and hides WhatsApp clutter without touching files', async () => {
    const wa = join(sb.source, 'WhatsApp', 'Media')
    await makeJpeg(join(wa, 'WhatsApp Images', 'IMG-20200101-WA0001.jpg'), { color: '#110000' })
    await makeJpeg(join(wa, 'WhatsApp Images', 'IMG-20200101-WA0002.jpg'), { color: '#220000' })
    put(join(wa, 'WhatsApp Animated Gifs', 'VID-20200101-WA0003.mp4'), makeMp4({ createdUtc: new Date('2020-01-01T10:00:00Z'), durationS: 4, width: 480, height: 480 }))
    put(join(sb.source, 'Movies', 'cat.mp4'), makeMp4({ createdUtc: new Date('2021-01-01T10:00:00Z'), durationS: 9, width: 720, height: 1280, audio: true, tags: { '©cmt': 'vid:v0abc123' } }))
    await sharp({ create: { width: 512, height: 512, channels: 4, background: '#00ff0080' } }).webp().toFile(put(join(wa, 'WhatsApp Stickers', 'STK-20200101-WA0004.webp')))
    await sharp({ create: { width: 1080, height: 2400, channels: 3, background: '#ffffff' } }).png().toFile(put(join(sb.source, 'Pictures', 'Screenshots', 'Screenshot_20200102-101010.png')))
    await makeJpeg(join(sb.source, 'DCIM', 'Camera', 'IMG_20200103_101010.jpg'), { color: '#003300', make: 'Google', model: 'Pixel 7' })

    await runImport(lib, sb.source)
    await new ClassifyQueue(lib).drain()

    const origin = (name: string): { origin: string | null; kind: string | null } => {
      const id = lib.db.get<{ id: number }>('SELECT id FROM assets WHERE original_filename = ?', [name])!.id
      const d = assetDetail(lib, id)!
      return { origin: d.origin, kind: d.kind }
    }
    expect(origin('IMG-20200101-WA0001.jpg')).toEqual({ origin: 'whatsapp', kind: 'photo' })
    expect(origin('VID-20200101-WA0003.mp4')).toEqual({ origin: 'whatsapp', kind: 'loop' })
    expect(origin('STK-20200101-WA0004.webp')).toEqual({ origin: 'whatsapp', kind: 'sticker' })
    expect(origin('cat.mp4')).toEqual({ origin: 'tiktok', kind: 'video' })
    expect(origin('Screenshot_20200102-101010.png')).toEqual({ origin: 'screenshot', kind: 'photo' })
    expect(origin('IMG_20200103_101010.jpg')).toEqual({ origin: 'camera', kind: 'photo' })

    const f = facets(lib)
    expect(f.origins.find((o) => o.origin === 'whatsapp')?.count).toBe(4)
    expect(f.kinds.find((k) => k.kind === 'loop')?.count).toBe(1)

    const total = (q: Parameters<typeof timeline>[1]): number => timeline(lib, q).reduce((s, g) => s + g.count, 0)
    expect(setHiddenByQuery(lib, { origin: 'whatsapp' }, true)).toBe(4)
    expect(total({ hidden: 'exclude' })).toBe(3)
    expect(total({ hidden: 'only' })).toBe(4)
    expect(total({})).toBe(7)
    expect(facets(lib).hidden).toBe(4)
    expect(setHiddenByQuery(lib, { origin: 'whatsapp', kind: 'photo' }, false)).toBe(2)
    expect(total({ hidden: 'exclude' })).toBe(5)
    expect(lib.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM files')?.n).toBe(7)
  })

  it('re-labels existing assets (backfill) by reading the managed file when facts are missing', async () => {
    await makeJpeg(join(sb.source, 'IMG-20200101-WA0009.jpg'), { color: '#123412' })
    writeFileSync(join(sb.source, 'loop.mp4'), makeMp4({ createdUtc: new Date('2020-01-01T10:00:00Z'), durationS: 3, width: 320, height: 320 }))
    await runImport(lib, sb.source)
    // Simulate a library imported before labelling existed.
    lib.db.run('UPDATE assets SET classify_version = 0, has_audio = NULL, origin = NULL, kind = NULL')
    await new ClassifyQueue(lib).drain()
    const kinds = lib.db.all<{ original_filename: string; origin: string | null; kind: string; has_audio: number | null }>(
      'SELECT original_filename, origin, kind, has_audio FROM assets ORDER BY original_filename'
    )
    expect(kinds).toEqual([
      { original_filename: 'IMG-20200101-WA0009.jpg', origin: 'whatsapp', kind: 'photo', has_audio: null },
      { original_filename: 'loop.mp4', origin: null, kind: 'loop', has_audio: 0 }
    ])
  })

  it('uses the Google Photos device folder recorded in a Takeout sidecar', async () => {
    const img = await makeJpeg(join(sb.dir, 'raw', 'IMG_1234.jpg'), { color: '#999999' })
    const GP = 'Takeout/Google Photos/Photos from 2019'
    const zip = await makeZip(join(sb.dir, 't.zip'), [
      { name: `${GP}/IMG_1234.jpg`, file: img },
      {
        name: `${GP}/IMG_1234.jpg.json`,
        data: JSON.stringify({
          title: 'IMG_1234.jpg',
          photoTakenTime: { timestamp: '1565860800' },
          googlePhotosOrigin: { mobileUpload: { deviceFolder: { localFolderName: 'WhatsApp Images' }, deviceType: 'ANDROID_PHONE' } }
        })
      }
    ])
    await runImport(lib, zip)
    await new ClassifyQueue(lib).drain()
    const d = assetDetail(lib, lib.db.get<{ id: number }>('SELECT id FROM assets')!.id)!
    expect(d.origin).toBe('whatsapp')
    expect(d.originEvidence[0]).toBe('Google Photos backed it up from the phone folder “WhatsApp Images”')
    await writeText(join(sb.dir, 'done'), 'ok')
  })
})
