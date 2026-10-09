export interface Estimate {
  /** Seconds remaining, or null while there is not enough signal for an honest estimate. */
  etaSeconds: number | null
  /** Units (files or bytes) per second over the recent window. */
  rate: number | null
  elapsedSeconds: number
}

/**
 * Remaining-time estimator for long jobs. It uses the throughput of a sliding window (default 20 s)
 * rather than the average since the start, so phases that speed up (cached hashes) or slow down
 * (a run of large videos) are reflected quickly. The estimate is smoothed so the number doesn't
 * jitter on every update, and withheld until there is a few seconds of data.
 */
export class EtaEstimator {
  private readonly samples: Array<{ t: number; done: number }> = []
  private readonly start: number
  private smoothed: number | null = null

  constructor(
    private readonly opts: { windowMs?: number; warmupMs?: number; now?: () => number } = {}
  ) {
    this.start = this.now()
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now()
  }

  update(done: number, total: number): Estimate {
    const t = this.now()
    const windowMs = this.opts.windowMs ?? 20_000
    const warmupMs = this.opts.warmupMs ?? 3_000
    this.samples.push({ t, done })
    while (this.samples.length > 2 && t - (this.samples[0] as { t: number }).t > windowMs) this.samples.shift()

    const elapsedSeconds = (t - this.start) / 1000
    const first = this.samples[0] as { t: number; done: number }
    const dt = (t - first.t) / 1000
    const dd = done - first.done
    const rate = dt > 0 && dd > 0 ? dd / dt : null
    if (rate === null || t - this.start < warmupMs || total <= 0) return { etaSeconds: null, rate, elapsedSeconds }

    const raw = Math.max(0, (total - done) / rate)
    // Exponential smoothing; snap down immediately when nearly finished.
    this.smoothed = this.smoothed === null || raw < 5 ? raw : this.smoothed * 0.7 + raw * 0.3
    return { etaSeconds: Math.round(this.smoothed), rate, elapsedSeconds }
  }
}
