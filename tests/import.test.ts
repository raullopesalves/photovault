import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sha256File } from '@core/media/hash'
import { ImportService } from '@core/import/service'
import type { Library } from '@core/library/library'
import { assetDetail, importItems } from '@core/repo/queries'
import { copy, count, makeJpeg, managedFiles, openLibrary, runImport, sandbox, writeText, type Sandbox } from './helpers'

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

describe('exact duplicate detection', () => {
  it('same file imported twice -> one logical asset', async () => {
    await makeJpeg(join(sb.source, 'photoA.jpg'), { color: '#ff0000' })

    const first = await runImport(lib, sb.source)
    expect(first.newAssets).toBe(1)
    expect(first.assetsCreated).toBe(1)

    const second = await runImport(lib, sb.source)
    expect(second.newAssets).toBe(0)
    expect(second.duplicatesLibrary).toBe(1)
    expect(second.assetsCreated).toBe(0)

    expect(count(lib, 'assets')).toBe(1)
    expect(count(lib, 'files')).toBe(1)
    // Same source path observed twice: one provenance record, seen twice.
    const prov = lib.db.all<{ times_seen: number }>('SELECT times_seen FROM provenance')
    expect(prov).toEqual([{ times_seen: 2 }])
    expect(managedFiles(lib)).toHaveLength(1)
  })

  it('renamed identical file (IMG_1234.jpg + holiday.jpg) -> one asset, two provenance records', async () => {
    const a = await makeJpeg(join(sb.source, 'IMG_1234.jpg'), { color: '#00ff00' })
    await copy(a, join(sb.source, 'holiday.jpg'))

    const s = await runImport(lib, sb.source)
    expect(s.newAssets).toBe(1)
    expect(s.duplicatesBatch).toBe(1)
    expect(count(lib, 'assets')).toBe(1)
    expect(count(lib, 'files')).toBe(1)

    const sources = lib.db.all<{ original_filename: string }>('SELECT original_filename FROM provenance ORDER BY original_filename')
    expect(sources.map((r) => r.original_filename)).toEqual(['IMG_1234.jpg', 'holiday.jpg'])

    const items = importItems(lib, s.importId, 'all', 0, 10)
    const holiday = items.find((i) => i.filename === 'holiday.jpg')
    expect(holiday?.classification).toBe('duplicate_batch')
    expect(holiday?.outcome).toBe('linked')
    expect(holiday?.matchFilename).toBe('IMG_1234.jpg')
  })

  it('renamed copy imported later from another folder -> 0 new, 1 exact duplicate', async () => {
    const original = await makeJpeg(join(sb.source, 'IMG_4927.jpg'), { color: '#123456' })
    await runImport(lib, sb.source)

    const other = join(sb.dir, 'old-hdd')
    await copy(original, join(other, 'holiday_picture.jpg'))
    const s = await runImport(lib, other)
    expect(s.newAssets).toBe(0)
    expect(s.duplicatesLibrary).toBe(1)
    expect(count(lib, 'assets')).toBe(1)

    const assetId = lib.db.get<{ id: number }>('SELECT id FROM assets')!.id
    const detail = assetDetail(lib, assetId)!
    expect(detail.sources.map((x) => x.originalFilename).sort()).toEqual(['IMG_4927.jpg', 'holiday_picture.jpg'])
    expect(detail.files).toHaveLength(1)
  })

  it('same filename, different content (folderA/IMG_1234.jpg vs folderB/IMG_1234.jpg) -> two assets', async () => {
    // Same capture date so both land in the same managed folder and their names collide.
    const date = '2021:07:15 14:32:11'
    await makeJpeg(join(sb.source, 'folderA', 'IMG_1234.jpg'), { color: '#aa0000', dateTimeOriginal: date })
    await makeJpeg(join(sb.source, 'folderB', 'IMG_1234.jpg'), { color: '#0000aa', dateTimeOriginal: date })

    const s = await runImport(lib, sb.source)
    expect(s.newAssets).toBe(2)
    expect(count(lib, 'assets')).toBe(2)
    const files = managedFiles(lib)
    expect(files).toHaveLength(2)
    expect(files[0]).toMatch(/^2021\/07\/IMG_1234(_[0-9a-f]{8})?\.jpg$/)
    expect(new Set(files).size).toBe(2)
    expect(files).toContain('2021/07/IMG_1234.jpg')

    // Each managed file holds exactly the bytes of its own asset.
    for (const f of lib.db.all<{ relative_path: string; sha256: string }>('SELECT relative_path, sha256 FROM files')) {
      expect(await sha256File(join(lib.root, f.relative_path))).toBe(f.sha256)
    }
  })

  it('repeat import of a folder is idempotent', async () => {
    for (let i = 0; i < 5; i++) await makeJpeg(join(sb.source, `sub${i % 2}`, `p${i}.jpg`), { color: `#${(i * 40).toString(16).padStart(2, '0')}8040` })
    await writeText(join(sb.source, 'notes.txt'), 'not a photo')
    await writeText(join(sb.source, 'p0.jpg.json'), '{}')

    const first = await runImport(lib, sb.source)
    expect(first.newAssets).toBe(5)
    expect(first.ignoredFound).toBe(1)
    expect(first.sidecarsFound).toBe(1)
    const filesAfterFirst = managedFiles(lib)

    const second = await runImport(lib, sb.source)
    expect(second.newAssets).toBe(0)
    expect(second.duplicatesLibrary).toBe(5)
    expect(count(lib, 'assets')).toBe(5)
    expect(count(lib, 'files')).toBe(5)
    expect(count(lib, 'provenance')).toBe(5)
    expect(managedFiles(lib)).toEqual(filesAfterFirst)
  })

  it('cancelled analysis writes nothing to the library', async () => {
    await makeJpeg(join(sb.source, 'a.jpg'))
    const summary = await runImport(lib, sb.source, { commit: false })
    expect(summary.newAssets).toBe(1)
    expect(count(lib, 'assets')).toBe(0)
    expect(managedFiles(lib)).toHaveLength(0)
  })
})

describe('source safety', () => {
  it('never modifies or removes source files', async () => {
    const a = await makeJpeg(join(sb.source, 'a.jpg'), { color: '#101010' })
    await copy(a, join(sb.source, 'copy of a.jpg'))
    const before = { hash: await sha256File(a), mtime: statSync(a).mtimeMs, bytes: readFileSync(a) }

    await runImport(lib, sb.source)
    await runImport(lib, sb.source)

    expect(await sha256File(a)).toBe(before.hash)
    expect(statSync(a).mtimeMs).toBe(before.mtime)
    expect(readFileSync(a).equals(before.bytes)).toBe(true)
    expect(statSync(join(sb.source, 'copy of a.jpg')).isFile()).toBe(true)
  })

  it('does not trust extensions: a text file named .jpg is reported, not imported', async () => {
    await writeText(join(sb.source, 'fake.jpg'), 'this is definitely not a jpeg file')
    await makeJpeg(join(sb.source, 'real.jpg'))
    const s = await runImport(lib, sb.source)
    expect(s.newAssets).toBe(1)
    expect(s.unsupported).toBe(1)
    expect(count(lib, 'assets')).toBe(1)
  })

  it('skips the library folder when it is inside the imported folder', async () => {
    lib.close()
    lib = openLibrary(join(sb.source, 'MyLibrary'))
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#550000' })
    await runImport(lib, sb.source)
    const second = await runImport(lib, sb.source)
    expect(second.photosFound).toBe(1)
    expect(count(lib, 'assets')).toBe(1)
  })

  it('a source that changes between analysis and import is not imported', async () => {
    const a = await makeJpeg(join(sb.source, 'a.jpg'), { color: '#777777' })
    const service = new ImportService(lib)
    const id = await service.start(sb.source)
    await service.settle()
    expect(service.current()?.phase).toBe('ready')
    await makeJpeg(a, { color: '#888888' }) // overwritten by someone else after analysis
    await service.commit(id)
    await service.settle()
    const p = service.current()!
    expect(p.phase).toBe('completed')
    expect(p.summary?.filesFailed).toBe(1)
    expect(count(lib, 'assets')).toBe(0)
    expect(managedFiles(lib)).toHaveLength(0)
  })
})

describe('metadata', () => {
  it('extracts capture date, camera, GPS and dimensions; keeps capture/import/file times distinct', async () => {
    await makeJpeg(join(sb.source, 'x.jpg'), {
      width: 120,
      height: 80,
      dateTimeOriginal: '2019:03:04 05:06:07',
      make: 'Canon',
      model: 'EOS R6',
      gps: { lat: '46/1 30/1 0/1', latRef: 'N', lon: '7/1 15/1 0/1', lonRef: 'E' }
    })
    await runImport(lib, sb.source)
    const id = lib.db.get<{ id: number }>('SELECT id FROM assets')!.id
    const d = assetDetail(lib, id)!
    expect(d.captureTime).toBe('2019-03-04T05:06:07')
    expect(d.captureTimeSource).toBe('exif_original')
    expect(d.sortTimeSource).toBe('exif_original')
    expect(d.cameraMake).toBe('Canon')
    expect(d.cameraModel).toBe('EOS R6')
    expect(d.latitude).toBeCloseTo(46.5, 5)
    expect(d.longitude).toBeCloseTo(7.25, 5)
    expect(d.width).toBe(120)
    expect(d.height).toBe(80)
    expect(d.mimeType).toBe('image/jpeg')
    expect(d.files[0]?.relativePath).toBe('originals/2019/03/x.jpg')
    expect(d.importedAt.slice(0, 4)).not.toBe('2019')
    expect(d.sources[0]?.fsModifiedAt).not.toBeNull()
  })

  it('without capture metadata: no capture time, sorted by file modified time, stored as undated', async () => {
    await makeJpeg(join(sb.source, 'scan.jpg'))
    await runImport(lib, sb.source)
    const id = lib.db.get<{ id: number }>('SELECT id FROM assets')!.id
    const d = assetDetail(lib, id)!
    expect(d.captureTime).toBeNull()
    expect(d.captureKnown).toBe(false)
    expect(d.sortTimeSource).toBe('file_modified')
    expect(d.files[0]?.relativePath).toBe('originals/undated/scan.jpg')
  })

  it('falls back to a date in the filename', async () => {
    await makeJpeg(join(sb.source, 'IMG_20200102_030405.jpg'))
    await runImport(lib, sb.source)
    const d = assetDetail(lib, lib.db.get<{ id: number }>('SELECT id FROM assets')!.id)!
    expect(d.captureTime).toBe('2020-01-02T03:04:05')
    expect(d.captureTimeSource).toBe('filename')
  })
})
