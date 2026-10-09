import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { ffmpeg, probeVideo, setFfmpegPath, transcodePlayable, videoFrame } from '@core/media/ffmpeg'
import { ThumbnailQueue, retryFailedThumbnailsOnce } from '@core/thumbnails/thumbnails'
import { openLibrary, runImport, sandbox, type Sandbox } from './helpers'

setFfmpegPath(createRequire(import.meta.url)('ffmpeg-static') as string)

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

/** A real 2 s HEVC phone-style clip (portrait, with audio), made by ffmpeg itself. */
function hevcClip(path: string): string {
  execFileSync(ffmpeg() as string, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx265', '-tag:v', 'hvc1', '-c:a', 'aac', '-shortest', path
  ])
  return path
}

describe('videos via ffmpeg', () => {
  it('probes, grabs a frame and makes a playable H.264 copy of an HEVC video', async () => {
    const clip = hevcClip(join(sb.dir, 'clip.mp4'))
    const info = await probeVideo(clip)
    expect(info).toMatchObject({ codec: 'hevc', width: 360, height: 640 })
    expect(info.durationMs).toBeGreaterThan(1900)

    const frame = await sharp(await videoFrame(clip, 1000, 200)).metadata()
    expect(frame.height).toBe(200) // portrait: limited by height, width kept even (-2)

    const out = join(sb.dir, 'cache', 'clip-playable.mp4')
    let progress = 0
    await transcodePlayable(clip, out, { durationMs: info.durationMs, onProgress: (f) => (progress = f) })
    expect((await probeVideo(out)).codec).toBe('h264')
    expect(progress).toBeGreaterThan(0.5)
  }, 120_000)

  it('makes thumbnails for HEVC videos, and retries thumbnails that failed before', async () => {
    hevcClip(join(sb.source, 'VID_20240101_120000.mp4'))
    await runImport(lib, sb.source)
    lib.db.run("UPDATE assets SET thumb_status = 'failed'") // as if made by an older version
    expect(retryFailedThumbnailsOnce(lib)).toBe(1)
    expect(retryFailedThumbnailsOnce(lib)).toBe(0) // only once per improvement
    await new ThumbnailQueue(lib).drain()
    const r = lib.db.get<{ thumb_status: string; generator: string }>(
      "SELECT a.thumb_status, t.generator FROM assets a JOIN asset_thumbnails t ON t.asset_id = a.id AND t.variant = 'thumb'"
    )
    expect(r).toEqual({ thumb_status: 'ready', generator: 'ffmpeg' })
    expect(existsSync(join(sb.libraryRoot, 'thumbnails'))).toBe(true)
  }, 120_000)
})
