import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** Streams the file through SHA-256. SHA-256 is the sole authority for exact (byte-level) identity. */
export function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024, signal })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
