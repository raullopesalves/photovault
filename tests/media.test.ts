import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyByExtension, sniffBuffer } from '@core/media/formats'
import { dateFromFilename } from '@core/media/filenameDate'
import { parseExifDate } from '@core/media/metadata'
import { Database } from '@core/db/database'
import { migrations, runMigrations, schemaVersion, SchemaTooNewError } from '@core/db/migrations'
import { sandbox } from './helpers'

function ftyp(brand: string): Buffer {
  const b = Buffer.alloc(32)
  b.writeUInt32BE(24, 0)
  b.write('ftyp', 4, 'latin1')
  b.write(brand, 8, 'latin1')
  return b
}

describe('format sniffing', () => {
  it('identifies by content, not extension', () => {
    expect(sniffBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), 'x.png')?.mime).toBe('image/jpeg')
    expect(sniffBuffer(ftyp('heic'), 'IMG.HEIC')).toEqual({ mediaType: 'photo', mime: 'image/heic' })
    expect(sniffBuffer(ftyp('qt  '), 'clip.mov')).toEqual({ mediaType: 'video', mime: 'video/quicktime' })
    expect(sniffBuffer(ftyp('isom'), 'clip.mp4')).toEqual({ mediaType: 'video', mime: 'video/mp4' })
    expect(sniffBuffer(Buffer.from('this is plain text, not media'), 'x.jpg')).toBeNull()
  })

  it('classifies extensions into media, sidecars and ignored', () => {
    expect(classifyByExtension('a.JPG').kind).toBe('media')
    expect(classifyByExtension('a.heic').kind).toBe('media')
    expect(classifyByExtension('a.mp4').kind).toBe('media')
    expect(classifyByExtension('a.jpg.json').kind).toBe('sidecar')
    expect(classifyByExtension('a.txt').kind).toBe('ignored')
  })
})

describe('dates', () => {
  it('parses EXIF dates and rejects placeholders', () => {
    expect(parseExifDate('2021:07:15 14:32:11')).toEqual({ wall: '2021-07-15T14:32:11', offsetMinutes: null })
    expect(parseExifDate('2021:07:15 14:32:11', '45')?.wall).toBe('2021-07-15T14:32:11.450')
    expect(parseExifDate('2021-07-15T14:32:11+02:00')).toEqual({ wall: '2021-07-15T14:32:11', offsetMinutes: 120 })
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull()
    expect(parseExifDate('    ')).toBeNull()
  })

  it('reads dates from common filename patterns', () => {
    expect(dateFromFilename('IMG_20240715_143211.jpg')).toBe('2024-07-15T14:32:11')
    expect(dateFromFilename('PXL_20240715_143211123.jpg')).toBe('2024-07-15T14:32:11')
    expect(dateFromFilename('Screenshot_2024-07-15-14-32-11.png')).toBe('2024-07-15T14:32:11')
    expect(dateFromFilename('2024-07-15 14.32.11.jpg')).toBe('2024-07-15T14:32:11')
    expect(dateFromFilename('IMG-20240715-WA0001.jpg')).toBe('2024-07-15T00:00:00')
    expect(dateFromFilename('IMG_1234.jpg')).toBeNull()
    expect(dateFromFilename('holiday.jpg')).toBeNull()
    expect(dateFromFilename('IMG_20241345_000000.jpg')).toBeNull()
  })
})

describe('migrations', () => {
  it('applies once, upgrades older libraries and refuses a schema newer than this build', async () => {
    const sb = sandbox()
    try {
      const file = join(sb.dir, 'test.db')
      let db = Database.open(file)
      expect(schemaVersion(db)).toBe(migrations.length)
      db.close()
      db = Database.open(file) // reopening must not re-apply
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM schema_migrations')?.n).toBe(migrations.length)
      db.close()

      // A library created by the first release (schema v1) upgrades in place without losing rows.
      const oldFile = join(sb.dir, 'v1.db')
      const { DatabaseSync } = await import('node:sqlite')
      const v1 = new Database(new DatabaseSync(oldFile))
      runMigrations(v1, migrations.slice(0, 1))
      v1.run("INSERT INTO imports (source_type, source_path, status, started_at) VALUES ('LOCAL_FOLDER', 'C:/p', 'completed', 'x')")
      v1.run(
        `INSERT INTO assets (sha256, media_type, mime_type, size_bytes, sort_time, sort_day, sort_time_source, original_filename, created_at, updated_at)
         VALUES ('ab', 'photo', 'image/jpeg', 1, 0, '1970-01-01', 'file_modified', 'a.jpg', 'x', 'x')`
      )
      v1.run(
        `INSERT INTO import_items (import_id, source_path, relative_path, filename, size_bytes, sha256, classification, outcome, asset_id)
         VALUES (1, 'C:/p/a.jpg', 'a.jpg', 'a.jpg', 1, 'ab', 'new', 'imported', 1)`
      )
      v1.close()
      db = Database.open(oldFile)
      // The import log survives the v9 table rebuild.
      expect(db.get<{ filename: string; outcome: string; asset_id: number }>('SELECT filename, outcome, asset_id FROM import_items')).toEqual({
        filename: 'a.jpg',
        outcome: 'imported',
        asset_id: 1
      })
      expect(schemaVersion(db)).toBe(migrations.length)
      expect(db.get<{ original_filename: string; description: string | null }>('SELECT original_filename, description FROM assets')).toEqual({
        original_filename: 'a.jpg',
        description: null
      })
      expect(db.get<{ sources_json: string | null }>('SELECT sources_json FROM imports')?.sources_json).toBeNull()
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'future', 'x')")
      expect(() => runMigrations(db)).toThrow(SchemaTooNewError)
      db.close()
    } finally {
      sb.cleanup()
    }
  })
})
