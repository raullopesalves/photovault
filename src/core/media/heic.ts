import { readFile } from 'node:fs/promises'

let queue: Promise<unknown> = Promise.resolve()

/**
 * Decodes HEIC/HEIF with libheif compiled to WebAssembly (no OS codec needed). A full-size decode needs
 * ~100 MB for a 24 MP photo, so decodes run one at a time. The decoder is loaded on first use.
 */
export function decodeHeic(path: string): Promise<{ width: number; height: number; rgba: Buffer }> {
  const job = queue.then(async () => {
    const { default: decode } = await import('heic-decode')
    const img = await decode({ buffer: await readFile(path) })
    return { width: img.width, height: img.height, rgba: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) }
  })
  queue = job.catch(() => undefined)
  return job
}
