import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ingestFile, SourceChangedError } from '@core/library/ingest'
import { candidateNames, safeFilename } from '@core/library/layout'
import { sha256File } from '@core/media/hash'
import { copy, makeJpeg, sandbox, type Sandbox } from './helpers'

let sb: Sandbox
beforeEach(() => {
  sb = sandbox()
})
afterEach(() => sb.cleanup())

async function ingest(src: string, opts: { tracked?: string[]; sha?: string } = {}) {
  return ingestFile({
    source: { kind: 'file', path: src },
    expectedSha256: opts.sha ?? (await sha256File(src)),
    libraryRoot: sb.libraryRoot,
    tempDir: join(sb.libraryRoot, 'temp'),
    relDir: 'originals/2024/07',
    filename: 'IMG_4821.jpg',
    isPathTracked: (p) => (opts.tracked ?? []).includes(p)
  })
}

describe('filename collisions in managed storage', () => {
  it('never overwrites an existing different file; uses a hash-derived suffix', async () => {
    const existing = await makeJpeg(join(sb.libraryRoot, 'originals', '2024', '07', 'IMG_4821.jpg'), { color: '#ff0000' })
    const existingBytes = readFileSync(existing)
    const incoming = await makeJpeg(join(sb.source, 'IMG_4821.jpg'), { color: '#00ff00' })
    const sha = await sha256File(incoming)

    const r = await ingest(incoming)
    expect(r.adopted).toBe(false)
    expect(r.relativePath).toBe(`originals/2024/07/IMG_4821_${sha.slice(0, 8)}.jpg`)
    expect(readFileSync(existing).equals(existingBytes)).toBe(true)
    expect(await sha256File(join(sb.libraryRoot, r.relativePath))).toBe(sha)
  })

  it('also skips names the database already tracks even if the file is missing on disk', async () => {
    const incoming = await makeJpeg(join(sb.source, 'IMG_4821.jpg'))
    const sha = await sha256File(incoming)
    const r = await ingest(incoming, { tracked: ['originals/2024/07/IMG_4821.jpg'] })
    expect(r.relativePath).toBe(`originals/2024/07/IMG_4821_${sha.slice(0, 8)}.jpg`)
  })

  it('reuses an untracked byte-identical file left behind (e.g. after a crash) instead of duplicating it', async () => {
    const incoming = await makeJpeg(join(sb.source, 'IMG_4821.jpg'))
    await copy(incoming, join(sb.libraryRoot, 'originals', '2024', '07', 'IMG_4821.jpg'))
    const r = await ingest(incoming)
    expect(r.adopted).toBe(true)
    expect(r.relativePath).toBe('originals/2024/07/IMG_4821.jpg')
    expect(readdirSync(join(sb.libraryRoot, 'originals', '2024', '07'))).toEqual(['IMG_4821.jpg'])
  })

  it('refuses to publish a copy whose bytes do not match the analysed hash, and cleans up its temp file', async () => {
    const incoming = await makeJpeg(join(sb.source, 'IMG_4821.jpg'))
    await expect(ingest(incoming, { sha: '0'.repeat(64) })).rejects.toBeInstanceOf(SourceChangedError)
    expect(readdirSync(join(sb.libraryRoot, 'originals', '2024', '07'))).toEqual([])
    expect(readdirSync(join(sb.libraryRoot, 'temp'))).toEqual([])
  })

  it('handles many collisions deterministically', async () => {
    const names = [...candidateNames('IMG.jpg', 'abcdef0123456789'.repeat(4))].slice(0, 4)
    expect(names).toEqual(['IMG.jpg', 'IMG_abcdef01.jpg', 'IMG_abcdef0123456789.jpg', 'IMG_abcdef01_2.jpg'])
  })
})

describe('safeFilename', () => {
  it('strips path components and characters invalid on Windows', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd')
    expect(safeFilename('a:b*c?.JPG')).toBe('a_b_c_.JPG')
    expect(safeFilename('CON.jpg')).toBe('CON_.jpg')
    expect(safeFilename('photo. ')).toBe('photo')
  })
})
