import sharp from './sharp'

/** Bump when the hashing changes; stored hashes with an older version are recomputed. */
export const PHASH_VERSION = 4

export interface VisualHashes {
  /** 64-bit difference hash (gradient of a 9×8 greyscale image), 16 hex chars. */
  dhash: string
  /** 64-bit DCT perceptual hash (low frequencies of a 32×32 greyscale image), 16 hex chars. */
  phash: string
  /** Average RGB of the four image quadrants (12 bytes as 24 hex chars). */
  color: string
  /** Focus measure (variance of the Laplacian at 256 px). Only comparable between near-identical shots. */
  sharpness: number
  /** Nearly uniform image (blank, black, solid colour): fingerprints are meaningless, never matched. */
  flat: boolean
}

function bitsToHex(bits: boolean[]): string {
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] ? 8 : 0) | (bits[i + 1] ? 4 : 0) | (bits[i + 2] ? 2 : 0) | (bits[i + 3] ? 1 : 0)
    hex += nibble.toString(16)
  }
  return hex
}

/** Low-frequency 8×8 block of the 2-D DCT-II of a 32×32 block, computed separably (rows, then columns). */
function dct8x8(pixels: Float64Array): number[] {
  const N = 32
  const K = 8
  const cos: number[] = []
  for (let k = 0; k < K; k++) for (let n = 0; n < N; n++) cos.push(Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N)))
  const rows = new Float64Array(N * K) // rows[y][u]
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < K; u++) {
      let s = 0
      for (let x = 0; x < N; x++) s += (pixels[y * N + x] as number) * (cos[u * N + x] as number)
      rows[y * K + u] = s
    }
  }
  const out: number[] = []
  for (let v = 0; v < K; v++) {
    for (let u = 0; u < K; u++) {
      let s = 0
      for (let y = 0; y < N; y++) s += (rows[y * K + u] as number) * (cos[v * N + y] as number)
      out.push(s)
    }
  }
  return out
}

/** Fingerprints an image (file path or encoded buffer). Input is normally the cached 512 px thumbnail. */
export async function visualHashes(input: string | Buffer): Promise<VisualHashes> {
  // Decode the image once (≤ 256 px RGB); the 32×32 block for the hashes and the sharpness both derive from it.
  const big = await sharp(input, { failOn: 'none' })
    .removeAlpha()
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = big.info.width
  const H = big.info.height
  const rgb = await sharp(big.data, { raw: { width: W, height: H, channels: 3 } }).resize(32, 32, { fit: 'fill' }).raw().toBuffer()
  const p = Buffer.alloc(1024)
  const quad = new Array<number>(12).fill(0)
  for (let i = 0; i < 1024; i++) {
    const r = rgb[i * 3] as number
    const g = rgb[i * 3 + 1] as number
    const b = rgb[i * 3 + 2] as number
    p[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    const q = (Math.floor(i / 32) >= 16 ? 2 : 0) + (i % 32 >= 16 ? 1 : 0)
    quad[q * 3] = (quad[q * 3] as number) + r
    quad[q * 3 + 1] = (quad[q * 3 + 1] as number) + g
    quad[q * 3 + 2] = (quad[q * 3 + 2] as number) + b
  }
  const color = quad.map((v) => Math.round(v / 256).toString(16).padStart(2, '0')).join('')

  // dHash: 9×8, each bit = is the pixel brighter than its right neighbour.
  const d = await sharp(p, { raw: { width: 32, height: 32, channels: 1 } }).resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  const dbits: boolean[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) dbits.push((d[y * 9 + x] as number) > (d[y * 9 + x + 1] as number))

  // pHash: DCT of the 32×32 block → 8×8 lowest frequencies → bit = above the median (DC excluded from the median).
  const px = new Float64Array(1024)
  let sum = 0
  for (let i = 0; i < 1024; i++) {
    px[i] = p[i] as number
    sum += px[i] as number
  }
  const mean = sum / 1024
  let variance = 0
  for (let i = 0; i < 1024; i++) variance += ((px[i] as number) - mean) ** 2
  const flat = Math.sqrt(variance / 1024) < 6

  const coeffs = dct8x8(px)
  const ac = coeffs.slice(1).sort((a, b) => a - b)
  const median = ((ac[31] as number) + (ac[32] as number)) / 2
  const pbits = coeffs.map((c) => c > median)
  // Sharpness: variance of the Laplacian (4-neighbour) of the greyscale image.
  const grey = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) grey[i] = 0.299 * (big.data[i * 3] as number) + 0.587 * (big.data[i * 3 + 1] as number) + 0.114 * (big.data[i * 3 + 2] as number)
  let lsum = 0
  let lsq = 0
  let ln = 0
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const v = (grey[i - 1] as number) + (grey[i + 1] as number) + (grey[i - W] as number) + (grey[i + W] as number) - 4 * (grey[i] as number)
      lsum += v
      lsq += v * v
      ln++
    }
  }
  const lmean = lsum / Math.max(1, ln)
  const sharpness = Math.round((lsq / Math.max(1, ln) - lmean * lmean) * 100) / 100

  return { dhash: bitsToHex(dbits), phash: bitsToHex(pbits), color, flat, sharpness }
}

const POP = new Uint8Array(256)
for (let i = 0; i < 256; i++) POP[i] = (i & 1) + (POP[i >> 1] as number)

/** Splits a 16-hex-char hash into two unsigned 32-bit halves for fast comparisons. */
export function hashWords(hex: string): [number, number] {
  return [parseInt(hex.slice(0, 8), 16) >>> 0, parseInt(hex.slice(8, 16), 16) >>> 0]
}

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  // Math.imul keeps the multiply in 32-bit integer space (a plain * can exceed 2^53 and lose precision).
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

export function hammingWords(a: [number, number], b: [number, number]): number {
  return popcount32((a[0] ^ b[0]) >>> 0) + popcount32((a[1] ^ b[1]) >>> 0)
}

/** Largest per-channel difference between two colour signatures (0–255); 0 when either is missing (no colour check). */
export function colourDistance(a: string | null, b: string | null): number {
  if (!a || !b || a.length !== 24 || b.length !== 24) return 0
  let max = 0
  for (let i = 0; i < 24; i += 2) max = Math.max(max, Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)))
  return max
}

/** Number of differing bits between two 16-hex-char hashes. */
export function hamming(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < 16; i += 2) d += POP[parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)] as number
  return d
}
