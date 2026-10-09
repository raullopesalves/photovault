import type { Language } from '@shared/types'
import { PT } from './i18n-pt'

/**
 * Interface language. The English text is the key: t('Photos') returns the translation, or the English when
 * there is none, so a missing entry degrades to English instead of showing a code. `{name}` placeholders
 * are filled from `vars`. The language is set once before the app renders (changing it reloads the window),
 * so module-level labels can call t() too.
 */
let dict: Record<string, string> | null = null
let current: Language = 'en'

export function setLanguage(lang: Language): void {
  current = lang
  dict = lang === 'pt' ? PT : null
  document.documentElement.lang = lang === 'pt' ? 'pt-PT' : 'en'
}

export const language = (): Language => current

/** BCP 47 locale for dates and numbers. */
export const locale = (): string => (current === 'pt' ? 'pt-PT' : 'en-GB')

export function t(en: string, vars?: Record<string, string | number | null | undefined>): string {
  const s = dict?.[en] ?? en
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? '') : m)) : s
}
