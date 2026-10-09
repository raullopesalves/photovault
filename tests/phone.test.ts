import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { copyFromPhone, listPhones } from '../src/core/sources/phone'

const root = mkdtempSync(join(tmpdir(), 'pvph-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe.runIf(process.platform === 'win32')('phone import (Windows Shell copy)', () => {
  it('lists devices without failing', async () => {
    expect(Array.isArray(await listPhones())).toBe(true)
  }, 60_000)

  it('copies the photo folders, never overwrites, and skips what was already copied', async () => {
    const src = join(root, 'phone')
    const dest = join(root, 'copies')
    mkdirSync(join(src, '100APPLE'), { recursive: true })
    writeFileSync(join(src, '100APPLE', 'IMG_0001.JPG'), 'aaa')
    writeFileSync(join(src, 'IMG_0002.HEIC'), 'bbbb')
    // A different file already waiting under the same name must survive.
    mkdirSync(join(dest, 'DCIM'), { recursive: true })
    writeFileSync(join(dest, 'DCIM', 'IMG_0002.HEIC'), 'zz')

    const seen: number[] = []
    const first = await copyFromPhone('test', dest, { sourcePath: src, onProgress: (p) => seen.push(p.done) })
    expect(first).toMatchObject({ total: 2, done: 2, copied: 2, skipped: 0, failed: 0, finished: true })
    expect(seen.at(-1)).toBe(2)
    expect(readFileSync(join(dest, 'DCIM', '100APPLE', 'IMG_0001.JPG'), 'utf8')).toBe('aaa')
    expect(readFileSync(join(dest, 'DCIM', 'IMG_0002.HEIC'), 'utf8')).toBe('zz')
    expect(readFileSync(join(dest, 'DCIM', 'IMG_0002 (2).HEIC'), 'utf8')).toBe('bbbb')
    expect(readdirSync(dest)).toEqual(['DCIM'])

    const again = await copyFromPhone('test', dest, { sourcePath: src })
    expect(again).toMatchObject({ total: 2, copied: 0, skipped: 2, failed: 0 })
  }, 120_000)
})
