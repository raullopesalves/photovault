import { app } from 'electron'
import { dirname, join, relative, isAbsolute } from 'node:path'
import type { PhoneCopyProgress } from '@shared/types'
import { copyFromPhone } from '@core/sources/phone'

let running: AbortController | null = null

const safe = (name: string): string => name.replace(/[<>:"/\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'Phone'

/**
 * Where a phone's photos are copied before the import: "PhotoVault phone copies\<device>" next to the library
 * (same drive, and outside it, because imports never read from inside the library). Kept afterwards, so the
 * next import from the same phone only copies what is new; it can be deleted once imported.
 */
export function phoneCopiesFolder(libraryRoot: string, device: string): string {
  let base = join(dirname(libraryRoot), 'PhotoVault phone copies')
  const rel = relative(libraryRoot, base)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) base = join(app.getPath('pictures'), 'PhotoVault phone copies')
  return join(base, safe(device))
}

export async function copyPhone(libraryRoot: string, device: string, onProgress: (p: PhoneCopyProgress) => void): Promise<PhoneCopyProgress> {
  if (running) throw new Error('A phone is already being copied.')
  running = new AbortController()
  try {
    return await copyFromPhone(device, phoneCopiesFolder(libraryRoot, device), { onProgress, signal: running.signal })
  } finally {
    running = null
  }
}

export function cancelPhoneCopy(): void {
  running?.abort()
}
