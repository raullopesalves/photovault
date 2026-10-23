// End-to-end smoke test: launches the built app (npm run build first) against a throwaway
// library + photo folder and walks the vertical slice:
//   import -> grid -> lightbox -> re-import (all duplicates) -> renamed copy (exact duplicate).
// Usage: node scripts/e2e-smoke.mjs [screenshotDir] [--packaged]
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, cpSync, readdirSync, readFileSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const electronPath = require('electron')

const args = process.argv.slice(2)
const shots = resolve(args.find((a) => !a.startsWith('--')) ?? join(tmpdir(), 'photovault-e2e-shots'))
// --packaged tests dist/win-unpacked/Photo Vault.exe (built by `electron-builder --dir`) instead of the dev bundle.
if (args.includes('--packaged') && !process.env.PV_EXE) process.env.PV_EXE = resolve('dist/win-unpacked/Photo Vault.exe')
mkdirSync(shots, { recursive: true })
// The full path, as the app shows it: CI runners' temp folder is an 8.3 short name (C:\Users\RUNNER~1\…).
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'photovault-e2e-')))
const photos = join(root, 'My Photos')
const userData = join(root, 'userdata')
mkdirSync(userData, { recursive: true })

function scene(i) {
  const hue = (i * 47) % 360
  const sun = 20 + ((i * 13) % 60)
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${hue},70%,62%)"/><stop offset="0.62" stop-color="hsl(${(hue + 40) % 360},80%,78%)"/>
      <stop offset="0.62" stop-color="hsl(${(hue + 180) % 360},35%,32%)"/><stop offset="1" stop-color="hsl(${(hue + 200) % 360},40%,18%)"/>
    </linearGradient></defs>
    <rect width="1600" height="1067" fill="url(#g)"/>
    <circle cx="${200 + ((i * 97) % 1200)}" cy="${380 - sun * 3}" r="${70 + (i % 5) * 18}" fill="hsl(${(hue + 60) % 360},95%,88%)" opacity="0.9"/>
    <path d="M0 700 L ${300 + (i % 7) * 60} ${470 + (i % 3) * 40} L 900 700 L 1250 ${520 + (i % 4) * 30} L 1600 700 L 1600 1067 L 0 1067Z" fill="hsl(${(hue + 190) % 360},30%,24%)" opacity="0.8"/>
  </svg>`)
}

async function makePhoto(path, i, exif) {
  let img = sharp(scene(i)).jpeg({ quality: 86 })
  if (exif) img = img.withExif(exif)
  await img.toFile(path)
}

// --- fixture folder -------------------------------------------------------
mkdirSync(join(photos, '2023 Summer'), { recursive: true })
mkdirSync(join(photos, 'Phone backup'), { recursive: true })
for (let i = 0; i < 18; i++) {
  const month = String(6 + (i % 3)).padStart(2, '0')
  const day = String(1 + ((i * 3) % 27)).padStart(2, '0')
  await makePhoto(join(photos, '2023 Summer', `IMG_${4800 + i}.jpg`), i, {
    IFD0: { Make: i % 2 ? 'Apple' : 'FUJIFILM', Model: i % 2 ? 'iPhone 14 Pro' : 'X-T4' },
    IFD2: { DateTimeOriginal: `2023:${month}:${day} ${String(8 + (i % 10)).padStart(2, '0')}:15:00`, FNumber: '28/10', ExposureTime: '1/500', ISOSpeedRatings: '100' },
    ...(i % 3 === 0 ? { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '46/1 33/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '7/1 58/1 0/1' } } : {})
  })
}
for (let i = 18; i < 26; i++) {
  await makePhoto(join(photos, 'Phone backup', `PXL_2024${String(1 + (i % 9)).padStart(2, '0')}12_1${i % 10}3000123.jpg`), i)
}
await sharp(scene(40)).png().toFile(join(photos, 'scan-no-metadata.png'))
// Same photo twice inside the source folder (renamed) and a same-name/different-content pair.
copyFileSync(join(photos, '2023 Summer', 'IMG_4801.jpg'), join(photos, 'Phone backup', 'holiday favourite.jpg'))
writeFileSync(join(photos, 'notes.txt'), 'not a photo')
writeFileSync(join(photos, 'IMG_4801.jpg.json'), '{"title":"sidecar"}')

// --- library ---------------------------------------------------------------
const libraryDir = join(root, 'Library')
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: process.env.THEME ?? 'light', libraryPath: null }))
// PV_MODELS=<folder with the downloaded CLIP model> also tests smart search (without downloading).
if (process.env.PV_MODELS) cpSync(process.env.PV_MODELS, join(userData, 'models'), { recursive: true })
// PV_FACE=<a photo with one clear face> also tests People; PV_FACE_MODELS=<folder with the two face models> skips their download.
if (process.env.PV_FACE_MODELS) cpSync(process.env.PV_FACE_MODELS, join(userData, 'models', 'faces'), { recursive: true })
const watchAdds = 2 + (process.env.PV_HEIC ? 1 : 0) + (process.env.PV_FACE ? 1 : 0)

// Editors such as VS Code export ELECTRON_RUN_AS_NODE=1, which would start Electron as plain Node.
// PHOTOVAULT_TEST_HOOKS turns on the deliberate crash triggers used by the crash-recovery section.
const env = { ...process.env, PHOTOVAULT_USER_DATA: userData, PHOTOVAULT_TEST_HOOKS: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
// PV_EXE=<path to packaged Photo Vault.exe> tests the shipped build instead of the dev bundle.
const app = process.env.PV_EXE
  ? await electron.launch({ executablePath: process.env.PV_EXE, args: [], env })
  : await electron.launch({ executablePath: electronPath, args: ['.'], env })
const errors = []
const page = await app.firstWindow()
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.setViewportSize({ width: 1360, height: 880 }).catch(() => {})
await page.waitForSelector('text=Your photos, permanently yours.')
await page.screenshot({ path: join(shots, '01-welcome.png') })

// Create the library through the main process (the native folder dialog can't be automated).
await app.evaluate(async ({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, libraryDir)
await page.click('text=Create a library')
await page.waitForSelector('text=Start your archive')
await page.screenshot({ path: join(shots, '02-empty-library.png') })

// Places that left the sidebar: past imports open from the Import menu, Duplicates and Hidden from Tidy up,
// Safety from the status card.
async function openImports() {
  await page.click('aside button[aria-haspopup="menu"]')
  await page.click('text=Past imports')
}
async function openFromTidyUp(card) {
  await page.click('nav >> text=Tidy up')
  await page.getByRole('button', { name: new RegExp(`^${card}`) }).click()
}
async function openSafety() {
  await page.click('aside button[aria-label^="Safety"]')
}

async function importFolder(folder, label, kind = 'folder') {
  const paths = Array.isArray(folder) ? folder : [folder]
  await app.evaluate(async ({ dialog }, list) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: list })
  }, paths)
  await page.click('aside button[aria-haspopup="menu"]')
  await page.click(kind === 'zip' ? 'text=ZIP archives…' : 'text=Folder…')
  await page.waitForSelector('text=/Import ready|Already in your library/', { timeout: 60000 })
  await page.screenshot({ path: join(shots, `${label}-summary.png`) })
  const summary = await page.evaluate(() => window.photoVault.currentImport())
  await page.click('[data-testid=import-confirm]')
  await page.waitForSelector('text=View photos', { timeout: 120000 })
  await page.screenshot({ path: join(shots, `${label}-done.png`) })
  await page.click('text=View photos')
  return summary.summary
}

const first = await importFolder(photos, '03-first-import')
console.log('first import:', { new: first.newAssets, dupLib: first.duplicatesLibrary, dupBatch: first.duplicatesBatch, ignored: first.ignoredFound, sidecars: first.sidecarsFound })

// wait for thumbnails
for (let i = 0; i < 100; i++) {
  const s = await page.evaluate(() => window.photoVault.getState())
  if (s.kind === 'ready' && s.library.pendingThumbnails === 0) break
  await page.waitForTimeout(200)
}
await page.waitForTimeout(800)
await page.screenshot({ path: join(shots, '04-grid.png') })
await page.locator('main .overflow-y-auto').first().evaluate((el) => el.scrollTo(0, el.scrollHeight))
await page.waitForTimeout(700)
await page.screenshot({ path: join(shots, '04b-grid-scrolled.png') })
console.log('layout:', await page.evaluate(() => {
  const el = document.querySelector('main .overflow-y-auto')
  const tile = document.querySelector('main [aria-pressed]')
  return { inner: window.innerWidth, scroll: el?.clientWidth, tile: tile?.getBoundingClientRect().width }
}))
await page.locator('main .overflow-y-auto').first().evaluate((el) => el.scrollTo(0, 0))

await page.locator('main [aria-pressed]').first().click()
await page.waitForTimeout(600)
if (!(await page.locator('text=Found in').count())) await page.keyboard.press('i')
await page.waitForSelector('text=SHA-256')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '05-lightbox.png') })

// Navigation both ways.
const shownSrc = () => page.locator('img[alt]:not([alt=""])').first().getAttribute('src')
const firstSrc = await shownSrc()
await page.click('button[aria-label="Next"]')
await page.waitForFunction((src) => document.querySelector('img[alt]:not([alt=""])')?.getAttribute('src') !== src, firstSrc)
await page.click('button[aria-label="Previous"]')
await page.waitForFunction((src) => document.querySelector('img[alt]:not([alt=""])')?.getAttribute('src') === src, firstSrc)
const navOk = (await shownSrc()) === firstSrc

// Zoom: wheel towards the cursor, then double-click back to fit.
await page.waitForTimeout(400)
const box = await page.locator('img[alt]:not([alt=""])').first().boundingBox()
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
await page.mouse.wheel(0, -600)
await page.waitForSelector('text=/^\\d+%$/')
await page.waitForTimeout(300)
await page.screenshot({ path: join(shots, '05b-lightbox-zoomed.png') })
const zoomLabel = await page.locator('button[title="Fit to screen (0)"]').textContent()
await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForSelector('button[title="Fit to screen (0)"]:has-text("Fit")')
console.log('viewer:', { navOk, zoomLabel })
await page.keyboard.press('Escape')

const second = await importFolder(photos, '06-reimport')
console.log('re-import:', { new: second.newAssets, dupLib: second.duplicatesLibrary, dupBatch: second.duplicatesBatch })

const other = join(root, 'Old HDD')
mkdirSync(other)
copyFileSync(join(photos, '2023 Summer', 'IMG_4805.jpg'), join(other, 'renamed copy.jpg'))
const third = await importFolder(other, '07-renamed-copy')
console.log('renamed copy:', { new: third.newAssets, dupLib: third.duplicatesLibrary })

// --- Google Takeout split over two ZIP volumes ---------------------------------
const { ZipFile } = require('yazl')
async function zip(path, entries) {
  const z = new ZipFile()
  for (const [name, data] of entries) z.addBuffer(data, name, { mtime: new Date('2024-05-01T10:00:00Z') })
  z.end()
  const chunks = []
  for await (const c of z.outputStream) chunks.push(c)
  writeFileSync(path, Buffer.concat(chunks))
  return path
}
const GP = 'Takeout/Google Photos'
const tk = (i) => ({ title: `PXL_${i}.jpg`, description: i === 0 ? 'Sunset over the lake' : '', favorited: i === 0, photoTakenTime: { timestamp: String(1650000000 + i * 86400 * 40) }, geoData: { latitude: 46.2 + i / 100, longitude: 6.1, altitude: 0 } })
const takeoutJpg = async (i) => sharp(scene(60 + i)).jpeg({ quality: 85 }).toBuffer()
const vol1 = [], vol2 = []
for (let i = 0; i < 6; i++) {
  const img = await takeoutJpg(i)
  ;(i % 2 ? vol2 : vol1).push([`${GP}/Photos from 2022/PXL_${i}.jpg`, img])
  vol1.push([`${GP}/Photos from 2022/PXL_${i}.jpg.supplemental-metadata.json`, Buffer.from(JSON.stringify(tk(i)))])
  if (i < 2) vol2.push([`${GP}/Lake Weekend/PXL_${i}.jpg`, img])
}
vol2.push([`${GP}/Lake Weekend/metadata.json`, Buffer.from(JSON.stringify({ title: 'Lake Weekend' }))])
// one photo that is already in the library from the first folder import
vol2.push([`${GP}/Photos from 2023/IMG_4801.jpg`, readFileSync(join(photos, '2023 Summer', 'IMG_4801.jpg'))])
const zips = [await zip(join(root, 'takeout-001.zip'), vol1), await zip(join(root, 'takeout-002.zip'), vol2)]
const tko = await importFolder(zips, '07b-takeout', 'zip')
console.log('takeout:', { type: tko.sourceType, new: tko.newAssets, dupLib: tko.duplicatesLibrary, dupBatch: tko.duplicatesBatch, matched: tko.sidecarsMatched, archives: tko.archivesFound })
await page.waitForTimeout(800)
await page.screenshot({ path: join(shots, '07c-grid-after-takeout.png') })

// Open the favourited Takeout photo (newest asset with a description) in the lightbox.
const takeoutAsset = await page.evaluate(async () => {
  const groups = await window.photoVault.timeline()
  const total = groups.reduce((s, g) => s + g.count, 0)
  const page = await window.photoVault.assetsPage(0, total)
  for (const a of page) {
    const d = await window.photoVault.asset(a.id)
    if (d.description) return { id: d.id, source: d.captureTimeSource, fav: d.favorite, lat: d.latitude, albums: d.sources.map((s) => s.album) }
  }
  return null
})
console.log('takeout asset:', takeoutAsset)

// Re-import the Takeout: everything recognised, hashes reused.
const tko2 = await importFolder(zips, '07d-takeout-again', 'zip')
console.log('takeout again:', { new: tko2.newAssets, dupLib: tko2.duplicatesLibrary, reused: tko2.hashesReused })

// --- Milestone 4: selection, albums, search, favourites --------------------------
await page.click('nav >> text=Photos')
await page.waitForTimeout(600)
const selects = page.locator('main [aria-label="Select"]')
await selects.nth(0).click({ force: true })
await selects.nth(1).click({ force: true })
await selects.nth(2).click({ force: true })
await page.waitForSelector('text=3 selected')
await page.screenshot({ path: join(shots, '11-selection.png') })
await page.click('text=Add to album')
await page.click('text=New album…')
await page.fill('input[placeholder="Album name"]', 'Best of 2024')
await page.keyboard.press('Enter')
await page.waitForSelector('text=Created “Best of 2024”')
await page.waitForTimeout(1400)
await page.click('nav >> text=Albums')
await page.waitForSelector('text=Best of 2024')
await page.waitForSelector('text=Lake Weekend')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '12-albums.png') })
const albums = await page.evaluate(() => window.photoVault.albums())
console.log('albums:', albums.map((a) => `${a.name} (${a.kind}, ${a.count})`))
await page.click('text=Best of 2024')
await page.waitForSelector('text=Add a description')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '13-album-detail.png') })

await page.click('nav >> text=Photos')
await page.fill('input[role="combobox"]', 'PXL')
await page.keyboard.press('Escape')
await page.waitForSelector('text=/^\\d+ items?$/')
await page.waitForTimeout(800)
await page.screenshot({ path: join(shots, '14-search.png') })
const searchCount = await page.evaluate(async () => (await window.photoVault.timeline({ text: 'PXL' })).reduce((s, g) => s + g.count, 0))
console.log('search PXL:', searchCount)

await page.click('nav >> text=Favourites')
await page.waitForTimeout(600)
const favCount = await page.evaluate(async () => (await window.photoVault.timeline({ favorite: true })).reduce((s, g) => s + g.count, 0))
console.log('favourites:', favCount)
await page.screenshot({ path: join(shots, '15-favourites.png') })

// --- Cleanup: WhatsApp clutter ----------------------------------------------------
function silentMp4(seconds) {
  const box = (type, ...parts) => {
    const body = Buffer.concat(parts)
    const h = Buffer.alloc(8)
    h.writeUInt32BE(8 + body.length, 0)
    h.write(type, 4, 'latin1')
    return Buffer.concat([h, body])
  }
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(Math.floor(Date.UTC(2024, 2, 3) / 1000) + 2082844800, 4)
  mvhd.writeUInt32BE(1000, 12)
  mvhd.writeUInt32BE(seconds * 1000, 16)
  const tkhd = Buffer.alloc(84)
  tkhd.writeUInt32BE(480 * 65536, 76)
  tkhd.writeUInt32BE(480 * 65536, 80)
  const hdlr = Buffer.alloc(24)
  hdlr.write('vide', 8, 'latin1')
  return Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\x02\0isommp41', 'latin1')),
    box('mdat', Buffer.alloc(2048, 3)),
    box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd), box('mdia', box('hdlr', hdlr))))
  ])
}
const phone = join(root, 'Phone backup')
const waImages = join(phone, 'WhatsApp', 'Media', 'WhatsApp Images')
const waGifs = join(phone, 'WhatsApp', 'Media', 'WhatsApp Animated Gifs')
mkdirSync(waImages, { recursive: true })
mkdirSync(waGifs, { recursive: true })
for (let i = 0; i < 3; i++) await makePhoto(join(waImages, `IMG-2024031${i}-WA000${i}.jpg`), 80 + i)
writeFileSync(join(waGifs, 'VID-20240313-WA0004.mp4'), silentMp4(4))
// A WhatsApp-recompressed copy of a summer photo: different bytes, same picture → probable duplicate.
await sharp(join(photos, '2023 Summer', 'IMG_4806.jpg')).resize(1200).jpeg({ quality: 55 }).toFile(join(waImages, 'IMG-20240314-WA0009.jpg'))
await importFolder(phone, '16-whatsapp-import')

// --- Probable duplicates -----------------------------------------------------------
for (let i = 0; i < 150; i++) {
  const nd = await page.evaluate(() => window.photoVault.nearDuplicates(0, 5))
  if (nd.hashable > 0 && nd.hashed >= nd.hashable && nd.totalGroups > 0) break
  await page.waitForTimeout(200)
}
await openFromTidyUp('Probable duplicates')
await page.waitForSelector('text=Looks the same')
await page.waitForTimeout(600)
await page.screenshot({ path: join(shots, '16b-probable-duplicates.png') })
const near = await page.evaluate(() => window.photoVault.nearDuplicates(0, 5))
console.log('probable duplicates:', { groups: near.totalGroups, members: near.groups[0]?.members.map((m) => m.originalFilename), best: near.groups[0]?.bestReason })
await page.click('button:has-text("Keep selected, hide the other")')
await page.waitForSelector('text=/reviewed/')
const nearAfter = await page.evaluate(() => window.photoVault.nearDuplicates(0, 5))
await page.click('nav >> text=Tidy up')
await page.waitForSelector('main >> text=WhatsApp', { timeout: 30000 })
await page.waitForSelector('main >> text=GIF-like loops', { timeout: 30000 })
await page.waitForTimeout(1000)
await page.screenshot({ path: join(shots, '17-cleanup.png') })
const visibleBefore = await page.evaluate(async () => (await window.photoVault.timeline({ hidden: 'exclude' })).reduce((s, g) => s + g.count, 0))
await page.click('main button:has-text("WhatsApp")')
await page.click('text=Hide all from Photos')
await page.click('button:has-text("Hide from Photos")')
await page.waitForSelector('text=/5 of 5 hidden/')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '18-cleanup-whatsapp-hidden.png') })
const visibleAfter = await page.evaluate(async () => (await window.photoVault.timeline({ hidden: 'exclude' })).reduce((s, g) => s + g.count, 0))
const waAsset = await page.evaluate(async () => {
  const [a] = await window.photoVault.assetsPage(0, 1, { kind: 'loop' })
  return a ? window.photoVault.asset(a.id) : null
})
console.log('cleanup:', { visibleBefore, visibleAfter, loopOrigin: waAsset?.origin, loopEvidence: waAsset?.kindEvidence })

// --- Multi-select filters with badges, and the hover favourite -----------------------
await page.click('nav >> text=Photos')
await page.click('button:has-text("Filters")')
const yearItems = page.locator('[role="dialog"] section:has-text("Year") [role="menuitemcheckbox"]')
await yearItems.nth(0).click()
await yearItems.nth(1).click()
await page.keyboard.press('Escape')
await page.waitForSelector('button[aria-label="Remove filter"]')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '19-filters-badges.png') })
const badgeCount = await page.locator('button[aria-label="Remove filter"]').count()
await page.locator('button[aria-label="Remove filter"]').first().click()
await page.waitForTimeout(300)
const badgeCountAfter = await page.locator('button[aria-label="Remove filter"]').count()
await page.locator('button[aria-label="Remove filter"]').first().click()
await page.waitForTimeout(300)
console.log('filters:', { badgeCount, badgeCountAfter })

// --- "No date" section and manual dates --------------------------------------------
const undatedBefore = await page.evaluate(async () => (await window.photoVault.timeline()).find((g) => g.month === 'undated')?.count ?? 0)
await page.locator('main .overflow-y-auto').first().evaluate((el) => el.scrollTo(0, el.scrollHeight))
await page.waitForSelector('text=No date')
await page.waitForTimeout(600)
await page.screenshot({ path: join(shots, '21-no-date.png') })
await page.locator('main [aria-label="Select"]').last().click({ force: true })
await page.click('button[aria-label="More actions"]')
await page.click('button:has-text("Set date…")')
await page.fill('input[type="date"]', '2019-12-24')
await page.click('[role="button"]:has-text("Set date"), button:has-text("Set date") >> nth=-1')
await page.waitForSelector('text=/Date set for 1 item/')
await page.waitForTimeout(1300)
const undatedAfter = await page.evaluate(async () => (await window.photoVault.timeline()).find((g) => g.month === 'undated')?.count ?? 0)
const dec2019 = await page.evaluate(async () => (await window.photoVault.timeline()).find((g) => g.month === '2019-12')?.count ?? 0)
console.log('dates:', { undatedBefore, undatedAfter, dec2019 })
await page.locator('main .overflow-y-auto').first().evaluate((el) => el.scrollTo(0, 0))
await page.waitForTimeout(300)

const favBefore = await page.evaluate(async () => (await window.photoVault.timeline({ favorite: true })).reduce((s, g) => s + g.count, 0))
const tile = page.locator('main [aria-pressed]').nth(3)
await tile.hover()
await tile.locator('button[aria-label="Add to favourites"]').click()
await page.waitForTimeout(600)
await page.screenshot({ path: join(shots, '20-hover-favourite.png') })
const favAfter = await page.evaluate(async () => (await window.photoVault.timeline({ favorite: true })).reduce((s, g) => s + g.count, 0))
console.log('hover favourite:', { favBefore, favAfter })

// --- Bulk selection: shift-click range, whole month, Ctrl+A ------------------------------
await page.click('nav >> text=Photos')
await page.waitForTimeout(500)
// The hover step scrolled the grid; start from the top so the first tile is not under the sticky header.
await page.locator('main .scroll-page').first().evaluate((el) => el.scrollTo(0, 0))
await page.waitForTimeout(300)
const tiles = page.locator('main [aria-pressed]')
await page.locator('main [aria-label="Select"]').nth(0).click({ force: true })
await tiles.nth(3).click({ modifiers: ['Shift'] })
await page.waitForSelector('text=4 selected')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '22-shift-range.png') })
await page.keyboard.press('Escape')
await page.locator('main [aria-label="Select this month"]').nth(1).click({ force: true })
await page.waitForSelector('text=/\\d+ selected/')
const monthSelected = await page.locator('text=/\\d+ selected/').textContent()
await page.keyboard.press('Escape')
await page.keyboard.press('Control+a')
await page.waitForSelector('text=/\\d+ selected/')
const allSelected = await page.locator('text=/\\d+ selected/').textContent()
await page.keyboard.press('Escape')
const visibleTotal = await page.evaluate(async () => (await window.photoVault.timeline({ hidden: 'exclude' })).reduce((s, g) => s + g.count, 0))
console.log('selection:', { monthSelected, allSelected, visibleTotal })

// --- Bin: move, undo toast, restore, delete permanently -----------------------------------
await page.locator('main .scroll-page').first().evaluate((el) => el.scrollTo(0, 0))
await page.waitForTimeout(300)
await page.locator('main [aria-label="Select"]').nth(0).click({ force: true })
await page.locator('main [aria-label="Select"]').nth(1).click({ force: true })
await page.click('button:has-text("Bin") >> nth=-1')
await page.waitForSelector('text=Undo')
await page.waitForTimeout(5500)
const afterBin = await page.evaluate(() => window.photoVault.getState())
await page.click('nav >> text=Bin')
await page.waitForSelector('text=Empty Bin')
await page.waitForTimeout(400)
await page.screenshot({ path: join(shots, '23-bin.png') })
await page.locator('main [aria-label="Select"]').nth(0).click({ force: true })
await page.click('button:has-text("Restore") >> nth=-1')
await page.waitForTimeout(600)
await page.click('text=Empty Bin')
await page.check('input[type="checkbox"]') // skip the OS recycle bin in tests
await page.screenshot({ path: join(shots, '24-bin-delete-confirm.png') })
await page.click('button:has-text("Delete 1 item")')
await page.waitForSelector('text=1 item deleted')
await page.click('button:has-text("Done")')
await page.waitForTimeout(500)
const afterDelete = await page.evaluate(() => window.photoVault.getState())
console.log('bin:', { binAfterMove: afterBin.library.binCount, binAfterDelete: afterDelete.library.binCount, deleted: afterDelete.library.deletedCount, assets: afterDelete.library.assetCount })

await openFromTidyUp('Hidden')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '25-hidden.png') })
const hiddenItems = await page.evaluate(async () => (await window.photoVault.timeline({ hidden: 'only' })).reduce((s, g) => s + g.count, 0))
console.log('hidden view items:', hiddenItems, 'library says', afterDelete.library.hiddenCount)

await openSafety()
// --- Backup to a second location ------------------------------------------------------------
const backupDir = join(root, 'Backup drive')
mkdirSync(backupDir)
await app.evaluate(async ({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, backupDir)
await page.click('text=Add backup location')
await page.waitForSelector('text=/All \\d+ items have a verified second copy/', { timeout: 60000 })
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '26-backup.png') })
const backup = await page.evaluate(() => window.photoVault.backupStatus())
console.log('backup:', { total: backup.totalAssets, protected: backup.protectedAssets, files: backup.targets[0]?.filesBackedUp })
// The app's own monthly check starts a minute after a library first opens, so on a slow machine one may already be
// running ("Stop") or done ("Verify again").
const verifyButton = page.locator('main button:has-text("Verify library"), main button:has-text("Verify again")')
if (await verifyButton.count()) await verifyButton.first().click()
await page.waitForSelector('text=/verified intact/', { timeout: 60000 })
await page.screenshot({ path: join(shots, '10-verify.png') })

await openFromTidyUp('Probable duplicates')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '08-duplicates.png') })
await openImports()
await page.waitForTimeout(400)
await page.screenshot({ path: join(shots, '09-imports.png') })

// --- 0.7: similar photos, recently added, rotate, export, map, watched folder, smart search -------
await openFromTidyUp('Similar photos')
await page.waitForTimeout(600)
await page.screenshot({ path: join(shots, '27-similar.png') })

await page.click('nav >> text=Photos')
await page.waitForTimeout(500)
await page.click('button:has-text("Date taken")')
await page.waitForSelector('text=/^Added /')
await page.screenshot({ path: join(shots, '28-recently-added.png') })
await page.click('button:has-text("Recently added")')
await page.waitForTimeout(500)

await app.evaluate(async ({ shell }) => {
  shell.openPath = async () => '' // don't open Explorer windows during the test
})
const exportDir = join(root, 'Export')
await app.evaluate(async ({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, exportDir)
await page.locator('main [aria-label="Select"]').nth(0).click({ force: true })
await page.locator('main [aria-label="Select"]').nth(1).click({ force: true })
const rotatedId = await page.evaluate(async () => (await window.photoVault.assetsPage(0, 1, { hidden: 'exclude' }))[0].id)
await page.click('button[aria-label="More actions"]')
await page.locator('button:has-text("Rotate"):visible').last().click()
await page.waitForSelector('text=/2 items rotated/')
await page.waitForTimeout(1300)
const rotation = await page.evaluate(async (id) => (await window.photoVault.asset(id)).rotation, rotatedId)
await page.locator('main [aria-label="Select"]').nth(0).click({ force: true })
await page.locator('main [aria-label="Select"]').nth(1).click({ force: true })
await page.click('button[aria-label="More actions"]')
await page.click('button:has-text("Export originals…")')
await page.waitForSelector('text=/2 files exported/', { timeout: 30000 })
const exported = readdirSync(exportDir).length
await page.waitForTimeout(1300)
await page.screenshot({ path: join(shots, '29-rotated.png') })

await page.click('nav >> text=Places')
await page.waitForSelector('.pv-pin', { timeout: 15000 })
await page.waitForTimeout(800)
const pins = await page.locator('.pv-pin').count()
await page.screenshot({ path: join(shots, '30-map.png') })

const watchDir = join(root, 'Phone sync')
mkdirSync(watchDir)
await makePhoto(join(watchDir, 'PXL_20250101_120000000.jpg'), 77)
// PV_HEIC=<an iPhone .HEIC file> also checks HEIC decoding (thumbnail) in this build.
if (process.env.PV_HEIC) copyFileSync(process.env.PV_HEIC, join(watchDir, 'IMG_HEIC_TEST.HEIC'))
if (process.env.PV_FACE) copyFileSync(process.env.PV_FACE, join(watchDir, 'FACE_TEST.jpg'))
// An old MPEG-4 Part 2 video, which Chromium cannot play: the viewer must fall back to a converted copy.
execFileSync(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=2', '-c:v', 'mpeg4', join(watchDir, 'OLDCAM_clip.mp4')])
await app.evaluate(async ({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, watchDir)
await openImports()
await page.click('button:has-text("Watch a folder")')
await page.waitForSelector(`text=${watchDir}`)
await page.click('button:has-text("Check now")')
await page.waitForSelector(`text=/last automatic import added ${watchAdds}/`, { timeout: 60000 }).catch(async (err) => {
  console.log('watch debug:', await page.evaluate(() => window.photoVault.watchFolders()), await page.evaluate(() => window.photoVault.currentImport()))
  throw err
})
await page.screenshot({ path: join(shots, '31-watched.png') })

let smartIds = null
if (process.env.PV_MODELS) {
  await page.evaluate(() => window.photoVault.setSmartSearch(true))
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => window.photoVault.smartSearchStatus())
    if (st.phase === 'ready' || st.phase === 'error') {
      console.log('smart search:', st)
      break
    }
    await page.waitForTimeout(1000)
  }
  smartIds = await page.evaluate(() => window.photoVault.smartSearch('mountains at sunset'))
}
// Automatic descriptions, when the models folder also has Florence-2 (no download in the test).
let captions = null
if (process.env.PV_MODELS && existsSync(join(process.env.PV_MODELS, 'onnx-community', 'Florence-2-base-ft'))) {
  await page.evaluate(() => window.photoVault.setCaptionsEnabled(true))
  for (let i = 0; i < 180; i++) {
    const st = await page.evaluate(() => window.photoVault.captionStatus())
    if (st.phase === 'error' || st.described >= 2) {
      console.log('captions:', st)
      captions = st.phase === 'error' ? -1 : st.described
      break
    }
    await page.waitForTimeout(1000)
  }
  await page.evaluate(() => window.photoVault.setCaptionsEnabled(false))
}
let faces = null
if (process.env.PV_FACE) {
  await page.click('nav >> text=People')
  await page.click('button:has-text("Find people in my photos")')
  for (let i = 0; i < 180; i++) {
    const st = await page.evaluate(() => window.photoVault.peopleStatus())
    if (st.phase === 'ready' || st.phase === 'error') {
      console.log('people:', st)
      faces = st.phase === 'ready' ? st.faces : -1
      break
    }
    await page.waitForTimeout(1000)
  }
  await page.screenshot({ path: join(shots, '32-people.png') })
}
// --- 0.9: edits, share, smart album, tags/location, memories, slideshow, unplayable video ---------
const someId = await page.evaluate(async () => (await window.photoVault.assetsPage(0, 5, { types: ['photo'], hidden: 'exclude' }))[0].id)
await page.evaluate((id) => window.photoVault.saveEdits(id, 0, { filter: 'bw', crop: { x: 0, y: 0, w: 0.5, h: 1 } }), someId)
const edited = await page.evaluate((id) => window.photoVault.asset(id), someId)
const shared = await page.evaluate((id) => window.photoVault.share([id], { size: 'small', includeDate: true }), someId)
await page.evaluate((id) => window.photoVault.saveEdits(id, 0, null), someId)
const reverted = await page.evaluate((id) => window.photoVault.asset(id), someId)
await page.evaluate((id) => window.photoVault.setTags([id], ['e2e-tag'], []), someId)
const tagged = await page.evaluate(() => window.photoVault.assetIdsInRange({ text: 'e2e-tag' }, 0, 10))
await page.evaluate((id) => window.photoVault.setLocation([id], { lat: 41.15, lon: -8.61 }), someId)
const placed = await page.evaluate((id) => window.photoVault.asset(id), someId)
const smartAlbum = await page.evaluate(() => window.photoVault.createSmartAlbum('Summer 2023', { years: [2023] }))
console.log('0.9 data:', { edited: edited.edited, editedView: edited.fullView, shared: shared.files, reverted: reverted.edited, tagged: tagged.length, placed: placed.locationSource, smart: smartAlbum.count })

await page.click('nav >> text=Memories')
await page.waitForSelector('text=/Found in your own photos/')
await page.waitForTimeout(600)
await page.screenshot({ path: join(shots, '33-memories.png') })
await page.click('nav >> text=Photos')
await page.waitForTimeout(600)
await page.click('button:has-text("Slideshow")')
await page.waitForTimeout(2500)
await page.screenshot({ path: join(shots, '34-slideshow.png') })
const slideshowShown = await page.locator('[aria-label="Close slideshow"]').count()
await page.keyboard.press('Escape')
await page.waitForTimeout(600)

await page.fill('input[role="combobox"]', 'OLDCAM')
await page.keyboard.press('Escape')
await page.waitForTimeout(1500)
await page.locator('main img, main [role="button"]').first().click()
let fallbackVideo = null
for (let i = 0; i < 90 && !fallbackVideo; i++) {
  await page.waitForTimeout(1000)
  fallbackVideo = await page.evaluate(() => {
    const v = document.querySelector('.fixed video')
    return v && (v.getAttribute('src') ?? '').includes('playable') && v.videoWidth > 0 ? { src: v.getAttribute('src'), w: v.videoWidth } : null
  })
}
await page.screenshot({ path: join(shots, '35-converted-video.png') })
await page.keyboard.press('Escape')
await page.fill('input[role="combobox"]', '')
await page.waitForTimeout(500)
console.log('0.9 ui:', { slideshowShown, fallbackVideo })

let heicThumb = null
if (process.env.PV_HEIC) {
  for (let i = 0; i < 60 && heicThumb !== 'ready' && heicThumb !== 'failed'; i++) {
    await page.waitForTimeout(1000)
    heicThumb = await page.evaluate(async () => {
      const ids = await window.photoVault.assetIdsInRange({ text: 'IMG_HEIC_TEST' }, 0, 1)
      return ids[0] ? (await window.photoVault.asset(ids[0])).thumb : null
    })
  }
}
console.log('0.7:', { rotation, exported, pins, smart: smartIds?.length ?? 'skipped', heic: heicThumb ?? 'skipped', faces: faces ?? 'skipped', captions: captions ?? 'skipped' })

// --- Guide and What's new (1.0 must-have 4) --------------------------------------------------------------------
await page.click('aside button[aria-label="Guide"]')
await page.waitForSelector('main h2:has-text("Backups")')
await page.screenshot({ path: join(shots, '36-guide.png') })
const guideBackup = await page.locator('main h3:has-text("Setting up a backup drive")').isVisible()
await page.click('main [role="tab"]:has-text("What’s new")')
const appVersion = await app.evaluate(({ app }) => app.getVersion())
await page.waitForSelector(`main h2:has-text("${appVersion}")`)
await page.screenshot({ path: join(shots, '37-whats-new.png') })
const guide = { guideBackup, whatsNewHasVersion: (await page.locator(`main h2:has-text("${appVersion}")`).count()) === 1 }
console.log('guide:', guide)

// --- Crash recovery (1.0): a page, the main process and the worker thread each crash, are logged and recover ------
const logText = (root) => {
  const dir = join(root, 'logs')
  return readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
}
const libRoot = (await page.evaluate(() => window.photoVault.getState())).library.path
await page.click('nav >> text=Favourites')
await page.waitForTimeout(400)
await page.evaluate(() => window.__pvTest.crashPage())
await page.waitForSelector('text=Something went wrong')
await page.screenshot({ path: join(shots, '40-page-crash.png') })
const sidebarAlive = await page.locator('nav >> text=Tidy up').isVisible()
await page.click('button:has-text("Go to Photos")')
await page.waitForSelector('main >> text=/^\\d+ items?$/')
const pageRecovered = (await page.locator('text=Something went wrong').count()) === 0
await page.evaluate(() => window.photoVault.testCrash('main'))
await page.waitForTimeout(800)
const mainAlive = (await page.evaluate(() => window.photoVault.getState())).kind === 'ready'
await page.evaluate(() => window.photoVault.testCrash('worker')).catch(() => {})
await page.waitForTimeout(1500)
// The next job starts a fresh worker thread.
const workerAgain = await page.evaluate(() => window.photoVault.nearDuplicates(0, 1).then(() => true, () => false))
await page.waitForTimeout(500)
const log = logText(libRoot)
const crashes = {
  pageLogged: log.includes('"renderer.error"') && log.includes('test: page crash'),
  mainLogged: log.includes('"main.uncaught"') && log.includes('test: main process crash'),
  workerLogged: log.includes('"worker.crashed"') && log.includes('test: worker crash'),
  sidebarAlive,
  pageRecovered,
  mainAlive,
  workerAgain
}
console.log('crash recovery:', crashes)

// --- Metadata outside the app (1.0, D96): every original has its XMP sidecar, and the catalogue export lists them ---
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
let metadata = null
for (let i = 0; i < 60; i++) {
  const all = walk(join(libRoot, 'originals'))
  const originals = all.filter((f) => !f.endsWith('.xmp') && !f.includes('.tmp-'))
  const sidecars = originals.filter((f) => all.includes(`${f}.xmp`)).length
  const catalogue = existsSync(join(libRoot, 'metadata', 'catalogue.json')) ? JSON.parse(readFileSync(join(libRoot, 'metadata', 'catalogue.json'), 'utf8')) : null
  metadata = { originals: originals.length, sidecars, catalogueAssets: catalogue?.assets.length ?? 0, albums: catalogue?.albums.length ?? 0 }
  if (sidecars === originals.length && metadata.catalogueAssets === originals.length) break
  await page.waitForTimeout(1000)
}
const sampleSidecar = walk(join(libRoot, 'originals')).find((f) => f.endsWith('.xmp'))
const sampleXml = sampleSidecar ? readFileSync(sampleSidecar, 'utf8') : ''
metadata.wellFormed = sampleXml.startsWith('<?xpacket begin=') && sampleXml.includes('pv:SHA256="')
console.log('metadata export:', metadata)
// The deliberate crashes above print errors of their own; anything else is still a failure.
for (let i = errors.length - 1; i >= 0; i--) if (/test: (page|main process|worker) crash|The above error occurred in/.test(errors[i])) errors.splice(i, 1)

const state = await page.evaluate(() => window.photoVault.getState())
console.log('library:', state.library)

// --- Recovery drill (1.0 must-have 3) ---------------------------------------------------------------------------
// 1. Catalogue snapshot: delete an album, restore this morning's catalogue from the Safety page, the album is back.
const albumsBefore = await page.evaluate(() => window.photoVault.albums())
const victim = albumsBefore.find((a) => a.name === 'Best of 2024')
await page.evaluate(() => window.photoVault.snapshotNow())
await page.evaluate((id) => window.photoVault.deleteAlbum(id), victim.id)
const albumsDeleted = (await page.evaluate(() => window.photoVault.albums())).length
await openSafety()
await page.waitForSelector('text=Catalogue snapshots')
await page.locator('main button:has-text("Restore")').first().click()
await page.waitForTimeout(400)
await page.locator('button:has-text("Restore")').last().click()
let albumsRestored = []
for (let i = 0; i < 40 && !albumsRestored.some((a) => a.name === 'Best of 2024'); i++) {
  await page.waitForTimeout(500)
  albumsRestored = await page.evaluate(() => window.photoVault.albums().catch(() => []))
}
const snapshotDrill = {
  albumDeleted: albumsDeleted === albumsBefore.length - 1,
  albumBack: albumsRestored.some((a) => a.name === 'Best of 2024' && a.count === victim.count),
  sameAlbumCount: albumsRestored.length === albumsBefore.length
}
console.log('drill, catalogue snapshot:', snapshotDrill)

// 2. The library is lost: bring the backup up to date, delete the whole library folder, then open the backup drive
//    from a fresh install and find every photo, album, hand-set date and favourite there.
const facts = (pg) =>
  pg.evaluate(async () => {
    const pv = window.photoVault
    const s = await pv.getState()
    const sum = (gs) => gs.reduce((n, g) => n + g.count, 0)
    return {
      assets: s.library.assetCount,
      hidden: s.library.hiddenCount,
      albums: (await pv.albums()).map((a) => `${a.name}:${a.count}`).sort(),
      december2019: (await pv.timeline()).find((g) => g.month === '2019-12')?.count ?? 0,
      favourites: sum(await pv.timeline({ favorite: true }))
    }
  })
const backupTarget = (await page.evaluate(() => window.photoVault.backupStatus())).targets[0]
const lastBackup = await page.evaluate((id) => window.photoVault.runBackup(id, false), backupTarget.id)
const before = await facts(page)
// The exporter writes sidecars every 15 s and the backup copies those present: run it once more after they settle.
await page.waitForTimeout(16_000)
await page.evaluate((id) => window.photoVault.runBackup(id, false), backupTarget.id)
console.log('renderer errors:', errors.length ? errors : 'none')
await app.close()

const countThumbs = (dir) => (existsSync(dir) ? walk(dir).filter((f) => f.endsWith('-thumb.webp')).length : 0)
const thumbsBefore = countThumbs(join(root, 'Library', 'thumbnails'))
rmSync(join(root, 'Library'), { recursive: true, force: true })
const freshProfile = join(root, 'userdata-new')
mkdirSync(freshProfile)
const app2 = process.env.PV_EXE
  ? await electron.launch({ executablePath: process.env.PV_EXE, args: [], env: { ...env, PHOTOVAULT_USER_DATA: freshProfile } })
  : await electron.launch({ executablePath: electronPath, args: ['.'], env: { ...env, PHOTOVAULT_USER_DATA: freshProfile } })
const page2 = await app2.firstWindow()
const errors2 = []
page2.on('console', (m) => m.type() === 'error' && errors2.push(m.text()))
page2.on('pageerror', (e) => errors2.push(String(e)))
await page2.setViewportSize({ width: 1360, height: 860 }).catch(() => {})
await page2.waitForSelector('text=Your photos, permanently yours.')
await app2.evaluate(async ({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, backupDir)
await page2.click('text=Open an existing library')
await page2.waitForSelector('nav button', { timeout: 60000 })
const after = await facts(page2)
// Thumbnails are not part of a backup: they come back on their own.
let pendingThumbs = -1
for (let i = 0; i < 90; i++) {
  pendingThumbs = (await page2.evaluate(() => window.photoVault.getState())).library.pendingThumbnails
  if (pendingThumbs === 0) break
  await page2.waitForTimeout(1000)
}
await page2.evaluate(() => window.photoVault.startVerify())
let verified = null
for (let i = 0; i < 120; i++) {
  verified = await page2.evaluate(() => window.photoVault.currentVerify())
  if (verified && verified.status !== 'running') break
  await page2.waitForTimeout(500)
}
await page2.waitForTimeout(800)
await page2.screenshot({ path: join(shots, '41-recovered-from-backup.png') })
const backupWalk = walk(join(backupDir, 'originals'))
const backupOriginals = backupWalk.filter((f) => !f.endsWith('.xmp') && !f.includes('.tmp-'))
const recoveryDrill = {
  backupCompleted: lastBackup.status === 'completed' && lastBackup.failed === 0,
  libraryGone: !existsSync(join(root, 'Library')),
  sameItems: after.assets === before.assets && after.assets > 0,
  sameAlbums: JSON.stringify(after.albums) === JSON.stringify(before.albums),
  sameDates: after.december2019 === before.december2019 && after.december2019 > 0,
  sameFavourites: after.favourites === before.favourites && after.favourites > 0,
  sameHidden: after.hidden === before.hidden,
  thumbnailsBack: pendingThumbs === 0 && thumbsBefore > 0 && countThumbs(join(backupDir, 'thumbnails')) >= thumbsBefore,
  allVerified: verified?.status === 'completed' && verified.missing === 0 && verified.mismatched === 0 && verified.ok > 0,
  sidecarsInBackup: backupOriginals.length > 0 && backupOriginals.every((f) => backupWalk.includes(`${f}.xmp`)),
  catalogueInBackup: existsSync(join(backupDir, 'metadata', 'catalogue.json')),
  // The backup drive is now the library: it must not count as its own backup.
  honestStatus: (await page2.evaluate(() => window.photoVault.getState())).library.unprotectedCount >= after.assets,
  noErrors: errors2.length === 0
}
console.log('drill, lost library:', { before, after, thumbsBefore, ...recoveryDrill })
if (errors2.length) console.log('renderer errors (recovered app):', errors2)
await app2.close()

const ok =
  Object.values(guide).every(Boolean) &&
  Object.values(crashes).every(Boolean) &&
  Object.values(snapshotDrill).every(Boolean) &&
  Object.values(recoveryDrill).every(Boolean) &&
  metadata.originals > 0 &&
  metadata.sidecars === metadata.originals &&
  metadata.catalogueAssets === metadata.originals &&
  metadata.albums > 0 &&
  metadata.wellFormed &&
  edited.edited === true &&
  edited.fullView === 'preview' &&
  shared.files === 1 &&
  reverted.edited === false &&
  tagged.length === 1 &&
  placed.locationSource === 'manual' &&
  smartAlbum.count > 0 &&
  slideshowShown === 1 &&
  fallbackVideo !== null &&
  rotation === 90 &&
  exported === 2 &&
  pins > 0 &&
  (smartIds === null || smartIds.length > 0) &&
  (captions === null || captions > 0) &&
  (!process.env.PV_HEIC || heicThumb === 'ready') &&
  (!process.env.PV_FACE || faces >= 1) &&
  backup.protectedAssets === backup.totalAssets &&
  backup.totalAssets > 0 &&
  allSelected === `${visibleTotal} selected` &&
  afterBin.library.binCount === 2 &&
  afterDelete.library.binCount === 0 &&
  afterDelete.library.deletedCount === 1 &&
  hiddenItems === afterDelete.library.hiddenCount &&
  hiddenItems > 0 &&
  undatedBefore > 0 &&
  undatedAfter === undatedBefore - 1 &&
  dec2019 === 1 &&
  navOk &&
  /^\d+%$/.test(zoomLabel ?? '') &&
  badgeCount === 2 &&
  badgeCountAfter === 1 &&
  favAfter === favBefore + 1 &&
  near.totalGroups === 1 &&
  near.groups[0].members.length === 2 &&
  near.groups[0].members[0].originalFilename === 'IMG_4806.jpg' &&
  nearAfter.unresolvedGroups === 0 &&
  visibleBefore - visibleAfter === 4 &&
  waAsset?.origin === 'whatsapp' &&
  albums.some((a) => a.name === 'Best of 2024' && a.kind === 'user' && a.count === 3) &&
  albums.some((a) => a.name === 'Lake Weekend' && a.kind === 'takeout' && a.count === 2) &&
  searchCount === 14 &&
  favCount === 1 &&
  tko.sourceType === 'GOOGLE_TAKEOUT' &&
  tko.newAssets === 6 &&
  tko.duplicatesLibrary === 1 &&
  tko.duplicatesBatch === 2 &&
  tko.sidecarsMatched === 6 &&
  takeoutAsset?.source === 'takeout' &&
  takeoutAsset?.fav === true &&
  takeoutAsset?.albums.includes('Lake Weekend') &&
  tko2.newAssets === 0 &&
  tko2.hashesReused === 9 &&
  first.newAssets === 27 &&
  first.duplicatesBatch === 1 &&
  second.newAssets === 0 &&
  second.duplicatesLibrary === 28 &&
  third.newAssets === 0 &&
  third.duplicatesLibrary === 1 &&
  state.library.assetCount === 37 + watchAdds &&
  errors.length === 0
rmSync(root, { recursive: true, force: true })
console.log(ok ? 'E2E SMOKE PASSED' : 'E2E SMOKE FAILED')
console.log('screenshots:', shots)
process.exit(ok ? 0 : 1)
