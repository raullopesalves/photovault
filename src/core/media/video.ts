import { open } from 'node:fs/promises'

export interface VideoInfo {
  /** Container creation time (QuickTime epoch converted to UTC ms), if plausible. */
  createdUtcMs: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  /** Whether any track is a sound track (handler 'soun'). WhatsApp/Telegram "GIFs" are silent MP4s. */
  hasAudio: boolean | null
  /** Text tags from udta (QuickTime ©-atoms or iTunes-style ilst): encoder, comment, title, software. */
  tags: Record<string, string>
}

const QT_EPOCH_OFFSET_S = 2082844800 // seconds between 1904-01-01 and 1970-01-01
const MOOV_LIMIT = 64 * 1024 * 1024

interface Reader {
  size: number
  read(pos: number, len: number): Promise<Buffer>
}

interface Box {
  type: string
  start: number
  headerSize: number
  size: number
}

function bufferReader(buf: Buffer): Reader {
  return { size: buf.length, read: async (pos, len) => buf.subarray(pos, Math.min(buf.length, pos + len)) }
}

async function readBoxes(r: Reader, start: number, end: number): Promise<Box[]> {
  const boxes: Box[] = []
  let pos = start
  while (pos + 8 <= end && boxes.length < 512) {
    const header = await r.read(pos, 16)
    if (header.length < 8) break
    let size = header.readUInt32BE(0)
    const type = header.toString('latin1', 4, 8)
    let headerSize = 8
    if (size === 1) {
      if (header.length < 16) break
      size = Number(header.readBigUInt64BE(8))
      headerSize = 16
    } else if (size === 0) {
      size = end - pos
    }
    if (size < headerSize) break
    boxes.push({ type, start: pos, headerSize, size })
    pos += size
  }
  return boxes
}

async function body(r: Reader, box: Box, max: number): Promise<Buffer> {
  return r.read(box.start + box.headerSize, Math.min(max, box.size - box.headerSize))
}

/** Minimal ISO-BMFF / QuickTime reader: mvhd (creation time, duration) and tkhd (dimensions). */
async function parseVideo(r: Reader): Promise<VideoInfo | null> {
  const top = await readBoxes(r, 0, r.size)
  const moov = top.find((b) => b.type === 'moov')
  if (!moov) return null
  const children = await readBoxes(r, moov.start + moov.headerSize, Math.min(r.size, moov.start + moov.size))
  const info: VideoInfo = { createdUtcMs: null, durationMs: null, width: null, height: null, hasAudio: null, tags: {} }

  const mvhd = children.find((b) => b.type === 'mvhd')
  if (mvhd) {
    const b = await body(r, mvhd, 256)
    if (b.length >= 32) {
      const v1 = b[0] === 1
      const created = v1 ? Number(b.readBigUInt64BE(4)) : b.readUInt32BE(4)
      const timescale = v1 ? b.readUInt32BE(20) : b.readUInt32BE(12)
      const duration = v1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16)
      if (created > QT_EPOCH_OFFSET_S) {
        const ms = (created - QT_EPOCH_OFFSET_S) * 1000
        // Cameras that never set the clock write 1904/1970-ish values; ignore implausible dates.
        if (ms > Date.UTC(1990, 0, 1) && ms < Date.now() + 86_400_000) info.createdUtcMs = ms
      }
      if (timescale > 0) info.durationMs = Math.round((duration / timescale) * 1000)
    }
  }

  let sawHandler = false
  for (const trak of children.filter((b) => b.type === 'trak')) {
    const parts = await readBoxes(r, trak.start + trak.headerSize, trak.start + trak.size)
    const mdia = parts.find((b) => b.type === 'mdia')
    if (mdia) {
      const hdlr = (await readBoxes(r, mdia.start + mdia.headerSize, mdia.start + mdia.size)).find((b) => b.type === 'hdlr')
      if (hdlr) {
        const hb = await body(r, hdlr, 16)
        if (hb.length >= 12) {
          sawHandler = true
          if (hb.toString('latin1', 8, 12) === 'soun') info.hasAudio = true
        }
      }
    }
    const tkhd = parts.find((b) => b.type === 'tkhd')
    if (!tkhd || info.width !== null) continue
    const b = await body(r, tkhd, 96)
    const off = b[0] === 1 ? 88 : 76
    if (b.length < off + 8) continue
    const w = Math.round(b.readUInt32BE(off) / 65536)
    const h = Math.round(b.readUInt32BE(off + 4) / 65536)
    if (w > 0 && h > 0) {
      info.width = w
      info.height = h
    }
  }
  if (sawHandler && info.hasAudio === null) info.hasAudio = false

  const udta = children.find((b) => b.type === 'udta')
  if (udta) info.tags = await readUdtaTags(r, udta)
  return info
}

const TAG_NAMES: Record<string, string> = {
  '\u00a9too': 'encoder',
  '\u00a9enc': 'encoder',
  '\u00a9swr': 'software',
  '\u00a9cmt': 'comment',
  '\u00a9nam': 'title',
  '\u00a9des': 'description',
  desc: 'description',
  '\u00a9mak': 'make',
  '\u00a9mod': 'model'
}

function printable(buf: Buffer): string {
  // eslint-disable-next-line no-control-regex
  return buf.toString('utf8').replace(/\u0000/g, '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 300)
}

/** Text metadata in moov/udta: QuickTime "©xyz" atoms and iTunes-style meta/ilst items. */
async function readUdtaTags(r: Reader, udta: Box): Promise<Record<string, string>> {
  const tags: Record<string, string> = {}
  const kids = await readBoxes(r, udta.start + udta.headerSize, udta.start + udta.size)
  for (const k of kids) {
    const name = TAG_NAMES[k.type]
    if (name && k.size < 4096) {
      // QuickTime style: 2-byte length, 2-byte language, then text.
      const b = await body(r, k, 4096)
      if (b.length >= 4) {
        const len = b.readUInt16BE(0)
        const text = printable(b.subarray(4, 4 + len))
        if (text) tags[name] = text
      }
    }
    if (k.type === 'meta' && k.size < 1_000_000) {
      // iTunes style: meta is a full box (4 bytes version/flags) containing ilst > item > data.
      const metaKids = await readBoxes(r, k.start + k.headerSize + 4, k.start + k.size)
      const ilst = metaKids.find((b) => b.type === 'ilst')
      if (!ilst) continue
      for (const item of await readBoxes(r, ilst.start + ilst.headerSize, ilst.start + ilst.size)) {
        const itemName = TAG_NAMES[item.type]
        if (!itemName) continue
        const data = (await readBoxes(r, item.start + item.headerSize, item.start + item.size)).find((b) => b.type === 'data')
        if (!data || data.size > 4096) continue
        const b = await body(r, data, 4096)
        const text = printable(b.subarray(8))
        if (text) tags[itemName] = text
      }
    }
  }
  return tags
}

export async function readVideoInfo(path: string): Promise<VideoInfo | null> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const reader: Reader = {
      size,
      read: async (pos, len) => {
        const buf = Buffer.alloc(Math.max(0, Math.min(len, size - pos)))
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos)
        return buf.subarray(0, bytesRead)
      }
    }
    return await parseVideo(reader)
  } catch {
    return null
  } finally {
    await fh.close()
  }
}

/** Parses a buffer holding either a whole file or just a captured top-level `moov` box. */
export async function readVideoInfoFromBuffer(buf: Buffer): Promise<VideoInfo | null> {
  try {
    return await parseVideo(bufferReader(buf))
  } catch {
    return null
  }
}

/**
 * Watches a byte stream (e.g. a ZIP entry being hashed) and captures the top-level `moov` box,
 * wherever it is in the file, without buffering the whole video.
 */
export class MoovCollector {
  moov: Buffer | null = null
  private pos = 0
  private boxStart = 0
  private header: Buffer[] = []
  private headerLen = 0
  private headerNeed = 8
  private capture: { end: number; chunks: Buffer[] } | null = null
  private done = false

  push(chunk: Buffer): void {
    let offset = 0
    while (offset < chunk.length && !this.done) {
      const abs = this.pos + offset
      if (this.capture) {
        const take = Math.min(chunk.length - offset, this.capture.end - abs)
        this.capture.chunks.push(Buffer.from(chunk.subarray(offset, offset + take)))
        offset += take
        if (abs + take >= this.capture.end) {
          this.moov = Buffer.concat(this.capture.chunks)
          this.capture = null
          this.done = true
        }
        continue
      }
      if (abs < this.boxStart) {
        offset += Math.min(chunk.length - offset, this.boxStart - abs)
        continue
      }
      const take = Math.min(this.headerNeed - this.headerLen, chunk.length - offset)
      this.header.push(Buffer.from(chunk.subarray(offset, offset + take)))
      this.headerLen += take
      offset += take
      if (this.headerLen < this.headerNeed) continue
      const h = Buffer.concat(this.header)
      let size = h.readUInt32BE(0)
      const type = h.toString('latin1', 4, 8)
      if (size === 1 && this.headerNeed === 8) {
        this.headerNeed = 16
        continue
      }
      if (size === 1) size = Number(h.readBigUInt64BE(8))
      if (size !== 0 && size < this.headerNeed) {
        this.done = true
        continue
      }
      if (type === 'moov' && size !== 0 && size <= MOOV_LIMIT) {
        this.capture = { end: this.boxStart + size, chunks: [h] }
      } else if (size === 0 || type === 'moov') {
        this.done = true // runs to end of file or too large to keep
      } else {
        this.boxStart += size
      }
      this.header = []
      this.headerLen = 0
      this.headerNeed = 8
    }
    this.pos += chunk.length
  }
}
