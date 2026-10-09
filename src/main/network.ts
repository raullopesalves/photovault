import { session } from 'electron'

/**
 * Offline mode: one switch that blocks every connection the app could make, as a guarantee rather than a
 * habit. When on, `fetch` in the main process (model downloads, the update token check) and in the worker
 * threads (AI model downloads, see worker.ts) fails, the window's own requests (OpenStreetMap tiles) are
 * cancelled, and updates are not checked. Models already downloaded keep working: they load from disk.
 */
export const OFFLINE_MESSAGE = 'Offline mode is on, so nothing is downloaded. Turn it off in Settings, or load the models from a folder (Settings → AI models).'

let offline = false
const listeners = new Set<(on: boolean) => void>()

export const isOffline = (): boolean => offline

export function setOffline(on: boolean): void {
  if (on === offline) return
  offline = on
  for (const l of listeners) l(on)
}

/** Called now and on every change. */
export function onOfflineChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener)
  listener(offline)
  return () => listeners.delete(listener)
}

const isLocal = (url: string): boolean => {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

/** Installs the guards once, at startup (after the app is ready). */
export function installNetworkGuards(): void {
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (offline && !isLocal(url)) return Promise.reject(new Error(OFFLINE_MESSAGE))
    return realFetch(input, init)
  }) as typeof fetch
  // The window: map tiles and anything else from the internet (the dev server on localhost stays reachable).
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) =>
    callback({ cancel: offline && !isLocal(details.url) })
  )
}
