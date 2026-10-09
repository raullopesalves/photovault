import { join } from 'node:path'
import { PHASH_VERSION, visualHashes } from '../media/phash'
import { errorMessage } from '../util'
import type { Library } from './library'

/**
 * Computes perceptual fingerprints for assets whose grid thumbnail exists. Works only from the small
 * cached thumbnail (never the original), so it is cheap: a few milliseconds per item.
 */
export class HashQueue {
  private running = false
  private stopped = false

  constructor(
    private readonly library: Library,
    private readonly opts: { onUpdated?: (count: number) => void; onIdle?: () => void } = {}
  ) {}

  kick(): void {
    if (this.running || this.stopped) return
    this.running = true
    void this.loop().finally(() => {
      this.running = false
    })
  }

  stop(): void {
    this.stopped = true
  }

  async drain(): Promise<void> {
    this.kick()
    while (this.running) await new Promise((r) => setTimeout(r, 20))
  }

  private async loop(): Promise<void> {
    const db = this.library.db
    while (!this.stopped) {
      const rows = db.all<{ id: number; relative_path: string }>(
        `SELECT a.id, t.relative_path FROM assets a
           JOIN asset_thumbnails t ON t.asset_id = a.id AND t.variant = 'thumb'
           LEFT JOIN asset_hashes h ON h.asset_id = a.id
          WHERE h.asset_id IS NULL OR h.version < ?
          ORDER BY a.id LIMIT 64`,
        [PHASH_VERSION]
      )
      if (rows.length === 0) {
        this.opts.onIdle?.()
        return
      }
      const results: Array<{ id: number; dhash: string | null; phash: string | null; color: string | null; flat: number; sharpness: number | null }> = []
      for (const r of rows) {
        if (this.stopped) return
        try {
          const h = await visualHashes(join(this.library.root, ...r.relative_path.split('/')))
          results.push({ id: r.id, dhash: h.dhash, phash: h.phash, color: h.color, flat: h.flat ? 1 : 0, sharpness: h.sharpness })
        } catch (err) {
          // Unreadable thumbnail: record it so it is not retried forever; it simply never matches.
          this.library.logger.warn('phash.failed', { assetId: r.id, error: errorMessage(err) })
          results.push({ id: r.id, dhash: null, phash: null, color: null, flat: 1, sharpness: null })
        }
      }
      const now = new Date().toISOString()
      db.tx(() => {
        for (const r of results) {
          db.run(
            `INSERT INTO asset_hashes (asset_id, dhash, phash, color, flat, sharpness, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (asset_id) DO UPDATE SET dhash = excluded.dhash, phash = excluded.phash, color = excluded.color,
               flat = excluded.flat, sharpness = excluded.sharpness, version = excluded.version, created_at = excluded.created_at`,
            [r.id, r.dhash, r.phash, r.color, r.flat, r.sharpness, PHASH_VERSION, now]
          )
        }
      })
      this.opts.onUpdated?.(results.length)
      await new Promise((r) => setImmediate(r))
    }
  }
}
