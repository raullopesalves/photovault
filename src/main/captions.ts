import { join } from 'node:path'
import type { CaptionStatus } from '@shared/types'
import { CAPTION_MODEL } from '@core/ai/caption'
import type { Library } from '@core/library/library'
import { refreshSearchIndex } from '@core/repo/search'
import { errorMessage } from '@core/util'
import type { HeavyWork } from './heavyWork'

const BATCH = 8

/**
 * Automatic descriptions: when turned on, describes every photo and video (from its thumbnail) in the
 * background, newest first, on its own worker thread so smart search and People are not held up. About two
 * seconds per photo. Descriptions are kept when paused and are found by the ordinary search box.
 */
export class CaptionService {
  private status: CaptionStatus = { enabled: false, phase: 'off', described: 0, total: 0, download: null, error: null }
  private running: Promise<void> | null = null
  private stopped = false

  constructor(
    private readonly library: Library,
    private readonly heavy: HeavyWork,
    private readonly modelsDir: string,
    private readonly onStatus: (s: CaptionStatus) => void
  ) {
    this.status.enabled = library.db.get<{ value: string }>("SELECT value FROM library_settings WHERE key = 'captions'")?.value === '1'
    this.refreshCounts()
  }

  get(): CaptionStatus {
    this.refreshCounts()
    return { ...this.status }
  }

  start(): void {
    this.kick()
  }

  stop(): void {
    this.stopped = true
  }

  enable(on: boolean): void {
    this.library.db.run("INSERT INTO library_settings (key, value) VALUES ('captions', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [on ? '1' : '0'])
    this.library.logger.info('captions.enabled', { enabled: on, model: CAPTION_MODEL })
    this.status.enabled = on
    this.status.error = null
    if (on) this.kick()
    else this.set({ phase: 'off', download: null })
  }

  /** Describes anything new (after imports). Safe to call often. */
  kick(): void {
    if (!this.status.enabled || this.running || this.stopped) return
    this.running = this.loop().finally(() => {
      this.running = null
    })
  }

  private set(patch: Partial<CaptionStatus>): void {
    Object.assign(this.status, patch)
    this.onStatus({ ...this.status })
  }

  private refreshCounts(): void {
    const db = this.library.db
    this.status.described = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM asset_captions')?.n ?? 0
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
      await this.heavy.captionLoad(this.modelsDir, true, (p) => {
        files.set(p.file, { loaded: p.loaded, total: p.total })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        this.set({ phase: 'downloading', download: { loaded, total } })
      })
      this.set({ phase: 'describing', download: null })
      while (this.status.enabled && !this.stopped) {
        const batch = db.all<{ id: number; relative_path: string }>(
          `SELECT a.id, t.relative_path FROM assets a
             JOIN asset_thumbnails t ON t.asset_id = a.id AND t.variant = 'thumb'
             LEFT JOIN asset_captions c ON c.asset_id = a.id
            WHERE c.asset_id IS NULL AND a.trashed_at IS NULL AND a.live_photo_of IS NULL
            ORDER BY a.undated, a.sort_time DESC LIMIT ?`,
          [BATCH]
        )
        if (batch.length === 0) break
        const captions = await this.heavy.caption(
          this.modelsDir,
          batch.map((b) => join(this.library.root, ...b.relative_path.split('/')))
        )
        if (this.stopped) return
        const now = new Date().toISOString()
        db.tx(() => {
          // An unreadable thumbnail is recorded with no caption, so it is not tried again and again.
          batch.forEach((b, i) =>
            db.run(
              `INSERT INTO asset_captions (asset_id, caption, model, created_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (asset_id) DO UPDATE SET caption = excluded.caption, model = excluded.model, created_at = excluded.created_at`,
              [b.id, captions[i] ?? null, CAPTION_MODEL, now]
            )
          )
        })
        refreshSearchIndex(this.library, 200)
        this.refreshCounts()
        this.set({})
      }
      if (this.status.enabled && !this.stopped) {
        this.refreshCounts()
        this.set({ phase: 'ready' })
      }
    } catch (err) {
      this.library.logger.error('captions.failed', { error: errorMessage(err) })
      this.set({ phase: 'error', error: errorMessage(err) })
    }
  }
}
