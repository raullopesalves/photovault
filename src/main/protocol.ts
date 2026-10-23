import { protocol } from 'electron'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { MEDIA_PROTOCOL } from '@shared/types'
import { originalPathFor, requeueThumbnail } from '@core/thumbnails/thumbnails'
import { thumbnailPath } from '@core/repo/queries'
import type { LibraryController } from './controller'
import sharp from 'sharp'
import { playablePath } from './videos'

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }
  ])
}

const MIME_BY_KIND: Record<string, string> = { thumb: 'image/webp', preview: 'image/webp' }

/** Streams a file, honouring HTTP Range requests (needed for video seeking). */
async function serveFile(path: string, contentType: string, request: Request): Promise<Response> {
  const st = await stat(path)
  const size = st.size
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable'
  }
  const range = request.headers.get('range')
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start: number
    let end: number
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]))
      end = size - 1
    } else {
      start = Number(m[1])
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` }
    })
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream
  return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
}

/**
 * pv-media://thumb/<assetId>     grid thumbnail
 * pv-media://preview/<assetId>   large preview (generated on demand)
 * pv-media://original/<assetId>  the managed original (read-only)
 * Only asset ids are accepted: the renderer can never ask for an arbitrary filesystem path.
 */
export function handleMediaProtocol(controller: LibraryController): void {
  protocol.handle(MEDIA_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url)
      const kind = url.hostname
      const id = Number(url.pathname.replace(/^\//, ''))
      const library = controller.library
      if (!library || !Number.isSafeInteger(id) || id <= 0) return new Response(null, { status: 404 })

      if (kind === 'thumb') {
        const p = thumbnailPath(library, id, 'thumb')
        if (p && !existsSync(p)) {
          // Recorded but gone from disk: make it again (the grid refreshes when it is ready).
          requeueThumbnail(library, id)
          controller.thumbnails?.kick()
          return new Response(null, { status: 404 })
        }
        return p ? await serveFile(p, MIME_BY_KIND.thumb as string, request) : new Response(null, { status: 404 })
      }
      if (kind === 'preview') {
        const p = (await controller.thumbnails?.ensurePreview(id)) ?? thumbnailPath(library, id, 'thumb')
        return p ? await serveFile(p, MIME_BY_KIND.preview as string, request) : new Response(null, { status: 404 })
      }
      if (kind === 'playable') {
        const src = originalPathFor(library, id)
        const p = src && playablePath(library, src.sha256)
        return p && existsSync(p) ? await serveFile(p, 'video/mp4', request) : new Response(null, { status: 404 })
      }
      if (kind === 'face') {
        // Cached crop, or cut from the original (then cached); the grid thumbnail as a last resort.
        const cached = await controller.people?.cropFor(id).catch(() => null)
        if (cached && existsSync(cached)) return await serveFile(cached, 'image/webp', request)
        const f = library.db.get<{ asset_id: number; x: number; y: number; w: number; h: number }>('SELECT asset_id, x, y, w, h FROM faces WHERE id = ?', [id])
        const thumb = f && thumbnailPath(library, f.asset_id, 'thumb')
        if (!f || !thumb) return new Response(null, { status: 404 })
        const meta = await sharp(thumb).metadata()
        const W = meta.width ?? 1
        const H = meta.height ?? 1
        const side = Math.max(1, Math.min(W, H, Math.round(Math.max(f.w * W, f.h * H) * 1.6)))
        const left = Math.min(W - side, Math.max(0, Math.round((f.x + f.w / 2) * W - side / 2)))
        const top = Math.min(H - side, Math.max(0, Math.round((f.y + f.h / 2) * H - side / 2)))
        const buf = await sharp(thumb).extract({ left, top, width: side, height: side }).resize(160, 160).webp().toBuffer()
        return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'image/webp' } })
      }
      if (kind === 'original') {
        const src = originalPathFor(library, id)
        return src ? await serveFile(src.absolutePath, src.mime, request) : new Response(null, { status: 404 })
      }
      return new Response(null, { status: 400 })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
