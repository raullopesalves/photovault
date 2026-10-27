// Runs the update check inside the packaged app (dist/win-unpacked, which electron-builder leaves next to the
// installer) with a throwaway profile, and fails unless it reaches GitHub. Development runs never load the updater
// (only installed builds update themselves), so this is the one place a broken updater shows before release.
// Usage: node scripts/check-packaged-updater.mjs   (scripts/release.mjs runs it before publishing)
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const profile = mkdtempSync(join(tmpdir(), 'pv-updater-'))
const env = { ...process.env, PHOTOVAULT_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('dist/win-unpacked/Photo Vault.exe'), args: [], env })
let status
try {
  const page = await app.firstWindow()
  await page.waitForSelector('text=Your photos, permanently yours.', { timeout: 60_000 })
  status = await page.evaluate(() => window.photoVault.checkForUpdates())
  for (let i = 0; i < 30 && (status.state === 'checking' || status.state === 'idle'); i++) {
    await page.waitForTimeout(1000)
    status = await page.evaluate(() => window.photoVault.updateStatus())
  }
} finally {
  await app.close()
  rmSync(profile, { recursive: true, force: true })
}
console.log('packaged update check:', status.state, status.error ?? status.available ?? '')
if (!['up-to-date', 'downloading', 'ready'].includes(status.state)) process.exit(1)
