import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Library } from '@core/library/library'
import { ImportService } from '@core/import/service'
import { WatchService } from '@core/library/watch'
import { count, makeJpeg, openLibrary, sandbox, type Sandbox } from './helpers'

let sb: Sandbox
let lib: Library
let watch: WatchService
beforeEach(() => {
  sb = sandbox()
  lib = openLibrary(sb.libraryRoot)
  watch = new WatchService(lib, new ImportService(lib))
})
afterEach(() => {
  watch.stop()
  lib.close()
  sb.cleanup()
})

describe('watched folders', () => {
  it('imports new photos automatically and leaves no trace when nothing changed', async () => {
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#123456' })
    await makeJpeg(join(sb.source, 'sub', 'b.jpg'), { color: '#654321' })
    const f = watch.add(sb.source)
    expect(await watch.unseenFiles(f.path)).toHaveLength(2)

    await watch.checkAll()
    expect(count(lib, 'assets')).toBe(2)
    expect(lib.db.get<{ trigger: string; status: string }>('SELECT trigger, status FROM imports')).toEqual({ trigger: 'watch', status: 'completed' })
    expect(watch.list()[0]).toMatchObject({ lastImported: 2, lastError: null })

    await watch.checkAll() // nothing new: no import record
    expect(count(lib, 'imports')).toBe(1)

    await makeJpeg(join(sb.source, 'c.jpg'), { color: '#abcdef' })
    await watch.checkAll()
    expect(count(lib, 'assets')).toBe(3)
    expect(count(lib, 'imports')).toBe(2)
    expect(watch.list()[0]!.lastImported).toBe(1)
  })

  it('refuses folders that overlap the library', () => {
    expect(() => watch.add(join(sb.libraryRoot, 'originals'))).toThrow(/inside the library/)
    expect(() => watch.add(sb.dir)).toThrow(/library is inside/)
  })
})

describe('watched folders (regression)', () => {
  it('still checks after an earlier check found no folders', async () => {
    await watch.checkAll() // nothing watched yet: completes immediately
    await makeJpeg(join(sb.source, 'a.jpg'), { color: '#123456' })
    watch.add(sb.source)
    await watch.checkAll()
    expect(count(lib, 'assets')).toBe(1)
  })
})
