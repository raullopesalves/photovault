import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStatus } from '@shared/types'
import { isOffline } from './network'

/**
 * Auto-update from the private GitHub repository's Releases (electron-updater). The app needs a read-only
 * GitHub token to see a private repo; the user pastes one in Settings and it is stored encrypted with the OS
 * key store (DPAPI on Windows). Checks shortly after start and every 6 hours, downloads in the background and
 * installs on quit (or "Restart now"). Only the installed (NSIS) build can update itself.
 */
const OWNER = 'raullopesalves'
const REPO = 'photovault'

let status: UpdateStatus = { state: 'idle', version: app.getVersion(), tokenSet: false, canUpdate: false }
let notify: (s: UpdateStatus) => void = () => undefined
let timer: ReturnType<typeof setInterval> | null = null
let started = false

const tokenFile = (): string => join(app.getPath('userData'), 'update-token.bin')

function readToken(): string | null {
  try {
    if (!existsSync(tokenFile()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(tokenFile()))
  } catch {
    return null
  }
}

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  notify({ ...status })
}

/** Installed builds only: the portable exe and development runs cannot replace themselves. */
function canSelfUpdate(): boolean {
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR
}

async function updater(): Promise<typeof import('electron-updater').autoUpdater> {
  return (await import('electron-updater')).autoUpdater
}

export function updateStatus(): UpdateStatus {
  return { ...status, tokenSet: !!readToken(), canUpdate: canSelfUpdate() }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const token = readToken()
  if (!canSelfUpdate()) return updateStatus()
  if (isOffline()) {
    set({ state: 'offline' })
    return updateStatus()
  }
  if (!token) {
    set({ state: 'needs-token' })
    return updateStatus()
  }
  try {
    const u = await updater()
    u.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO, private: true, token })
    set({ state: 'checking', error: undefined })
    await u.checkForUpdates()
  } catch (err) {
    set({ state: 'error', error: err instanceof Error ? err.message.split('\n')[0] : String(err) })
  }
  return updateStatus()
}

export async function startUpdater(onStatus: (s: UpdateStatus) => void): Promise<void> {
  notify = onStatus
  status = updateStatus()
  if (started || !canSelfUpdate()) return
  started = true
  const u = await updater()
  u.autoDownload = true
  u.autoInstallOnAppQuit = true
  u.on('update-available', (info) => set({ state: 'downloading', available: info.version, percent: 0 }))
  u.on('update-not-available', () => set({ state: 'up-to-date', checkedAt: new Date().toISOString() }))
  u.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  u.on('update-downloaded', (info) => set({ state: 'ready', available: info.version }))
  u.on('error', (err) => set({ state: 'error', error: err.message.split('\n')[0] }))
  setTimeout(() => void checkForUpdates(), 30_000)
  timer = setInterval(() => void checkForUpdates(), 6 * 3600_000)
}

/** Saves (or clears) the token after checking it can read the repository. */
export async function setUpdateToken(token: string | null): Promise<UpdateStatus> {
  if (!token) {
    rmSync(tokenFile(), { force: true })
    set({ state: 'needs-token' })
    return updateStatus()
  }
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: { authorization: `token ${token}`, 'user-agent': 'PhotoVault' } })
  if (!res.ok) throw new Error(res.status === 401 ? 'GitHub did not accept this token.' : `The token cannot read ${OWNER}/${REPO} (HTTP ${res.status}).`)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer.')
  writeFileSync(tokenFile(), safeStorage.encryptString(token.trim()))
  void checkForUpdates()
  return updateStatus()
}

export async function installUpdateNow(): Promise<void> {
  if (status.state !== 'ready') return
  ;(await updater()).quitAndInstall(false, true)
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer)
}
