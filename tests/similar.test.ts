import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { HashQueue } from '@core/library/hashQueue'
import { visualHashes } from '@core/media/phash'
import { dismissNearDuplicates } from '@core/repo/nearDuplicates'
import { similarPhotos } from '@core/repo/similar'
import { ThumbnailQueue } from '@core/thumbnails/thumbnails'
import { openLibrary, photoScene, runImport, sandbox, type Sandbox } from './helpers'

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

const shot = (seed: number, shift: number, time: string, blur = 0): Promise<Buffer> => {
  let img = sharp(photoScene(seed, shift))
  if (blur) img = img.blur(blur)
  return img.jpeg({ quality: 90 }).withExif({ IFD0: { Make: 'Test', Model: 'Cam' }, IFD2: { DateTimeOriginal: time } }).toBuffer()
}

describe('sharpness', () => {
  it('a blurred version of a picture scores lower', async () => {
    const sharpShot = await visualHashes(await sharp(photoScene(3)).resize(512).webp().toBuffer())
    const blurry = await visualHashes(await sharp(photoScene(3)).blur(4).resize(512).webp().toBuffer())
    expect(sharpShot.sharpness).toBeGreaterThan(blurry.sharpness * 1.5)
  })
})

describe('similar photos', () => {
  it('groups a burst taken seconds apart and suggests the sharpest shot', async () => {
    const write = async (name: string, b: Promise<Buffer>): Promise<void> => {
      writeFileSync(join(sb.source, name), await b)
    }
    await write('burst1.jpg', shot(1, 0, '2023:06:01 10:00:00', 3))
    await write('burst2.jpg', shot(1, 15, '2023:06:01 10:00:02'))
    await write('burst3.jpg', shot(1, 30, '2023:06:01 10:00:04', 3))
    await write('later.jpg', shot(1, 0, '2023:06:01 12:00:00')) // same scene, hours later: not the same moment
    await write('other.jpg', shot(5, 0, '2023:06:01 10:00:06')) // seconds later, different picture
    await runImport(lib, sb.source)
    await new ThumbnailQueue(lib).drain()
    await new HashQueue(lib).drain()

    const s = similarPhotos(lib, 0, 10)
    expect(s.totalGroups).toBe(1)
    const g = s.groups[0]!
    expect(g.members.map((m) => m.originalFilename).sort()).toEqual(['burst1.jpg', 'burst2.jpg', 'burst3.jpg'])
    expect(g.members.find((m) => m.asset.id === g.bestId)!.originalFilename).toBe('burst2.jpg')
    expect(g.bestReason).toBe('sharpest shot')
    expect(s.extraCopies).toBe(2)

    dismissNearDuplicates(
      lib,
      g.members.map((m) => m.asset.id)
    )
    expect(similarPhotos(lib, 0, 10).totalGroups).toBe(0)
  })
})
