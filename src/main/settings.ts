import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings, ThemePreference } from '@shared/types'

/** App-level settings (not library data) stored in the OS user-data folder. */
export interface StoredSettings extends Settings {
  libraryPath: string | null
}

const DEFAULTS: StoredSettings = { theme: 'system', libraryPath: null }

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): StoredSettings {
  try {
    if (!existsSync(file())) return { ...DEFAULTS }
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as Partial<StoredSettings>
    const theme: ThemePreference = parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system'
    return { theme, libraryPath: typeof parsed.libraryPath === 'string' ? parsed.libraryPath : null }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: StoredSettings): void {
  const f = file()
  mkdirSync(dirname(f), { recursive: true })
  const tmp = `${f}.tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 2))
  renameSync(tmp, f)
}
