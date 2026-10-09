import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { HashQueue } from '@core/library/hashQueue'
import { colourDistance, hamming, hammingWords, hashWords, visualHashes } from '@core/media/phash'
import { dismissNearDuplicates, hideAllNearDuplicateExtras, nearDuplicates, NEAR_DUPLICATE } from '@core/repo/nearDuplicates'
import { ThumbnailQueue } from '@core/thumbnails/thumbnails'
import { count, managedFiles, openLibrary, runImport, sandbox, type Sandbox } from './helpers'

/** Photo-like test scene: gradient sky, sun, mountains and seeded texture blobs. `shift` moves the "camera". */
function scene(seed: number, shift = 0): Buffer {
  let r = seed * 9973
  const rnd = (): number => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648
  const blobs = Array.from(
    { length: 40 },
    () =>
      `<circle cx="${(rnd() * 1600 + shift) | 0}" cy="${(600 + rnd() * 500) | 0}" r="${(10 + rnd() * 90) | 0}" fill="hsl(${(rnd() * 360) | 0},50%,${(20 + rnd() * 50) | 0}%)" opacity="0.8"/>`
  ).join('')
  const hue = (seed * 47) % 360
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,30%)"/></linearGradient></defs>
    <rect width="1600" height="1200" fill="url(#g)"/><circle cx="${300 + shift + seed * 50}" cy="250" r="90" fill="#ffe"/>
    <path d="M0 800 L ${400 + shift} 500 L 900 800 L 1200 ${560 + seed * 10} L 1600 800 L 1600 1200 L 0 1200Z" fill="hsl(${hue + 180},30%,25%)"/>${blobs}</svg>`)
}

const thumb = (b: Buffer): Promise<Buffer> => sharp(b).resize(512, 512, { fit: 'inside' }).webp({ quality: 78 }).toBuffer()

describe('perceptual fingerprints', () => {
  it('copies of one picture stay within the thresholds; bursts, crops and other scenes do not', async () => {
    const base = await sharp(scene(1)).jpeg({ quality: 92 }).toBuffer()
    const h0 = await visualHashes(await thumb(base))
    const d = async (b: Buffer): Promise<{ p: number; d: number; c: number }> => {
      const h = await visualHashes(await thumb(b))
      return { p: hamming(h0.phash, h.phash), d: hamming(h0.dhash, h.dhash), c: colourDistance(h0.color, h.color) }
    }
    const within = (x: { p: number; d: number; c: number }): boolean =>
      x.p <= NEAR_DUPLICATE.maxPhash && x.d <= NEAR_DUPLICATE.maxDhash && x.c <= NEAR_DUPLICATE.maxColourDiff
    for (const copy of [
      await sharp(base).jpeg({ quality: 40 }).toBuffer(),
      await sharp(base).resize(1600).jpeg({ quality: 60 }).toBuffer(),
      await sharp(base).resize(320).jpeg({ quality: 70 }).toBuffer(),
      await sharp(base).png().toBuffer(),
      await sharp(base).modulate({ brightness: 1.1 }).jpeg().toBuffer()
    ]) {
      expect(within(await d(copy))).toBe(true)
    }
    for (const other of [
      await sharp(scene(1, 40)).jpeg().toBuffer(), // burst: camera moved slightly
      await sharp(base).extract({ left: 80, top: 60, width: 1440, height: 1080 }).jpeg().toBuffer(), // 10 % crop
      await sharp(scene(2)).jpeg().toBuffer(),
      await sharp(scene(7)).jpeg().toBuffer(),
      await sharp(base).modulate({ hue: 150 }).jpeg().toBuffer() // same layout, different colours
    ]) {
      expect(within(await d(other))).toBe(false)
    }
    expect((await visualHashes(await sharp({ create: { width: 640, height: 480, channels: 3, background: '#111' } }).png().toBuffer())).flat).toBe(true)
  })
})

describe('fast hamming', () => {
  it('matches the reference implementation on random hashes', () => {
    let seed = 7
    const hex = (): string => Array.from({ length: 16 }, () => ((seed = (seed * 1103515245 + 12345) % 2147483648) % 16).toString(16)).join('')
    for (let i = 0; i < 500; i++) {
      const a = hex()
      const b = hex()
      expect(hammingWords(hashWords(a), hashWords(b))).toBe(hamming(a, b))
    }
    expect(hammingWords(hashWords('ffffffffffffffff'), hashWords('0000000000000000'))).toBe(64)
  })
})

describe('probable duplicates in a library', () => {
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

  it('groups re-saved copies, suggests the best one, and supports dismiss / hide-extras without touching files', async () => {
    const exif = { IFD0: { Make: 'Xiaomi', Model: 'M2012K11AG' }, IFD2: { DateTimeOriginal: '2023:06:01 10:00:00' } }
    const original = await sharp(scene(1)).jpeg({ quality: 92 }).withExif(exif).toBuffer()
    writeFileSync(join(sb.source, 'IMG_20230601_100000.jpg'), original) // keep its EXIF (re-encoding would drop it)
    await sharp(original).resize(1600).jpeg({ quality: 60 }).toFile(join(sb.source, '46777.jpg')) // WhatsApp-style copy
    await sharp(original).resize(1024).png().toFile(join(sb.source, 'saved.png'))
    await sharp(scene(1, 40)).jpeg().toFile(join(sb.source, 'burst.jpg'))
    await sharp(scene(3)).jpeg().toFile(join(sb.source, 'other.jpg'))
    await sharp({ create: { width: 800, height: 600, channels: 3, background: '#000' } }).jpeg().toFile(join(sb.source, 'black1.jpg'))
    await sharp({ create: { width: 800, height: 600, channels: 3, background: '#010101' } }).jpeg().toFile(join(sb.source, 'black2.jpg'))

    const s = await runImport(lib, sb.source)
    expect(s.newAssets).toBe(7) // none are byte-identical
    await new ThumbnailQueue(lib).drain()
    await new HashQueue(lib).drain()

    const nd = nearDuplicates(lib, 0, 10)
    expect(nd.hashed).toBe(7)
    expect(nd.totalGroups).toBe(1) // black frames are "flat" and never matched; burst/other are different photos
    const g = nd.groups[0]!
    expect(g.members.map((m) => m.originalFilename)).toEqual(['IMG_20230601_100000.jpg', '46777.jpg', 'saved.png'])
    expect(g.bestId).toBe(g.members[0]!.asset.id)
    expect(g.bestReason).toMatch(/camera data/)
    expect(nd.extraCopies).toBe(2)

    // Hide extras everywhere: the original stays visible, copies are hidden, nothing deleted.
    expect(hideAllNearDuplicateExtras(lib)).toBe(2)
    const after = nearDuplicates(lib, 0, 10)
    expect(after.groups[0]!.resolved).toBe(true)
    expect(after.unresolvedGroups).toBe(0)
    expect(count(lib, 'assets')).toBe(7)
    expect(managedFiles(lib)).toHaveLength(7)

    // "Not duplicates" removes the group for good.
    dismissNearDuplicates(lib, g.members.map((m) => m.asset.id))
    expect(nearDuplicates(lib, 0, 10).totalGroups).toBe(0)
  })

  it('does not treat burst shots (camera originals with different capture times) as duplicates', async () => {
    const shot = (time: string): Promise<Buffer> =>
      sharp(scene(4)).jpeg({ quality: 90 }).withExif({ IFD0: { Make: 'Xiaomi', Model: 'M2012K11AG' }, IFD2: { DateTimeOriginal: time } }).toBuffer()
    writeFileSync(join(sb.source, 'IMG_20230601_100000.jpg'), await shot('2023:06:01 10:00:00'))
    writeFileSync(join(sb.source, 'IMG_20230601_100001.jpg'), await sharp(await shot('2023:06:01 10:00:01')).modulate({ brightness: 1.02 }).withExif({ IFD0: { Make: 'Xiaomi', Model: 'M2012K11AG' }, IFD2: { DateTimeOriginal: '2023:06:01 10:00:01' } }).jpeg({ quality: 88 }).toBuffer())
    // An edited copy keeps the same capture time: still a probable duplicate.
    writeFileSync(join(sb.source, 'IMG_20230601_100000-edited.jpg'), await sharp(await shot('2023:06:01 10:00:00')).modulate({ brightness: 1.05 }).withExif({ IFD0: { Make: 'Xiaomi', Model: 'M2012K11AG' }, IFD2: { DateTimeOriginal: '2023:06:01 10:00:00' } }).jpeg({ quality: 85 }).toBuffer())
    await runImport(lib, sb.source)
    await new ThumbnailQueue(lib).drain()
    await new HashQueue(lib).drain()
    const nd = nearDuplicates(lib, 0, 10)
    expect(nd.totalGroups).toBe(1)
    expect(nd.groups[0]!.members.map((m) => m.originalFilename).sort()).toEqual(['IMG_20230601_100000-edited.jpg', 'IMG_20230601_100000.jpg'])
  })
})
