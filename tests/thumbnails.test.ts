import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { ThumbnailQueue } from '@core/thumbnails/thumbnails'
import { assetsPage, thumbnailPath, timeline } from '@core/repo/queries'
import { makeJpeg, openLibrary, runImport, sandbox } from './helpers'

describe('thumbnails and timeline', () => {
  it('generates cached thumbnails in the background and serves a chronological timeline', async () => {
    const sb = sandbox()
    const lib = openLibrary(sb.libraryRoot)
    try {
      await makeJpeg(join(sb.source, 'old.jpg'), { width: 1600, height: 1200, dateTimeOriginal: '2018:01:01 10:00:00', color: '#111111' })
      await makeJpeg(join(sb.source, 'new.jpg'), { width: 800, height: 600, dateTimeOriginal: '2023:05:06 10:00:00', color: '#222222' })
      await makeJpeg(join(sb.source, 'new2.jpg'), { width: 800, height: 600, dateTimeOriginal: '2023:05:06 18:00:00', color: '#333333' })
      await runImport(lib, sb.source)

      const updated: number[] = []
      const queue = new ThumbnailQueue(lib, { onUpdated: (ids) => updated.push(...ids) })
      await queue.drain()
      expect(updated).toHaveLength(3)
      expect(lib.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM assets WHERE thumb_status = 'ready'")?.n).toBe(3)

      const page = assetsPage(lib, 0, 10)
      expect(page.map((a) => a.sortTime)).toEqual([...page.map((a) => a.sortTime)].sort((a, b) => b - a))
      expect(timeline(lib)).toEqual([
        { month: '2023-05', count: 2 },
        { month: '2018-01', count: 1 }
      ])

      const oldId = page[2]!.id
      const thumb = thumbnailPath(lib, oldId, 'thumb')!
      expect(existsSync(thumb)).toBe(true)
      const meta = await sharp(thumb).metadata()
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(512)

      const preview = await queue.ensurePreview(oldId)
      expect(preview && existsSync(preview)).toBe(true)
    } finally {
      lib.close()
      sb.cleanup()
    }
  })
})
