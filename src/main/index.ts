import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join, sep } from 'node:path'
import { setFfmpegPath } from '@core/media/ffmpeg'
import { LibraryController } from './controller'
import { registerIpc } from './ipc'
import { handleMediaProtocol, registerMediaScheme } from './protocol'
import { loadSettings, type StoredSettings } from './settings'

// Lets automated/end-to-end runs use an isolated settings folder instead of the real profile.
if (process.env.PHOTOVAULT_USER_DATA) app.setPath('userData', process.env.PHOTOVAULT_USER_DATA)

// Bundled ffmpeg (video thumbnails and playable copies). In the packaged app the binary lives outside the asar.
try {
  const bin = (require('ffmpeg-static') as string | null) ?? null
  setFfmpegPath(bin ? bin.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`) : null)
} catch {
  setFfmpegPath(null)
}

registerMediaScheme()

let mainWindow: BrowserWindow | null = null

const controller = new LibraryController({
  importProgress: (p) => mainWindow?.webContents.send('import:progress', p),
  libraryChanged: (reason) => mainWindow?.webContents.send('library:changed', reason),
  verifyProgress: (p) => mainWindow?.webContents.send('verify:progress', p),
  backupProgress: (p) => mainWindow?.webContents.send('backup:progress', p),
  smartSearchStatus: (s) => mainWindow?.webContents.send('smart:status', s),
  peopleStatus: (s) => mainWindow?.webContents.send('people:status', s)
})

function isDark(): boolean {
  return nativeTheme.shouldUseDarkColors
}

function applyTheme(s: StoredSettings): void {
  nativeTheme.themeSource = s.theme
  const dark = isDark()
  if (mainWindow && process.platform !== 'darwin') {
    mainWindow.setTitleBarOverlay?.({ color: '#00000000', symbolColor: dark ? '#e7e5e4' : '#292524', height: 44 })
  }
  mainWindow?.setBackgroundColor(dark ? '#0c0a09' : '#fafaf9')
}

function createWindow(): void {
  const settings = loadSettings()
  nativeTheme.themeSource = settings.theme
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: 'Photo Vault',
    backgroundColor: isDark() ? '#0c0a09' : '#fafaf9',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : { titleBarOverlay: { color: '#00000000', symbolColor: isDark() ? '#e7e5e4' : '#292524', height: 44 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // The renderer is a single-page app: no new windows, no navigation away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (!devUrl || !url.startsWith(devUrl)) event.preventDefault()
  })
  // Dropping files onto the window must never navigate to them.
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('app.photovault.desktop')
    const settings = loadSettings()
    if (settings.libraryPath) controller.tryOpen(settings.libraryPath)
    handleMediaProtocol(controller)
    registerIpc(controller, () => mainWindow, applyTheme)
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    controller.close()
  })
}
