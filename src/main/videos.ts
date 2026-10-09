import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ffmpeg, probeVideo, transcodePlayable, videoFrame } from '@core/media/ffmpeg'
import type { Library } from '@core/library/library'
import { originalPathFor } from '@core/thumbnails/thumbnails'
import { errorMessage } from '@core/util'

/** Cache of playable copies: thumbnails/videos/<sha256>.mp4 (regenerable, like thumbnails). */
export function playablePath(library: Library, sha256: string): string {
  return join(library.root, 'thumbnails', 'videos', `${sha256}.mp4`)
}

const inflight = new Map<string, Promise<string>>()

/**
 * A copy of the video that Chromium can play (H.264). Made on demand the first time a video will not play
 * (HEVC without the Windows codec, old formats) and cached; later views are instant. Never touches the original.
 */
export function playableVideo(library: Library, assetId: number, onProgress?: (fraction: number) => void): Promise<string> {
  const src = originalPathFor(library, assetId)
  if (!src) return Promise.reject(new Error('This video has no original file in the library.'))
  if (!ffmpeg()) return Promise.reject(new Error('Video conversion is not available in this build.'))
  const dest = playablePath(library, src.sha256)
  if (existsSync(dest)) return Promise.resolve(dest)
  const running = inflight.get(dest)
  if (running) return running
  const job = (async () => {
    const t = Date.now()
    const info = await probeVideo(src.absolutePath)
    await transcodePlayable(src.absolutePath, dest, { durationMs: info.durationMs, onProgress })
    library.logger.info('video.playable_copy', { assetId, codec: info.codec, ms: Date.now() - t })
    return dest
  })()
    .catch((err) => {
      library.logger.warn('video.playable_failed', { assetId, error: errorMessage(err) })
      throw err
    })
    .finally(() => inflight.delete(dest))
  inflight.set(dest, job)
  return job
}

/**
 * Writes a few frames of a video to temporary PNG files (for smart search and People, which look at
 * pictures). Returns the paths and a cleanup function. Empty when ffmpeg is missing or the video unreadable.
 */
export async function videoFramesToTemp(path: string, durationMs: number | null, fractions: number[], size: number): Promise<{ paths: string[]; cleanup: () => Promise<void> }> {
  const dir = join(tmpdir(), 'Photo Vault', 'frames', `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const cleanup = (): Promise<void> => rm(dir, { recursive: true, force: true }).catch(() => undefined)
  if (!ffmpeg()) return { paths: [], cleanup }
  await mkdir(dir, { recursive: true })
  const paths: string[] = []
  const total = durationMs && durationMs > 0 ? durationMs : 3000
  for (const [i, f] of fractions.entries()) {
    try {
      const png = await videoFrame(path, Math.max(0, Math.min(total - 100, total * f)), size)
      const p = join(dir, `${i}.png`)
      await writeFile(p, png)
      paths.push(p)
    } catch {
      /* unreadable frame: skip */
    }
  }
  return { paths, cleanup }
}
