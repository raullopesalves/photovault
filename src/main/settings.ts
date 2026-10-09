import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Language, Settings, ThemePreference } from '@shared/types'

/** App-level settings (not library data) stored in the OS user-data folder. */
export interface StoredSettings extends Omit<Settings, 'language'> {
  libraryPath: string | null
  /** Unset until chosen: follows the system language. */
  language?: Language
}

const DEFAULTS: StoredSettings = { theme: 'system', libraryPath: null }

/** The chosen language, or Portuguese when Windows is in Portuguese. */
export function languageOf(s: StoredSettings): Language {
  return s.language ?? (app.getLocale().toLowerCase().startsWith('pt') ? 'pt' : 'en')
}

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): StoredSettings {
  try {
    if (!existsSync(file())) return { ...DEFAULTS }
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as Partial<StoredSettings>
    const theme: ThemePreference = parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system'
    const language = parsed.language === 'en' || parsed.language === 'pt' ? parsed.language : undefined
    return { theme, libraryPath: typeof parsed.libraryPath === 'string' ? parsed.libraryPath : null, language }
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
