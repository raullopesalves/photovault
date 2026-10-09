import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Library } from '@core/library/library'
import { applyEdits, cleanEdits, decodeOriented } from '@core/media/edits'
import { assetDetail, thumbnailPath } from '@core/repo/queries'
import { ThumbnailQueue, originalPathFor } from '@core/thumbnails/thumbnails'
import { makeJpeg, openLibrary, runImport, sandbox, type Sandbox } from './helpers'
import { editState, renderEdited, saveEdits } from '../src/main/editing'

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

describe('photo edits', () => {
  it('normalises edit values from the UI', () => {
    expect(cleanEdits({ light: 0.004, contrast: 2, crop: { x: 0, y: 0, w: 1, h: 1 }, filter: 'nope' })).toEqual({ contrast: 1 })
    expect(cleanEdits({ crop: { x: 0.1, y: 0.2, w: 2, h: 0.5 }, flip: true, filter: 'bw' })).toEqual({ crop: { x: 0.1, y: 0.2, w: 0.9, h: 0.5 }, flip: true, filter: 'bw' })
    expect(cleanEdits({})).toBeNull()
  })

  it('crops, rotates and filters a rendition without touching the original', async () => {
    const path = await makeJpeg(join(sb.source, 'wide.jpg'), { width: 400, height: 200, color: '#3366cc' })
    await runImport(lib, sb.source)
    const id = lib.db.get<{ id: number }>('SELECT id FROM assets')!.id
    const original = readFileSync(originalPathFor(lib, id)!.absolutePath)
    const q = new ThumbnailQueue(lib)
    await q.drain()

    // Raw pipeline: rotate 90° then crop the left half of the rotated (200×400) picture → 100×400, grey.
    const raw = await decodeOriented(path, 'image/jpeg', 2048)
    const out = await (await applyEdits(raw, 90, { crop: { x: 0, y: 0, w: 0.5, h: 1 }, filter: 'bw' })).raw().toBuffer({ resolveWithObject: true })
    expect([out.info.width, out.info.height]).toEqual([100, 400])

    saveEdits(lib, id, 90, { crop: { x: 0, y: 0, w: 0.5, h: 1 }, light: 0.3 })
    await q.rerender(id)
    const meta = await sharp(thumbnailPath(lib, id, 'thumb')!).metadata()
    expect([meta.width, meta.height]).toEqual([100, 400])
    const d = assetDetail(lib, id)!
    expect(d).toMatchObject({ edited: true, rotation: 90, fullView: 'preview', rev: '90.1' })
    expect(editState(lib, id)).toEqual({ rotation: 90, edits: { crop: { x: 0, y: 0, w: 0.5, h: 1 }, light: 0.3 } })
    const edited = await renderEdited(lib, id)
    expect(edited.name).toBe('wide (edited).jpg')
    expect((await sharp(edited.jpeg).metadata()).width).toBe(100)

    saveEdits(lib, id, 0, null) // revert to original
    expect(assetDetail(lib, id)).toMatchObject({ edited: false, rotation: 0, fullView: 'original' })
    expect(readFileSync(originalPathFor(lib, id)!.absolutePath).equals(original)).toBe(true)
  })
})
