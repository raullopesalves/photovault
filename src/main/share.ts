import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { ShareOptions } from '@shared/types'
import { applyEdits, decodeOriented } from '@core/media/edits'
import { isSharpDecodable } from '@core/media/formats'
import { isRawMime } from '@core/media/raw'
import type { Library } from '@core/library/library'
import { originalPathFor } from '@core/thumbnails/thumbnails'
import { errorMessage } from '@core/util'

const SIZES: Record<ShareOptions['size'], number> = { original: 12_000, large: 2048, small: 1280 }

const safe = (name: string): string => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')

/**
 * Prepares copies to share (chat, email, another phone) in a fresh folder: photos as JPEG at the chosen size
 * with edits applied, location and camera details removed, and the date taken kept unless unticked. Videos
 * are copied as they are. The library is not touched.
 */
export async function prepareShare(library: Library, assetIds: number[], opts: ShareOptions): Promise<{ folder: string; files: number; failed: number }> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
  const folder = join(tmpdir(), 'Photo Vault', `Share ${stamp}`)
  await mkdir(folder, { recursive: true })
  const used = new Set<string>()
  const unique = (name: string): string => {
    const ext = extname(name)
    const stem = name.slice(0, name.length - ext.length)
    for (let i = 1; ; i++) {
      const n = i === 1 ? name : `${stem} (${i})${ext}`
      if (!used.has(n.toLowerCase())) {
        used.add(n.toLowerCase())
        return n
      }
    }
  }
  let files = 0
  let failed = 0
  for (const id of assetIds.slice(0, 2000)) {
    const src = originalPathFor(library, id)
    const a = library.db.get<{ original_filename: string; media_type: string; capture_time: string | null }>(
      'SELECT original_filename, media_type, capture_time FROM assets WHERE id = ?',
      [id]
    )
    if (!src || !a) continue
    try {
      if (a.media_type === 'video' || (!isSharpDecodable(src.mime) && !isRawMime(src.mime) && src.mime !== 'image/heic' && src.mime !== 'image/heif')) {
        await copyFile(src.absolutePath, join(folder, unique(safe(a.original_filename))))
      } else {
        const raw = await decodeOriented(src.absolutePath, src.mime, SIZES[opts.size])
        let img = await applyEdits(raw, src.rotation, src.edits)
        if (opts.includeDate && a.capture_time) {
          const t = a.capture_time.slice(0, 19).replace('T', ' ').replace(/-/g, ':')
          img = img.withExif({ IFD0: { DateTime: t }, IFD2: { DateTimeOriginal: t, DateTimeDigitized: t } })
        }
        const jpeg = await img.jpeg({ quality: opts.size === 'original' ? 92 : 86, mozjpeg: true }).toBuffer()
        await writeFile(join(folder, unique(safe(a.original_filename.replace(/\.[^.]+$/, '') + '.jpg'))), jpeg)
      }
      files++
    } catch (err) {
      failed++
      library.logger.warn('share.failed', { assetId: id, error: errorMessage(err) })
    }
  }
  library.logger.info('share.prepared', { folder, files, failed, ...opts })
  return { folder, files, failed }
}
