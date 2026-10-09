import { join } from 'node:path'
import type { PetGroup, SmartSearchStatus } from '@shared/types'
import { CLIP_MODEL } from '@core/ai/clip'
import type { Library } from '@core/library/library'
import { errorMessage } from '@core/util'
import type { HeavyWork } from './heavyWork'
import { originalPathFor } from '@core/thumbnails/thumbnails'
import { videoFramesToTemp } from './videos'

const BATCH = 16

/**
 * Smart search: describes photos with on-device CLIP vectors so they can be found by what they show
 * ("beach at sunset", "dog", "birthday cake"). Off until the user turns it on (per library); then the model
 * is downloaded once into the app's data folder and every thumbnail is indexed in the background on the
 * worker thread. Vectors live in the catalogue (asset_embeddings); photos never leave the computer.
 */
/**
 * Labels for finding pets. Every photo goes to the label it looks most like; only clear dog and cat winners
 * count, so people, food, toys and drawings stay out. (Which dog is which is not recognised.)
 */
const PET_LABELS = [
  'a photo of a dog',
  'a photo of a cat',
  'a photo of a person',
  'a photo of people',
  'a selfie',
  'a photo of food',
  'a landscape photo',
  'a photo of a city street',
  'a screenshot',
  'a photo of a document',
  'a photo of a car',
  'a photo of a building',
  'a photo of a room',
  'a photo of an object',
  'a drawing',
  'a photo of a bird',
  'a photo of a horse',
  'a photo of a stuffed animal toy',
  'a meme with text',
  'a cartoon'
]

export class SmartSearchService {
  private status: SmartSearchStatus = { enabled: false, phase: 'off', indexed: 0, total: 0, download: null, error: null }
  private running: Promise<void> | null = null
  private failed = new Set<number>()
  private stopped = false

  constructor(
    private readonly library: Library,
    private readonly heavy: HeavyWork,
    private readonly modelsDir: string,
    private readonly onStatus: (s: SmartSearchStatus) => void
  ) {
    this.status.enabled = library.db.get<{ value: string }>("SELECT value FROM library_settings WHERE key = 'smart_search'")?.value === '1'
    this.refreshCounts()
  }

  get(): SmartSearchStatus {
    this.refreshCounts()
    return { ...this.status }
  }

  start(): void {
    if (!this.status.enabled) return
    // Videos used to be indexed from their thumbnail only; index them again from several frames (once).
    const done = this.library.db.get<{ value: string }>("SELECT value FROM library_settings WHERE key = 'smart_video_frames'")?.value === '1'
    if (!done) {
      this.library.db.run("DELETE FROM asset_embeddings WHERE asset_id IN (SELECT id FROM assets WHERE media_type = 'video')")
      this.library.db.run("INSERT INTO library_settings (key, value) VALUES ('smart_video_frames', '1') ON CONFLICT (key) DO UPDATE SET value = '1'")
    }
    this.kick()
  }

  stop(): void {
    this.stopped = true
  }

  enable(on: boolean): void {
    this.library.db.run(
      "INSERT INTO library_settings (key, value) VALUES ('smart_search', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [on ? '1' : '0']
    )
    this.library.logger.info('smart_search.enabled', { enabled: on, model: CLIP_MODEL })
    this.status.enabled = on
    this.status.error = null
    if (on) this.kick()
    else this.set({ phase: 'off', download: null })
  }

  /** Indexes anything new (after imports, rotations…). Safe to call often. */
  kick(): void {
    if (!this.status.enabled || this.running || this.stopped) return
    this.running = this.loop().finally(() => {
      this.running = null
    })
  }

  async search(text: string, limit = 400): Promise<Array<{ id: number; score: number }>> {
    if (!this.status.enabled) throw new Error('Smart search is off.')
    await this.heavy.clipLoad(this.modelsDir, false)
    return this.heavy.clipSearch(this.modelsDir, this.library.paths.dbFile, text, limit)
  }

  private set(patch: Partial<SmartSearchStatus>): void {
    Object.assign(this.status, patch)
    this.onStatus({ ...this.status })
  }

  /** Dogs and cats (most certain first), visible items only; empty until smart search has looked at photos. */
  async pets(): Promise<PetGroup[]> {
    this.refreshCounts()
    if (!this.status.enabled || this.status.indexed === 0) return []
    await this.heavy.clipLoad(this.modelsDir, false)
    const [dogs = [], cats = []] = await this.heavy.clipClassify(this.modelsDir, this.library.paths.dbFile, PET_LABELS, [0, 1], 0.6)
    const visible = (ids: number[]): number[] => {
      const ok = new Set(
        this.library.db
          .all<{ id: number }>('SELECT id FROM assets WHERE id IN (SELECT value FROM json_each(?)) AND trashed_at IS NULL AND hidden = 0', [JSON.stringify(ids)])
          .map((r) => r.id)
      )
      return ids.filter((id) => ok.has(id))
    }
    const groups: PetGroup[] = [
      { kind: 'dog', ids: visible(dogs) },
      { kind: 'cat', ids: visible(cats) }
    ]
    return groups.filter((g) => g.ids.length >= 3)
  }

  private refreshCounts(): void {
    const db = this.library.db
    this.status.indexed = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM asset_embeddings')?.n ?? 0
    this.status.total =
      db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM assets a JOIN asset_thumbnails t ON t.asset_id = a.id AND t.variant = 'thumb'
          WHERE a.trashed_at IS NULL AND a.live_photo_of IS NULL`
      )?.n ?? 0
  }

  private async loop(): Promise<void> {
    const db = this.library.db
    try {
      this.set({ phase: 'loading', error: null })
      const files = new Map<string, { loaded: number; total: number }>()
      await this.heavy.clipLoad(this.modelsDir, true, (p) => {
        files.set(p.file, { loaded: p.loaded, total: p.total })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        this.set({ phase: 'downloading', download: { loaded, total } })
      })
      this.set({ phase: 'indexing', download: null })
      while (this.status.enabled && !this.stopped) {
        const batch = db.all<{ id: number; relative_path: string; media_type: string; duration_ms: number | null }>(
          `SELECT a.id, t.relative_path, a.media_type, a.duration_ms FROM assets a
             JOIN asset_thumbnails t ON t.asset_id = a.id AND t.variant = 'thumb'
             LEFT JOIN asset_embeddings e ON e.asset_id = a.id
            WHERE e.asset_id IS NULL AND a.trashed_at IS NULL AND a.live_photo_of IS NULL
              AND a.id NOT IN (SELECT value FROM json_each(?))
            ORDER BY a.undated, a.sort_time DESC LIMIT ?`,
          [JSON.stringify([...this.failed]), BATCH]
        )
        if (batch.length === 0) break
        // Photos: their thumbnail. Videos: three frames across the clip, averaged (falls back to the thumbnail).
        const inputs: Array<{ paths: string[]; cleanup?: () => Promise<void> }> = []
        for (const b of batch) {
          const thumb = join(this.library.root, ...b.relative_path.split('/'))
          if (b.media_type === 'video') {
            const src = originalPathFor(this.library, b.id)
            const frames = src ? await videoFramesToTemp(src.absolutePath, b.duration_ms, [0.2, 0.5, 0.8], 512) : null
            inputs.push(frames && frames.paths.length ? frames : { paths: [thumb], cleanup: frames?.cleanup })
          } else inputs.push({ paths: [thumb] })
        }
        const flat = await this.heavy.clipEmbed(this.modelsDir, inputs.flatMap((i) => i.paths))
        await Promise.all(inputs.map((i) => i.cleanup?.()))
        let k = 0
        const vecs = inputs.map((i) => {
          const parts = flat.slice(k, (k += i.paths.length)).filter((v): v is Uint8Array => !!v)
          if (parts.length === 0) return null
          if (parts.length === 1) return parts[0] as Uint8Array
          const sum = new Float32Array(512)
          for (const p of parts) {
            const f = new Float32Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength))
            for (let d = 0; d < 512; d++) sum[d] = (sum[d] as number) + (f[d] as number)
          }
          const norm = Math.hypot(...sum) || 1
          return new Uint8Array(sum.map((x) => x / norm).buffer)
        })
        const now = new Date().toISOString()
        db.tx(() => {
          batch.forEach((b, i) => {
            const v = vecs[i]
            if (!v) {
              this.failed.add(b.id)
              return
            }
            db.run(
              `INSERT INTO asset_embeddings (asset_id, model, vec, created_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (asset_id) DO UPDATE SET model = excluded.model, vec = excluded.vec, created_at = excluded.created_at`,
              [b.id, CLIP_MODEL, v, now]
            )
          })
        })
        this.refreshCounts()
        this.set({})
      }
      if (this.status.enabled) {
        this.refreshCounts()
        this.set({ phase: 'ready' })
      }
    } catch (err) {
      this.library.logger.error('smart_search.failed', { error: errorMessage(err) })
      this.set({ phase: 'error', error: errorMessage(err) })
    }
  }
}
