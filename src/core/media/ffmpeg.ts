import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Video helpers built on a bundled ffmpeg (ffmpeg-static; a separate GPL program run as a process). Used for
 * what Chromium and Windows cannot do on their own, typically HEVC/H.265 phone videos without the codec
 * installed: a thumbnail frame, and a playable H.264 copy (a regenerable cache — the original is never
 * touched).
 */
let ffmpegPath: string | null = null

/** The packaged app passes the unpacked binary's path; tests and dev resolve ffmpeg-static themselves. */
export function setFfmpegPath(path: string | null): void {
  ffmpegPath = path
}

export function ffmpeg(): string | null {
  if (ffmpegPath && existsSync(ffmpegPath)) return ffmpegPath
  return null
}

function run(args: string[], opts: { onStderr?: (s: string) => void; onStdout?: (b: Buffer) => void; signal?: AbortSignal } = {}): Promise<{ code: number; stderr: string }> {
  const bin = ffmpeg()
  if (!bin) return Promise.reject(new Error('ffmpeg is not available'))
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, signal: opts.signal })
    let stderr = ''
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      stderr = (stderr + s).slice(-20_000)
      opts.onStderr?.(s)
    })
    p.stdout.on('data', (d: Buffer) => opts.onStdout?.(d))
    p.on('error', reject)
    p.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

export interface FfprobeInfo {
  codec: string | null
  width: number | null
  height: number | null
  durationMs: number | null
}

/** Reads codec, size and duration from ffmpeg's stream description. */
export async function probeVideo(path: string): Promise<FfprobeInfo> {
  const { stderr } = await run(['-i', path])
  const v = /Stream #\S+.*?Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr)
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  return {
    codec: v?.[1] ?? null,
    width: v ? Number(v[2]) : null,
    height: v ? Number(v[3]) : null,
    durationMs: d ? Math.round((Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 1000) : null
  }
}

/** One frame as PNG (ffmpeg applies the video's rotation), at most `maxSize` px wide/high. */
export async function videoFrame(path: string, atMs: number, maxSize: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  const scale = `scale='if(gt(iw,ih),min(${maxSize},iw),-2)':'if(gt(iw,ih),-2,min(${maxSize},ih))'`
  const { code, stderr } = await run(
    ['-ss', (Math.max(0, atMs) / 1000).toFixed(2), '-i', path, '-frames:v', '1', '-vf', scale, '-f', 'image2pipe', '-vcodec', 'png', '-'],
    { onStdout: (b) => chunks.push(b) }
  )
  const out = Buffer.concat(chunks)
  if (code !== 0 || out.length === 0) throw new Error(`ffmpeg could not read a frame (${stderr.split('\n').slice(-3).join(' ').trim()})`)
  return out
}

/** Codecs Chromium plays everywhere without OS codec packs. */
export function playableCodec(codec: string | null): boolean {
  return codec === 'h264' || codec === 'vp8' || codec === 'vp9' || codec === 'av1'
}

/**
 * Makes an H.264/AAC MP4 copy that any browser engine can play (at most 1920 px, fast start). Written to a
 * temporary file and renamed into place, so a half-finished file is never served.
 */
export async function transcodePlayable(src: string, dest: string, opts: { durationMs?: number | null; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const tmp = `${dest}.${process.pid}.part.mp4`
  const total = opts.durationMs ?? null
  const { code, stderr } = await run(
    [
      '-y',
      '-i', src,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',format=yuv420p",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      tmp
    ],
    {
      signal: opts.signal,
      onStderr: (s) => {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s)
        if (m && total) opts.onProgress?.(Math.min(1, ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) / total))
      }
    }
  ).catch(async (err: unknown) => {
    await unlink(tmp).catch(() => undefined)
    throw err
  })
  if (code !== 0) {
    await unlink(tmp).catch(() => undefined)
    throw new Error(`Could not convert the video (${stderr.split('\n').slice(-3).join(' ').trim()})`)
  }
  await rename(tmp, dest)
}
