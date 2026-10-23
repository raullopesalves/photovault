import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sidecar } from 'exifr'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Library } from '@core/library/library'
import { BackupService } from '@core/library/backup'
import { deletePermanently, moveToBin } from '@core/library/bin'
import { CATALOGUE_FILE, MetadataExporter, combinedOrientation, sidecarPath, writeSidecars } from '@core/library/metadataExport'
import { addManualFace, setDescription, setLocation, setTags } from '@core/repo/annotate'
import { createAlbum } from '@core/repo/albums'
import { moveFaces } from '@core/repo/people'
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
const fileOf = (id: number): string => lib.db.get<{ relative_path: string }>("SELECT relative_path FROM files WHERE asset_id = ? AND role = 'original'", [id])!.relative_path

async function libraryWithMetadata(): Promise<{ a: number; b: number }> {
  await makeJpeg(join(sb.source, 'a.jpg'), { color: '#101010', dateTimeOriginal: '2019:07:14 19:42:00' })
  await makeJpeg(join(sb.source, 'b.jpg'), { color: '#606060', dateTimeOriginal: '2021:03:02 08:00:00' })
  await runImport(lib, sb.source)
  const a = idOf('a.jpg')
  const b = idOf('b.jpg')
  setTags(lib, [a], ['beach', 'family'], [])
  setDescription(lib, a, 'First swim of the summer')
  setLocation(lib, [a], { lat: 38.3816, lon: -8.7801 })
  lib.db.run('UPDATE assets SET favorite = 1 WHERE id = ?', [a])
  createAlbum(lib, 'Summer 2019', [a])
  const face = addManualFace(lib, a, { x: 0.3, y: 0.2, w: 0.2, h: 0.25 }, null)
  moveFaces(lib, [face], { newName: 'Avó Maria' })
  return { a, b }
}

describe('metadata outside the app', () => {
  it('writes an XMP sidecar next to each original that another reader understands', async () => {
    const { a, b } = await libraryWithMetadata()
    await new MetadataExporter(lib, '1.0.0').flush()

    const path = sidecarPath(lib, fileOf(a))
    expect(path.endsWith('a.jpg.xmp')).toBe(true)
    expect(existsSync(path)).toBe(true)
    expect(existsSync(sidecarPath(lib, fileOf(b)))).toBe(true)
    // Originals are never touched: only the sidecar is new.
    expect(existsSync(join(lib.root, ...fileOf(a).split('/')))).toBe(true)

    // Read back with exifr, the independent EXIF/XMP library Photo Vault uses for imports.
    type Ns = Record<string, unknown>
    const x = (await sidecar(path)) as Record<string, Ns>
    const xml = readFileSync(path, 'utf8')
    expect(x.exif?.DateTimeOriginal).toBe('2019-07-14T19:42:00')
    expect(x.xmp?.Rating).toBe(5)
    expect(x.dc?.subject).toEqual(['beach', 'family'])
    expect((x.dc?.description as { value: string }).value).toBe('First swim of the summer')
    expect(x.lr?.hierarchicalSubject).toEqual(expect.arrayContaining(['Tags|beach', 'Albums|Summer 2019', 'People|Avó Maria']))
    expect([x.Iptc4xmpExt?.PersonInImage].flat()).toContain('Avó Maria')
    expect(x.pv).toMatchObject({ Favourite: true, Hidden: false, InBin: false, LocationSource: 'manual' })
    expect(xml).toMatch(/exif:GPSLatitude="38,22\.\d+N"/)
    expect(xml).toMatch(/exif:GPSLongitude="8,46\.\d+W"/)
    expect(xml).toContain('pv:Favourite="True"')

    // The catalogue export holds everything, readable as plain JSON.
    const cat = JSON.parse(readFileSync(join(lib.root, CATALOGUE_FILE), 'utf8')) as {
      format: string
      assets: Array<{ id: number; tags: string[]; albums: string[]; people: string[]; latitude: number | null; file: string }>
      albums: Array<{ name: string; assets: number[] }>
      people: Array<{ name: string | null; assets: number[] }>
    }
    expect(cat.format).toBe('photo-vault-catalogue')
    expect(cat.assets).toHaveLength(2)
    const ea = cat.assets.find((x) => x.id === a)!
    expect(ea).toMatchObject({ tags: ['beach', 'family'], albums: ['Summer 2019'], people: ['Avó Maria'], latitude: 38.3816 })
    expect(ea.file.startsWith('originals/')).toBe(true)
    expect(cat.albums).toEqual([expect.objectContaining({ name: 'Summer 2019', assets: [a] })])
    expect(cat.people).toEqual([expect.objectContaining({ name: 'Avó Maria', assets: [a] })])
    expect(existsSync(join(lib.root, 'metadata', 'README.txt'))).toBe(true)
  })

  it('keeps sidecars current and leaves unchanged ones alone', async () => {
    const { a, b } = await libraryWithMetadata()
    const exporter = new MetadataExporter(lib)
    await exporter.flush()
    const pathB = sidecarPath(lib, fileOf(b))
    const before = statSync(pathB).mtimeMs
    expect(await writeSidecars(lib, [a, b])).toBe(0) // nothing changed: nothing written

    setTags(lib, [a], [], ['beach'])
    lib.db.run("UPDATE persons SET name = 'Maria' WHERE name = 'Avó Maria'")
    expect(lib.db.all('SELECT asset_id FROM metadata_dirty').map((r) => (r as { asset_id: number }).asset_id)).toEqual([a])
    await exporter.flush()
    const xml = readFileSync(sidecarPath(lib, fileOf(a)), 'utf8')
    expect(xml).not.toContain('Tags|beach')
    expect(xml).toContain('People|Maria')
    expect(statSync(pathB).mtimeMs).toBe(before)
    expect(lib.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM metadata_dirty')!.n).toBe(0)
  })

  it('removes the sidecar with a permanently deleted original, and backups carry sidecars and the catalogue', async () => {
    const { a, b } = await libraryWithMetadata()
    await new MetadataExporter(lib).flush()

    const target = join(sb.dir, 'E-drive')
    mkdirSync(target)
    const svc = new BackupService(lib)
    const t = svc.addTarget(target)
    expect(await svc.run(t.id)).toMatchObject({ status: 'completed', failed: 0 })
    expect(existsSync(join(target, ...`${fileOf(a)}.xmp`.split('/')))).toBe(true)
    expect(existsSync(join(target, ...CATALOGUE_FILE.split('/')))).toBe(true)

    const sidecarB = sidecarPath(lib, fileOf(b))
    moveToBin(lib, [b])
    await deletePermanently(lib, [b])
    expect(existsSync(sidecarB)).toBe(false)
  })

  it('turns the original orientation by the user rotation', () => {
    expect(combinedOrientation(null, 0)).toBeNull()
    expect(combinedOrientation(1, 90)).toBe(6)
    expect(combinedOrientation(6, 90)).toBe(3)
    expect(combinedOrientation(8, 90)).toBe(1)
    expect(combinedOrientation(1, 270)).toBe(8)
    expect(combinedOrientation(2, 90)).toBeNull() // mirrored: left alone
  })
})
