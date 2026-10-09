// Runs the opt-in 100k-item performance test (tests/perf.test.ts) with its timing table.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const vitest = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs')
const env = { ...process.env, PERF: '1' }
delete env.ELECTRON_RUN_AS_NODE
const r = spawnSync(process.execPath, [vitest, 'run', 'tests/perf.test.ts', '--silent=false', '--reporter=verbose'], { stdio: 'inherit', env })
process.exit(r.status ?? 1)
