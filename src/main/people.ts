import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from '@core/media/sharp'
import type { PeopleStatus } from '@shared/types'
import { FACE_MODELS, FACE_VERSION } from '@core/ai/faces'
import type { Library } from '@core/library/library'
import { applyClusterResult, clearFaceData, recordFaceScan } from '@core/repo/people'
import { addManualFace } from '@core/repo/annotate'
import { errorMessage } from '@core/util'
import type { HeavyWork } from './heavyWork'

const BATCH = 6
/** Bump when the grouping method changes: existing people are re-grouped once (user decisions are kept). */
const GROUPING_VERSION = 2
/** Re-group after this many newly scanned photos, so people appear while the scan is still running. */
const REGROUP_EVERY = 400

/** The picture to scan for an item (a frame for videos); `cleanup` removes temporary files afterwards. */
export type ImageFor = (assetId: number) => Promise<{ path: string; rotation: number; cleanup?: () => Promise<void> } | null>

/** Where face crops are cached (regenerable, like thumbnails). */
/**
 * Cache path of a face crop, named after the photo's content (SHA-256) and the face's position — never after a
 * database id, which a copy or restore of the catalogue could give to a different face.
 */
export function faceCropPath(library: Library, face: { sha256: string; x: number; y: number; w: number; h: number }): string {
  const k = [face.x, face.y, face.w, face.h].map((v) => Math.round(v * 10_000)).join('-')
  return join(library.root, 'thumbnails', 'faces', face.sha256.slice(0, 2), `${face.sha256}-${k}.webp`)
}

async function writeCrop(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, data)
}

/** At most four crops are cut from originals at a time (the People page asks for hundreds at once). */
let cutting = 0
const waiting: Array<() => void> = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (cutting >= 4) await new Promise<void>((r) => waiting.push(r))
  cutting++
  try {
    return await fn()
  } finally {
    cutting--
    waiting.shift()?.()
  }
}

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

/**
 * People: finds faces on every photo and groups them into people, entirely on this computer. Off until the
 * user turns it on (per library). The two models (~39 MB) are downloaded once and checked against known
 * SHA-256 hashes. Face data (boxes, 128-number face vectors, crops) stays in the library and can be deleted
 * at any time; photos are never changed.
 */
export class PeopleService {
  private status: PeopleStatus = { enabled: false, phase: 'off', scanned: 0, total: 0, faces: 0, people: 0, download: null, error: null }
  private running: Promise<void> | null = null
  private failed = new Set<number>()
  private stopped = false
  private regroupPending = false

  constructor(
    private readonly library: Library,
    private readonly heavy: HeavyWork,
    private readonly modelsDir: string,
    private readonly imageFor: ImageFor,
    private readonly onStatus: (s: PeopleStatus) => void,
    private readonly onChanged: () => void
  ) {
    this.status.enabled = library.db.get<{ value: string }>("SELECT value FROM library_settings WHERE key = 'people'")?.value === '1'
    if (this.status.enabled) this.status.phase = 'scanning'
    this.refreshCounts()
  }

  get(): PeopleStatus {
    this.refreshCounts()
    return { ...this.status }
  }

  start(): void {
    void this.removeOldCrops()
    if (!this.status.enabled) return
    // A newer grouping method (e.g. merging people found in different scan batches) runs once over existing data.
    const stored = Number(this.library.db.get<{ value: string }>("SELECT value FROM library_settings WHERE key = 'people_grouping'")?.value ?? 0)
    if (stored < GROUPING_VERSION) this.regroupPending = true
    this.kick()
  }

  stop(): void {
    this.stopped = true
  }

  enable(on: boolean): void {
    this.library.db.run(
      "INSERT INTO library_settings (key, value) VALUES ('people', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [on ? '1' : '0']
    )
    this.library.logger.info('people.enabled', { enabled: on })
    this.status.enabled = on
    this.status.error = null
    if (on) this.kick()
    else this.set({ phase: 'off', download: null })
  }

  /** Turns People off and forgets every face (crops included). */
  async clear(): Promise<void> {
    this.enable(false)
    await this.running?.catch(() => undefined)
    clearFaceData(this.library)
    const { rm } = await import('node:fs/promises')
    await rm(join(this.library.root, 'thumbnails', 'faces'), { recursive: true, force: true })
    this.refreshCounts()
    this.set({})
    this.onChanged()
  }

  /**
   * A face the scan missed, marked by the user. If the models are available the detector looks inside the
   * box (with a lower bar) so the face gets a fingerprint and can be grouped; otherwise it is kept as a box.
   */
  async addFace(assetId: number, box: { x: number; y: number; w: number; h: number }): Promise<number> {
    let found: { x: number; y: number; w: number; h: number; score: number; quality: number; vec: Uint8Array; crop: Uint8Array } | null = null
    const modelsReady = Object.values(FACE_MODELS).every((m) => existsSync(join(this.modelsDir, m.file)))
    if (modelsReady) {
      try {
        const img = await this.imageFor(assetId)
        if (img) {
          const faces = await this.heavy.faceRegion(this.modelsDir, img.path, img.rotation, box)
          const overlap = (f: { x: number; y: number; w: number; h: number }): number => {
            const ix = Math.max(0, Math.min(f.x + f.w, box.x + box.w) - Math.max(f.x, box.x))
            const iy = Math.max(0, Math.min(f.y + f.h, box.y + box.h) - Math.max(f.y, box.y))
            return ix * iy
          }
          found = faces.sort((a, b) => overlap(b) - overlap(a))[0] ?? null
        }
      } catch (err) {
        this.library.logger.warn('people.add_face_detect_failed', { assetId, error: errorMessage(err) })
      }
    }
    const id = addManualFace(
      this.library,
      assetId,
      box,
      found ? { ...found, vec: new Float32Array(found.vec.buffer.slice(found.vec.byteOffset, found.vec.byteOffset + found.vec.byteLength)) } : null
    )
    if (found) {
      mkdirSync(join(this.library.root, 'thumbnails', 'faces'), { recursive: true })
      const sha = this.library.db.get<{ sha256: string }>('SELECT sha256 FROM assets WHERE id = ?', [assetId])?.sha256
      if (sha) await writeCrop(faceCropPath(this.library, { sha256: sha, ...found }), found.crop)
    }
    this.onChanged()
    return id
  }

  /** Crops used to be named by face id (unsafe across catalogue copies); those cache files are removed once. */
  private async removeOldCrops(): Promise<void> {
    const db = this.library.db
    if (db.get<{ value: string }>("SELECT value FROM library_settings WHERE key = 'face_crops'")?.value === '2') return
    const dir = join(this.library.root, 'thumbnails', 'faces')
    try {
      const { readdir } = await import('node:fs/promises')
      let n = 0
      for (const name of existsSync(dir) ? await readdir(dir) : []) {
        if (/^\d+\.webp$/.test(name)) {
          await unlink(join(dir, name)).catch(() => undefined)
          n++
        }
      }
      db.run("INSERT INTO library_settings (key, value) VALUES ('face_crops', '2') ON CONFLICT (key) DO UPDATE SET value = '2'")
      if (n) this.library.logger.info('people.old_crops_removed', { count: n })
    } catch (err) {
      this.library.logger.warn('people.old_crops_failed', { error: errorMessage(err) })
    }
  }

  /** The face's crop from the cache, or cut from the original (and cached) when missing. */
  async cropFor(faceId: number): Promise<string | null> {
    const f = this.library.db.get<{ asset_id: number; sha256: string; x: number; y: number; w: number; h: number }>(
      'SELECT f.asset_id, a.sha256, f.x, f.y, f.w, f.h FROM faces f JOIN assets a ON a.id = f.asset_id WHERE f.id = ?',
      [faceId]
    )
    if (!f) return null
    const dest = faceCropPath(this.library, f)
    if (existsSync(dest)) return dest
    return slot(async () => {
      if (existsSync(dest)) return dest
      const img = await this.imageFor(f.asset_id).catch(() => null)
      if (!img) return null
      try {
        let pipeline = sharp(img.path, { failOn: 'none' }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        if (img.rotation) pipeline = sharp(await pipeline.png({ compressionLevel: 0 }).toBuffer()).rotate(img.rotation)
        const { data, info } = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true })
        const W = info.width
        const H = info.height
        const side = Math.max(1, Math.min(W, H, Math.round(Math.max(f.w * W, f.h * H) * 1.6)))
        const left = Math.min(W - side, Math.max(0, Math.round((f.x + f.w / 2) * W - side / 2)))
        const top = Math.min(H - side, Math.max(0, Math.round((f.y + f.h / 2) * H - side / 2)))
        const crop = await sharp(data, { raw: { width: W, height: H, channels: 3 } })
          .extract({ left, top, width: side, height: side })
          .resize(160, 160)
          .webp({ quality: 82 })
          .toBuffer()
        await writeCrop(dest, crop)
        return dest
      } catch (err) {
        this.library.logger.warn('people.crop_failed', { faceId, error: errorMessage(err) })
        return null
      } finally {
        await img.cleanup?.()
      }
    })
  }

  /** Scans anything new (after imports…). Safe to call often. */
  kick(): void {
    if (!this.status.enabled || this.running || this.stopped) return
    this.running = this.loop().finally(() => {
      this.running = null
    })
  }

  private set(patch: Partial<PeopleStatus>): void {
    Object.assign(this.status, patch)
    this.onStatus({ ...this.status })
  }

  private refreshCounts(): void {
    const db = this.library.db
    const r = db.get<{ scanned: number; total: number; faces: number; people: number }>(
      `SELECT (SELECT COUNT(*) FROM face_scans s JOIN assets a ON a.id = s.asset_id WHERE a.trashed_at IS NULL AND s.version >= ?) AS scanned,
              (SELECT COUNT(*) FROM assets WHERE trashed_at IS NULL AND live_photo_of IS NULL) AS total,
              (SELECT COUNT(*) FROM faces) AS faces,
              (SELECT COUNT(*) FROM persons) AS people`,
      [FACE_VERSION]
    )
    Object.assign(this.status, r ?? {})
  }

  private async ensureModels(): Promise<void> {
    mkdirSync(this.modelsDir, { recursive: true })
    const files = Object.values(FACE_MODELS)
    const needed = files.filter((m) => {
      const p = join(this.modelsDir, m.file)
      return !existsSync(p) || statSync(p).size !== m.bytes
    })
    if (needed.length === 0) return
    const total = needed.reduce((s, m) => s + m.bytes, 0)
    let loaded = 0
    this.set({ phase: 'downloading', download: { loaded, total } })
    for (const m of needed) {
      const dest = join(this.modelsDir, m.file)
      const part = `${dest}.part`
      const res = await fetch(m.url)
      if (!res.ok || !res.body) throw new Error(`Could not download ${m.file} (HTTP ${res.status})`)
      const chunks: Uint8Array[] = []
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.byteLength
        this.set({ download: { loaded, total } })
      }
      await writeFile(part, Buffer.concat(chunks))
      if ((await sha256(part)) !== m.sha256) {
        await unlink(part).catch(() => undefined)
        throw new Error(`${m.file} did not match its expected fingerprint; it was discarded.`)
      }
      await rename(part, dest)
    }
    this.library.logger.info('people.models_downloaded', { files: needed.map((m) => m.file) })
  }

  private async regroup(): Promise<void> {
    this.set({ phase: 'grouping' })
    const r = await this.heavy.faceCluster(this.library.paths.dbFile)
    const applied = applyClusterResult(this.library, r)
    this.library.db.run(
      "INSERT INTO library_settings (key, value) VALUES ('people_grouping', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [String(GROUPING_VERSION)]
    )
    this.regroupPending = false
    this.library.logger.info('people.grouped', applied)
    this.refreshCounts()
    this.onChanged()
  }

  private async loop(): Promise<void> {
    const db = this.library.db
    try {
      await this.ensureModels()
      if (this.regroupPending) await this.regroup() // a newer grouping method: apply it to existing people first
      this.set({ phase: 'scanning', download: null, error: null })
      let sinceGroup = 0
      let scannedAny = false
      while (this.status.enabled && !this.stopped) {
        const batch = db.all<{ id: number }>(
          `SELECT a.id FROM assets a LEFT JOIN face_scans s ON s.asset_id = a.id
            WHERE a.trashed_at IS NULL AND a.live_photo_of IS NULL
              AND (s.asset_id IS NULL OR s.version < ?) AND a.id NOT IN (SELECT value FROM json_each(?))
            ORDER BY a.sort_time DESC LIMIT ?`,
          [FACE_VERSION, JSON.stringify([...this.failed]), BATCH]
        )
        if (batch.length === 0) break
        const items: Array<{ id: number; path: string; rotation: number; cleanup?: () => Promise<void> }> = []
        for (const b of batch) {
          const img = await this.imageFor(b.id).catch(() => null)
          if (img) items.push({ id: b.id, ...img })
          else this.failed.add(b.id)
        }
        if (items.length === 0) continue
        const results = await this.heavy
          .faceScan(
            this.modelsDir,
            items.map((i) => ({ path: i.path, rotation: i.rotation }))
          )
          .finally(() => Promise.all(items.map((i) => i.cleanup?.())))
        mkdirSync(join(this.library.root, 'thumbnails', 'faces'), { recursive: true })
        for (let i = 0; i < items.length; i++) {
          const item = items[i] as (typeof items)[number]
          const r = results[i]
          if (!r || 'error' in r) {
            this.failed.add(item.id)
            continue
          }
          const faces = r.faces.map((f) => ({ ...f, vec: new Float32Array(f.vec.buffer.slice(f.vec.byteOffset, f.vec.byteOffset + f.vec.byteLength)) }))
          const ids = recordFaceScan(this.library, item.id, faces, FACE_VERSION)
          const sha = this.library.db.get<{ sha256: string }>('SELECT sha256 FROM assets WHERE id = ?', [item.id])?.sha256
          if (sha) await Promise.all(r.faces.map((f) => writeCrop(faceCropPath(this.library, { sha256: sha, ...f }), f.crop)))
          if (ids.length) {
            sinceGroup++
            scannedAny = true
          }
        }
        this.refreshCounts()
        this.set({})
        if (sinceGroup >= REGROUP_EVERY) {
          sinceGroup = 0
          await this.regroup()
          this.set({ phase: 'scanning' })
        }
      }
      if (this.status.enabled && !this.stopped) {
        const neverGrouped = this.status.people === 0 && this.status.faces > 0
        if (scannedAny || neverGrouped || this.regroupPending) await this.regroup()
        this.refreshCounts()
        this.set({ phase: 'ready' })
      }
    } catch (err) {
      this.library.logger.error('people.failed', { error: errorMessage(err) })
      this.set({ phase: 'error', error: errorMessage(err) })
    }
  }
}
