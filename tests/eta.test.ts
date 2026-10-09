import { describe, expect, it } from 'vitest'
import { EtaEstimator } from '@core/eta'

function clock() {
  let t = 0
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('EtaEstimator', () => {
  it('withholds an estimate during warm-up, then reports remaining time from throughput', () => {
    const c = clock()
    const eta = new EtaEstimator({ now: c.now })
    expect(eta.update(0, 1000).etaSeconds).toBeNull()
    c.advance(1000)
    expect(eta.update(10, 1000).etaSeconds).toBeNull() // still warming up
    c.advance(3000)
    const e = eta.update(40, 1000) // 40 files in 4 s = 10/s, 960 left
    expect(e.rate).toBeCloseTo(10)
    expect(e.etaSeconds).toBe(96)
    expect(e.elapsedSeconds).toBe(4)
  })

  it('follows a speed change through its sliding window and smooths jumps', () => {
    const c = clock()
    const eta = new EtaEstimator({ now: c.now, windowMs: 10_000 })
    let done = 0
    for (let i = 0; i < 20; i++) {
      c.advance(1000)
      done += 10 // 10/s
      eta.update(done, 2000)
    }
    for (let i = 0; i < 20; i++) {
      c.advance(1000)
      done += 50 // speeds up to 50/s (e.g. cached hashes)
      eta.update(done, 2000)
    }
    const e = eta.update(done, 2000)
    expect(e.rate).toBeGreaterThan(45)
    expect(e.etaSeconds).toBeLessThan(Math.ceil((2000 - done) / 30))
  })

  it('has no estimate without a total (scanning) and reaches zero when done', () => {
    const c = clock()
    const eta = new EtaEstimator({ now: c.now })
    c.advance(5000)
    expect(eta.update(500, 0).etaSeconds).toBeNull()
    const done = new EtaEstimator({ now: c.now })
    done.update(0, 100)
    c.advance(5000)
    expect(done.update(100, 100).etaSeconds).toBe(0)
  })
})
