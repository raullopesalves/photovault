import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportService } from '@core/import/service'
import { Library } from '@core/library/library'
import { VerifyService, verifyIssues } from '@core/library/verify'
import { sha256File } from '@core/media/hash'
import { utcToLocalWall } from '@core/media/metadata'
import { MoovCollector, readVideoInfoFromBuffer } from '@core/media/video'
import { assetDetail, importItems } from '@core/repo/queries'
import { count, makeJpeg, makeMp4, makeZip, managedFiles, openLibrary, runImport, sandbox, writeText, type Sandbox } from './helpers'

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

const GP = 'Takeout/Google Photos'
const TAKEN = 1565860800 // 2019-08-15T09:20:00Z

function sidecar(title: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ title, photoTakenTime: { timestamp: String(TAKEN), formatted: 'Aug 15, 2019' }, ...extra })
}

function assetByName(name: string): number {
  const row = lib.db.get<{ id: number }>('SELECT id FROM assets WHERE original_filename = ?', [name])
  if (!row) throw new Error(`no asset ${name}`)
  return row.id
}

describe('ZIP archives', () => {
  it('imports media from a ZIP without extracting it; managed copies are byte-identical', async () => {
    const a = await makeJpeg(join(sb.dir, 'raw', 'a.jpg'), { color: '#aa1100', dateTimeOriginal: '2021:05:06 07:08:09' })
    const b = await makeJpeg(join(sb.dir, 'raw', 'b.jpg'), { color: '#1100aa' })
    const zip = await makeZip(join(sb.dir, 'export.zip'), [
      { name: 'photos/a.jpg', file: a, mtime: new Date('2021-05-06T07:08:09Z') },
      { name: 'photos/b.jpg', file: b },
      { name: 'photos/readme.txt', data: 'hello' }
    ])

    const s = await runImport(lib, zip)
    expect(s.sourceType).toBe('ZIP')
    expect(s.archivesFound).toBe(1)
    expect(s.newAssets).toBe(2)
    expect(s.ignoredFound).toBe(1)
    expect(managedFiles(lib)).toEqual(['2021/05/a.jpg', 'undated/b.jpg'])
    const managed = join(lib.paths.originals, '2021', '05', 'a.jpg')
    expect(await sha256File(managed)).toBe(await sha256File(a))
    expect(statSync(managed).mtime.toISOString()).toBe('2021-05-06T07:08:09.000Z')

    const d = assetDetail(lib, assetByName('a.jpg'))!
    expect(d.captureTime).toBe('2021-05-06T07:08:09')
    expect(d.sources[0]?.containerPath).toBe(zip)
    expect(d.sources[0]?.sourcePath).toBe(`${zip}!/photos/a.jpg`)
  })

  it('recognises the same photo in a folder and inside a ZIP as one asset', async () => {
    const a = await makeJpeg(join(sb.source, 'a.jpg'), { color: '#334455' })
    await runImport(lib, sb.source)
    const zip = await makeZip(join(sb.dir, 'backup.zip'), [{ name: 'renamed.jpg', file: a }])
    const s = await runImport(lib, zip)
    expect(s.newAssets).toBe(0)
    expect(s.duplicatesLibrary).toBe(1)
    expect(count(lib, 'assets')).toBe(1)
    expect(count(lib, 'provenance')).toBe(2)
  })

  it('reports unsafe and unreadable archives instead of failing the import', async () => {
    const a = await makeJpeg(join(sb.dir, 'raw', 'a.jpg'), { color: '#665544' })
    // Forge an entry called "../evil.jpg" (yazl refuses to write such a name, so rename the raw bytes).
    await makeZip(join(sb.source, 'bad.zip'), [{ name: 'xx/evil.jpg', file: a }, { name: 'ok/good.jpg', file: a }], [['xx/evil.jpg', '../evil.jpg']])
    writeFileSync(join(sb.source, 'corrupt.zip'), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(200, 1)]))

    const s = await runImport(lib, sb.source)
    expect(s.newAssets).toBe(1)
    expect(s.errors).toBe(2)
    const errors = importItems(lib, s.importId, 'error', 0, 10)
    expect(errors.map((e) => e.error)).toEqual(
      expect.arrayContaining([expect.stringMatching(/invalid relative path|Unsafe path/), expect.stringMatching(/could not be read/)])
    )
    expect(managedFiles(lib)).toEqual(['undated/good.jpg'])
  })

  it('reads video dates and dimensions from inside a ZIP', async () => {
    const mp4 = makeMp4({ createdUtc: new Date('2022-03-04T05:06:07Z'), durationS: 12, width: 1920, height: 1080 })
    const zip = await makeZip(join(sb.dir, 'v.zip'), [{ name: 'clip.mp4', data: mp4 }])
    await runImport(lib, zip)
    const d = assetDetail(lib, assetByName('clip.mp4'))!
    expect(d.mediaType).toBe('video')
    expect(d.durationMs).toBe(12000)
    expect([d.width, d.height]).toEqual([1920, 1080])
    expect(d.captureTimeSource).toBe('quicktime')
    expect(d.captureTime).toBe(utcToLocalWall(Date.parse('2022-03-04T05:06:07Z')).wall)
  })

  it('MoovCollector finds a moov box at the end of a large stream fed in arbitrary chunks', async () => {
    const mp4 = makeMp4({ createdUtc: new Date('2020-01-02T03:04:05Z'), durationS: 3, width: 640, height: 480, mdatBytes: 300_000 })
    const collector = new MoovCollector()
    for (let i = 0; i < mp4.length; i += 777) collector.push(mp4.subarray(i, i + 777))
    expect(collector.moov).not.toBeNull()
    const info = await readVideoInfoFromBuffer(collector.moov!)
    expect(info).toMatchObject({ durationMs: 3000, width: 640, height: 480, createdUtcMs: Date.parse('2020-01-02T03:04:05Z') })
  })
})

describe('Google Takeout', () => {
  async function buildTakeout(): Promise<{ zip1: string; zip2: string; noExif: string; withExif: string }> {
    const noExif = await makeJpeg(join(sb.dir, 'raw', 'IMG_0001.jpg'), { color: '#123123' })
    const withExif = await makeJpeg(join(sb.dir, 'raw', 'IMG_0002.jpg'), { color: '#321321', dateTimeOriginal: '2019:01:02 10:00:00' })
    const long = await makeJpeg(join(sb.dir, 'raw', 'long.jpg'), { color: '#456456' })
    const numbered = await makeJpeg(join(sb.dir, 'raw', 'num.jpg'), { color: '#654654' })
    const longName = 'Screenshot_20190815-112233_A Very Long Application Name.jpg'
    // Volume 1: most media + every sidecar (Takeout often splits media and JSON across volumes).
    const zip1 = await makeZip(join(sb.source, 'takeout-001.zip'), [
      { name: `${GP}/Photos from 2019/IMG_0001.jpg`, file: noExif },
      {
        name: `${GP}/Photos from 2019/IMG_0001.jpg.supplemental-metadata.json`,
        data: sidecar('IMG_0001.jpg', { geoData: { latitude: 46.5, longitude: 7.25, altitude: 0 }, favorited: true, description: 'Lake' })
      },
      { name: `${GP}/Photos from 2019/IMG_0002.jpg`, file: withExif },
      { name: `${GP}/Photos from 2019/IMG_0002.jpg.json`, data: sidecar('IMG_0002.jpg') },
      { name: `${GP}/Summer Trip/IMG_0001.jpg`, file: noExif },
      { name: `${GP}/Summer Trip/IMG_0001.jpg.json`, data: sidecar('IMG_0001.jpg') },
      { name: `${GP}/Summer Trip/metadata.json`, data: JSON.stringify({ title: 'Summer Trip', description: '' }) },
      { name: `${GP}/Photos from 2019/${longName.slice(0, 46)}.json`, data: sidecar(longName) },
      { name: `${GP}/Photos from 2019/IMG_0003.jpg.supplemental-metadata(1).json`, data: sidecar('IMG_0003.jpg') }
    ])
    // Volume 2: media whose sidecars live in volume 1.
    const zip2 = await makeZip(join(sb.source, 'takeout-002.zip'), [
      { name: `${GP}/Photos from 2019/${longName}`, file: long },
      { name: `${GP}/Photos from 2019/IMG_0003(1).jpg`, file: numbered }
    ])
    return { zip1, zip2, noExif, withExif }
  }

  it('detects Takeout, matches sidecars across volumes and applies metadata with documented precedence', async () => {
    await buildTakeout()
    const s = await runImport(lib, sb.source) // folder containing both ZIPs
    expect(s.sourceType).toBe('GOOGLE_TAKEOUT')
    expect(s.archivesFound).toBe(2)
    expect(s.photosFound).toBe(5)
    expect(s.newAssets).toBe(4)
    expect(s.duplicatesBatch).toBe(1) // IMG_0001 in the album folder and the year folder
    expect(s.sidecarsMatched).toBe(5)
    expect(s.takeoutItems).toBe(5)

    // No EXIF: date and location from the sidecar; favourite and description carried over.
    const one = assetDetail(lib, assetByName('IMG_0001.jpg'))!
    expect(one.captureTimeSource).toBe('takeout')
    expect(one.captureTime).toBe(utcToLocalWall(TAKEN * 1000).wall)
    expect([one.latitude, one.longitude]).toEqual([46.5, 7.25])
    expect(one.favorite).toBe(true)
    expect(one.description).toBe('Lake')
    // One asset, two places – one of them the "Summer Trip" album, with the sidecar JSON preserved verbatim.
    expect(one.sources).toHaveLength(2)
    expect(one.sources.map((x) => x.album).sort()).toEqual(['Summer Trip', null].sort())
    expect(one.sources.every((x) => x.sourceType === 'GOOGLE_TAKEOUT' && x.sidecarPath !== null)).toBe(true)
    const provJson = lib.db.get<{ sidecar_json: string }>('SELECT sidecar_json FROM provenance WHERE album IS NULL AND asset_id = ?', [one.id])!
    expect(JSON.parse(provJson.sidecar_json).description).toBe('Lake')

    // Camera EXIF wins over the sidecar time.
    const two = assetDetail(lib, assetByName('IMG_0002.jpg'))!
    expect(two.captureTimeSource).toBe('exif_original')
    expect(two.captureTime).toBe('2019-01-02T10:00:00')

    // Truncated and numbered sidecar names in the other volume.
    expect(assetDetail(lib, assetByName('Screenshot_20190815-112233_A Very Long Application Name.jpg'))!.captureTimeSource).toBe('takeout')
    expect(assetDetail(lib, assetByName('IMG_0003(1).jpg'))!.captureTimeSource).toBe('takeout')
  })

  it('re-importing the same Takeout is idempotent and reuses hashes of unchanged entries', async () => {
    const { zip1, zip2 } = await buildTakeout()
    await runImport(lib, [zip1, zip2])
    const second = await runImport(lib, [zip2, zip1])
    expect(second.newAssets).toBe(0)
    expect(second.duplicatesLibrary).toBe(5)
    expect(second.hashesReused).toBe(5)
    expect(count(lib, 'assets')).toBe(4)
    expect(count(lib, 'provenance')).toBe(5)
  })
})

describe('re-hash shortcut', () => {
  it('reuses hashes of unchanged files and re-reads changed ones', async () => {
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#101010' })
    const b = await makeJpeg(join(sb.source, 'b.jpg'), { color: '#202020' })
    const first = await runImport(lib, sb.source)
    expect(first.hashesReused).toBe(0)

    const second = await runImport(lib, sb.source)
    expect(second.hashesReused).toBe(2)
    expect(second.duplicatesLibrary).toBe(2)

    await makeJpeg(b, { color: '#303030', width: 70 }) // edited in place: new size/mtime
    const third = await runImport(lib, sb.source)
    expect(third.hashesReused).toBe(1)
    expect(third.newAssets).toBe(1)
    expect(count(lib, 'assets')).toBe(3)
  })
})

describe('resuming interrupted imports', () => {
  it('an analysed import interrupted by closing the app can be resumed and completed', async () => {
    for (let i = 0; i < 3; i++) await makeJpeg(join(sb.source, `p${i}.jpg`), { color: `#${i}0${i}0${i}0` })
    const svc = new ImportService(lib)
    const id = await svc.start(sb.source)
    await svc.settle()
    expect(svc.current()?.phase).toBe('ready')
    svc.shutdown()
    lib.close()

    lib = Library.open(sb.libraryRoot)
    const status = lib.db.get<{ status: string }>('SELECT status FROM imports WHERE id = ?', [id])?.status
    expect(status).toBe('interrupted')
    const resumed = new ImportService(lib)
    const p = resumed.resume(id)
    expect(p.phase).toBe('ready')
    expect(p.summary?.newAssets).toBe(3)
    await resumed.commit(id)
    await resumed.settle()
    expect(resumed.current()?.phase).toBe('completed')
    expect(count(lib, 'assets')).toBe(3)
  })

  it('a partially committed import resumes without duplicating work, adopting files copied before the crash', async () => {
    for (let i = 0; i < 3; i++) await makeJpeg(join(sb.source, `p${i}.jpg`), { color: `#${i}${i}0000` })
    const svc = new ImportService(lib)
    const id = await svc.start(sb.source)
    await svc.settle()
    await svc.commit(id)
    await svc.settle()
    // Simulate a crash after p1.jpg was copied but before its database row was written.
    const p1 = lib.db.get<{ id: number; asset_id: number }>("SELECT id, asset_id FROM import_items WHERE filename = 'p1.jpg'")!
    lib.db.tx(() => {
      lib.db.run('DELETE FROM provenance WHERE asset_id = ?', [p1.asset_id])
      lib.db.run('DELETE FROM asset_thumbnails WHERE asset_id = ?', [p1.asset_id])
      lib.db.run('DELETE FROM files WHERE asset_id = ?', [p1.asset_id])
      lib.db.run('UPDATE import_items SET outcome = NULL, asset_id = NULL WHERE id = ?', [p1.id])
      lib.db.run('DELETE FROM assets WHERE id = ?', [p1.asset_id])
      lib.db.run("UPDATE imports SET status = 'importing' WHERE id = ?", [id])
    })
    lib.close()
    lib = Library.open(sb.libraryRoot)

    const resumed = new ImportService(lib)
    expect(resumed.resume(id).summary?.resumable).toBe(false) // now 'ready'
    await resumed.commit(id)
    await resumed.settle()
    expect(count(lib, 'assets')).toBe(3)
    expect(managedFiles(lib)).toEqual(['undated/p0.jpg', 'undated/p1.jpg', 'undated/p2.jpg'])
  })
})

describe('library verification', () => {
  it('detects missing and altered originals without touching any file', async () => {
    for (let i = 0; i < 3; i++) await makeJpeg(join(sb.source, `v${i}.jpg`), { color: `#00${i}${i}00` })
    await runImport(lib, sb.source)

    const verify = new VerifyService(lib)
    verify.start()
    await verify.settle()
    expect(verify.current()).toMatchObject({ status: 'completed', ok: 3, missing: 0, mismatched: 0, filesChecked: 3 })

    const altered = join(lib.paths.originals, 'undated', 'v1.jpg')
    await writeText(altered, 'bit rot')
    rmSync(join(lib.paths.originals, 'undated', 'v2.jpg'))
    verify.start()
    await verify.settle()
    expect(verify.current()).toMatchObject({ status: 'completed', ok: 1, missing: 1, mismatched: 1 })
    expect(verifyIssues(lib, 0, 10).map((i) => [i.relativePath, i.status])).toEqual([
      ['originals/undated/v1.jpg', 'mismatch'],
      ['originals/undated/v2.jpg', 'missing']
    ])
    expect(readFileSync(altered, 'utf8')).toBe('bit rot') // reported, never "repaired" or deleted
    expect(count(lib, 'assets')).toBe(3)

    // Re-importing the original source restores the *missing* original (not the damaged one) to its old path.
    const again = await runImport(lib, sb.source)
    expect(again.newAssets).toBe(0)
    expect(await sha256File(join(lib.paths.originals, 'undated', 'v2.jpg'))).toBe(await sha256File(join(sb.source, 'v2.jpg')))
    expect(readFileSync(altered, 'utf8')).toBe('bit rot')
    verify.start()
    await verify.settle()
    expect(verify.current()).toMatchObject({ ok: 2, missing: 0, mismatched: 1 })
  })
})
