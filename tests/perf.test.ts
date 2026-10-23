// 100k-item performance check (catalogue only, no media files). Opt-in: `npm run test:perf` (PERF=1).
// Builds a synthetic library shaped like a real one — phone photos, WhatsApp images, screenshots, near-copies,
// bursts, GPS — then times every query the UI runs, against a budget.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Library } from '@core/library/library'
import { runDating } from '@core/dating/dating'
import { facets } from '@core/repo/filters'
import { libraryPlaces, mapClusters } from '@core/repo/geo'
import { nearDuplicates } from '@core/repo/nearDuplicates'
import { assetIdsInRange, assetsPage, libraryInfo, timeline } from '@core/repo/queries'
import { refreshSearchIndex } from '@core/repo/search'
import { similarPhotos } from '@core/repo/similar'
import { openLibrary, sandbox, type Sandbox } from './helpers'

const N = 100_000
let sb: Sandbox
let lib: Library
const results: Array<[string, number, number]> = []

function time<T>(label: string, budgetMs: number, fn: () => T): T {
  const t = performance.now()
  const r = fn()
  const ms = performance.now() - t
  results.push([label, ms, budgetMs])
  expect(ms, `${label} took ${ms.toFixed(0)} ms (budget ${budgetMs} ms)`).toBeLessThan(budgetMs)
  return r
}

describe.runIf(process.env.PERF === '1')('100k library', () => {
  beforeAll(() => {
    sb = sandbox()
    lib = openLibrary(sb.libraryRoot)
    const db = lib.db
    let seed = 42
    const rnd = (): number => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    const hex = (bytes: number): string => Array.from({ length: bytes }, () => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('')
    const now = new Date().toISOString()
    const t0 = performance.now()
    db.tx(() => {
      const imp = db.run("INSERT INTO imports (source_type, source_path, status, started_at) VALUES ('LOCAL_FOLDER', 'D:/Photos', 'completed', ?)", [now]).lastInsertRowid
      const asset = db.raw.prepare(
        `INSERT INTO assets (sha256, media_type, mime_type, size_bytes, width, height, capture_time, capture_time_source, sort_time, sort_day, sort_time_source,
                             original_filename, camera_make, camera_model, latitude, longitude, thumb_status, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`
      )
      const prov = db.raw.prepare(
        `INSERT INTO provenance (asset_id, source_type, source_root, source_path, relative_path, original_filename, size_bytes, first_import_id, last_import_id, first_seen_at, last_seen_at)
         VALUES (?, 'LOCAL_FOLDER', 'D:/Photos', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const hash = db.raw.prepare('INSERT INTO asset_hashes (asset_id, dhash, phash, color, flat, sharpness, version, created_at) VALUES (?, ?, ?, ?, 0, ?, 4, ?)')
      let base = { p: hex(8), d: hex(8), c: hex(12) }
      let t = Date.UTC(2012, 0, 1)
      for (let i = 1; i <= N; i++) {
        t += Math.floor(rnd() * 2_500_000) // ~ 100k photos over ~8 years
        const kind = rnd()
        const whatsapp = kind < 0.35
        const camera = kind > 0.55
        const dated = !whatsapp || rnd() < 0.2
        const wall = new Date(t).toISOString().slice(0, 19)
        const name = whatsapp ? `IMG-${wall.slice(0, 10).replace(/-/g, '')}-WA${String(i % 9999).padStart(4, '0')}.jpg` : camera ? `IMG_${20000000 + i}.jpg` : `Screenshot_${i}.png`
        const folder = whatsapp ? 'WhatsApp Images' : camera ? `Camera/${wall.slice(0, 4)}` : 'Screenshots'
        const video = rnd() < 0.08
        const geo = camera && rnd() < 0.5
        const id = Number(
          asset.run(
            i.toString(16).padStart(64, '0'), video ? 'video' : 'photo', video ? 'video/mp4' : camera || whatsapp ? 'image/jpeg' : 'image/png', 200_000 + Math.floor(rnd() * 4_000_000),
            camera ? 4000 : 1600, camera ? 3000 : 1200, dated ? wall : null, dated ? (camera ? 'exif_original' : 'filename') : null,
            t, wall.slice(0, 10), dated ? 'capture' : 'file_modified', name, camera ? 'Xiaomi' : null, camera ? 'M2012K11AG' : null,
            geo ? 38 + rnd() * 6 : null, geo ? -9 + rnd() * 6 : null, whatsapp ? 'whatsapp' : camera ? 'camera' : 'screenshot', now, now
          ).lastInsertRowid
        )
        prov.run(id, `D:/Photos/${folder}/${name}`, `${folder}/${name}`, name, 1, imp, imp, now, now)
        // 1 in 10 is a near-copy or burst shot of the previous picture.
        if (rnd() > 0.1) base = { p: hex(8), d: hex(8), c: hex(12) }
        if (!video) hash.run(id, base.d, base.p, base.c, 50 + rnd() * 400, now)
      }
    })
    console.log(`built ${N} items in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
  }, 600_000)

  afterAll(() => {
    if (results.length) console.table(results.map(([label, ms, budget]) => ({ query: label, ms: Math.round(ms), budget })))
    lib?.close()
    sb?.cleanup()
  })

  it('answers every UI query within budget', () => {
    // Place names for the geotagged items, as the background lookup would set them (about 400 towns).
    lib.db.run("UPDATE assets SET place = 'Town ' || (id % 400) || ', Portugal' WHERE latitude IS NOT NULL")
    time('search index build (all)', 30_000, () => refreshSearchIndex(lib))
    time('library info', 300, () => libraryInfo(lib))
    const months = time('timeline (months)', 300, () => timeline(lib, { hidden: 'exclude' }))
    expect(months.reduce((s, m) => s + m.count, 0)).toBe(N)
    time('first page', 100, () => assetsPage(lib, 0, 200, { hidden: 'exclude' }))
    time('page deep in the timeline', 150, () => assetsPage(lib, 80_000, 200, { hidden: 'exclude' }))
    time('recently added', 300, () => timeline(lib, { sort: 'added' }))
    time('filter: year + origin', 300, () => timeline(lib, { years: [2016], origins: ['whatsapp'] }))
    time('facets', 800, () => facets(lib))
    time('Photos without screenshots (timeline)', 300, () => timeline(lib, { hidden: 'exclude', excludeOrigins: ['screenshot', 'screen_recording'] }))
    time('Photos without screenshots (deep page)', 150, () => assetsPage(lib, 60_000, 200, { hidden: 'exclude', excludeOrigins: ['screenshot', 'screen_recording'] }))
    time('places for search', 300, () => libraryPlaces(lib))
    time('filter: place', 300, () => timeline(lib, { place: 'Town 7, Portugal' }))
    time('search "WA00" (timeline)', 300, () => timeline(lib, { text: 'WA00' }))
    time('search "camera 2019" (page)', 300, () => assetsPage(lib, 0, 200, { text: 'camera 2019' }))
    time('search 2-letter token', 500, () => timeline(lib, { text: 'sc' }))
    time('select range (shift-click 50k)', 400, () => assetIdsInRange(lib, undefined, 0, 50_000))
    time('map clusters (world)', 500, () => mapClusters(lib, { south: -85, west: -180, north: 85, east: 180, zoom: 3 }))
    time('map clusters (city)', 500, () => mapClusters(lib, { south: 38.5, west: -9, north: 39, east: -8.5, zoom: 12 }))
    time('probable duplicates (first run)', 15_000, () => nearDuplicates(lib, 0, 30))
    time('probable duplicates (cached)', 300, () => nearDuplicates(lib, 0, 30))
    time('similar photos', 10_000, () => similarPhotos(lib, 0, 30))
    time('dating pass', 30_000, () => runDating(lib, { force: true }))
  }, 600_000)
})
