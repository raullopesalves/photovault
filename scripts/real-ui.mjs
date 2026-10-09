// Dev helper: opens the built app against a SNAPSHOT COPY of an existing library and takes screenshots.
// The catalogue is copied with SQLite's online backup; originals/ and thumbnails/ are linked (junctions) and
// only read. Usage: node scripts/real-ui.mjs <libraryRoot> <workDir> [--wait-hashes]
import { _electron as electron } from 'playwright-core'
import { DatabaseSync, backup } from 'node:sqlite'
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const [srcRoot, workArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const waitHashes = process.argv.includes('--wait-hashes')
const smart = process.argv.includes('--smart')
const modelsArg = process.argv.find((a) => a.startsWith('--models='))?.slice(9)
const work = resolve(workArg)
const lib = join(work, 'lib')
const shots = join(work, 'shots')
const unlink = (p) => existsSync(p) && execFileSync('cmd', ['/c', 'rmdir', p]) // removes the junction only, never its target

for (const d of ['originals', 'thumbnails']) unlink(join(lib, d))
rmSync(lib, { recursive: true, force: true })
mkdirSync(join(lib, 'database'), { recursive: true })
mkdirSync(shots, { recursive: true })
copyFileSync(join(srcRoot, 'photovault-library.json'), join(lib, 'photovault-library.json'))
const src = new DatabaseSync(join(srcRoot, 'database', 'photovault.db'), { readOnly: true })
await backup(src, join(lib, 'database', 'photovault.db'))
src.close()
{
  // The copy shares the real cache folders (junctions): skip one-time cache clean-ups there.
  const copy = new DatabaseSync(join(lib, 'database', 'photovault.db'))
  try {
    copy.exec("INSERT INTO library_settings (key, value) VALUES ('face_crops', '2') ON CONFLICT (key) DO UPDATE SET value = '2'")
  } catch {
    /* older catalogue: the table appears after the upgrade, before any clean-up could run */
  }
  copy.close()
}
for (const d of ['originals', 'thumbnails']) execFileSync('cmd', ['/c', 'mklink', '/J', join(lib, d), join(srcRoot, d)])

const userData = join(work, 'userdata')
mkdirSync(userData, { recursive: true })
if (modelsArg) cpSync(modelsArg, join(userData, 'models'), { recursive: true })
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: process.env.THEME ?? 'light', libraryPath: lib, language: process.env.PV_LANG ?? 'en' }))
const env = { ...process.env, PHOTOVAULT_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL

const app = await electron.launch({ executablePath: electronPath, args: ['.'], env })
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await page.waitForSelector('nav button', { timeout: 60_000 })
  await page.waitForTimeout(2500)

  if (process.argv.includes('--captions')) {
    // Automatic descriptions: describe a few dozen of the newest photos, then show them.
    await page.evaluate(() => window.photoVault.setCaptionsEnabled(true))
    const t0 = Date.now()
    for (;;) {
      await page.waitForTimeout(10_000)
      const st = await page.evaluate(() => window.photoVault.captionStatus())
      console.log(`captions ${st.phase} ${st.described}/${st.total} (${Math.round((Date.now() - t0) / 1000)} s)`, st.error ?? '')
      if (st.phase === 'error' || st.phase === 'ready' || st.described >= Number(process.env.CAPTIONS_MIN ?? 40) || Date.now() - t0 > 10 * 60_000) break
    }
    await page.locator('nav button').last().click()
    await page.waitForTimeout(1500)
    await page.locator('text=/Automatic descriptions|Descrições automáticas/').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shots, 'captions-settings.png') })
    await page.locator('nav button').first().click()
    await page.waitForTimeout(1500)
    await page.locator('main img').first().click()
    await page.waitForTimeout(2000)
    await page.mouse.move(720, 300)
    await page.mouse.click(1262, 28)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(shots, 'captions-viewer.png') })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    const sample = await page.evaluate(async () => {
      const ids = (await window.photoVault.assetsPage(0, 12, {})).map((a) => a.id)
      return Promise.all(ids.map(async (id) => (await window.photoVault.asset(id))?.autoCaption))
    })
    console.log('captions:', JSON.stringify(sample, null, 1))
  }

  if (process.argv.includes('--web-gallery')) {
    // A throwaway album in the snapshot copy, shared as a web page into the work folder.
    const out = join(work, 'web')
    rmSync(out, { recursive: true, force: true })
    mkdirSync(out, { recursive: true })
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, out)
    await page.evaluate(async () => {
      const ids = (await window.photoVault.assetsPage(0, 40, { mediaType: 'photo' })).map((a) => a.id)
      await window.photoVault.createAlbum('Web gallery test', ids)
    })
    await page.locator('nav button').nth(3).click()
    await page.waitForTimeout(1500)
    await page.locator('main button:has-text("Web gallery test")').first().click()
    await page.waitForTimeout(2000)
    await page.locator('[aria-label="Share as a web page"]').click()
    await page.waitForSelector('text=/Web page ready/', { timeout: 120_000 })
    await page.screenshot({ path: join(shots, 'web-album.png') })
    const index = join(out, 'Web gallery test (web)', 'index.html')
    const winPromise = app.waitForEvent('window')
    await app.evaluate(({ BrowserWindow }, file) => {
      const w = new BrowserWindow({ width: 1280, height: 860, show: true })
      void w.loadFile(file)
    }, index)
    const web = await winPromise
    await web.waitForLoadState()
    await web.waitForTimeout(2000)
    await web.screenshot({ path: join(shots, 'web-page.png') })
    await web.locator('main button').nth(2).click()
    await web.waitForTimeout(1500)
    await web.screenshot({ path: join(shots, 'web-viewer.png') })
    await web.close()
  }

  if (process.argv.includes('--all-views')) {
    // Every sidebar view in turn (works in any interface language).
    const count = await page.locator('nav button').count()
    for (let i = 0; i < count; i++) {
      await page.locator('nav button').nth(i).click()
      await page.waitForTimeout(2500)
      await page.screenshot({ path: join(shots, `view-${String(i).padStart(2, '0')}.png`) })
    }
    await page.locator('nav button').first().click()
    await page.waitForTimeout(1000)
    await page.locator('main img').nth(3).click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(shots, 'view-viewer.png') })
    await page.mouse.click(720, 450, { button: 'right' })
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(shots, 'view-viewer-menu.png') })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
  }

  if (process.argv.includes('--tour')) {
    const shot = (name) => page.screenshot({ path: join(shots, `tour-${name}.png`) })
    // Viewer: editor (adjust, crop, filters) — cancelled, never saved on the snapshot.
    await page.locator('main img').nth(3).click()
    await page.waitForTimeout(1500)
    await page.click('button:has-text("Edit")')
    await page.waitForTimeout(2000)
    await page.locator('input[type="range"]').first().focus()
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(1500)
    await shot('edit-adjust')
    await page.click('button:has-text("Crop & rotate")')
    await page.waitForTimeout(1500)
    await page.click('button:has-text("Square")')
    await page.waitForTimeout(1200)
    await shot('edit-crop')
    await page.click('button:has-text("Filters")')
    await page.waitForTimeout(4000)
    await shot('edit-filters')
    await page.click('button:has-text("Cancel")')
    await page.waitForTimeout(800)
    // Faces overlay and info panel.
    await page.keyboard.press('f')
    await page.waitForTimeout(1500)
    await page.keyboard.press('i')
    await page.waitForTimeout(1500)
    await shot('viewer-faces-info')
    await page.keyboard.press('f')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    // Memories + slideshow.
    await page.click('nav >> text=Memories')
    await page.waitForTimeout(3000)
    await shot('memories')
    await page.locator('main button:has-text("Trip to")').first().click()
    await page.waitForTimeout(2500)
    await shot('memory-trip')
    await page.click('button:has-text("Slideshow")')
    await page.waitForTimeout(4500)
    await shot('slideshow')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    // People: a person's Faces tab.
    await page.click('nav >> text=People')
    await page.waitForTimeout(4000)
    await shot('people')
    console.log('people debug:', await page.locator('main button:has-text("photos")').count(), await page.evaluate(() => [...document.querySelectorAll('main button')].slice(0, 6).map((b) => b.textContent)))
    const tClick = Date.now()
    await page.locator('main button:has-text("photos")').first().click({ force: true, noWaitAfter: true })
    console.log('person page: renderer responsive after', await page.evaluate(() => 1).then(() => Date.now() - tClick), 'ms')
    console.log('person api timings:', await page.evaluate(async () => {
      const ppl = await window.photoVault.people()
      const id = ppl[0].id
      const t = (async (f) => { const s = performance.now(); await f(); return Math.round(performance.now() - s) })
      return { person: await t(() => window.photoVault.person(id)), merges: await t(() => window.photoVault.personMerges(id)), timeline: await t(() => window.photoVault.timeline({ personId: id, hidden: 'exclude' })), page: await t(() => window.photoVault.assetsPage(0, 240, { personId: id, hidden: 'exclude' })), faces: await t(() => window.photoVault.personFaces(id)), people: await t(() => window.photoVault.people()) }
    }))
    await page.waitForTimeout(1500)
    await page.click('button:has-text("Faces")')
    await page.waitForTimeout(2500)
    await shot('person-faces')
    // Selection bar: More menu and Share dialog.
    await page.click('nav >> text=Photos')
    await page.waitForTimeout(1500)
    await page.locator('main [aria-label="Select"]').nth(0).click({ force: true })
    await page.locator('main [aria-label="Select"]').nth(1).click({ force: true })
    await page.click('button:has-text("More")')
    await page.waitForTimeout(500)
    await shot('more-menu')
    await page.click('button[aria-label="More actions"]')
    await page.waitForTimeout(300)
    await page.locator('button:has-text("Share"):visible').last().click()
    await page.waitForTimeout(600)
    await shot('share-dialog')
    await page.click('button:has-text("Cancel")')
    await page.click('[aria-label="Clear selection"]')
    // An HEVC video: thumbnail and playback through a playable copy.
    await page.fill('input[placeholder^="Search names"]', '46815')
    await page.waitForTimeout(2500)
    await shot('hevc-grid')
    await page.locator('main img').first().click()
    await page.waitForTimeout(2500)
    await shot('hevc-viewer-early')
    await page.waitForTimeout(30_000)
    await shot('hevc-viewer-later')
    const playing = await page.evaluate(() => {
      const v = document.querySelector('.fixed video')
      return v ? { src: v.getAttribute('src'), w: v.videoWidth, t: v.currentTime } : null
    })
    console.log('hevc playback:', playing)
    await page.keyboard.press('Escape')
    await page.fill('input[placeholder^="Search names"]', '')
    await page.waitForTimeout(800)
  }



  if (process.argv.includes('--viewer')) {
    // Open a photo while background work is running and watch the picture for 8 s.
    await page.locator('main [role="button"], main button img').first().waitFor({ timeout: 30_000 }).catch(() => {})
    await page.locator('main img').nth(3).click()
    await page.waitForTimeout(1500)
    const states = new Map()
    let changes = 0
    let last = ''
    for (let i = 0; i < 80; i++) {
      const s = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('.fixed.inset-0 img')]
        return imgs.map((im) => `${im.getAttribute('src')}|${im.className.includes('opacity-0') ? 'hidden' : 'shown'}|${im.className.includes('blur') ? 'blur' : 'full'}`).join(' ; ')
      })
      if (s !== last) changes++
      last = s
      states.set(s, (states.get(s) ?? 0) + 1)
      await page.waitForTimeout(100)
    }
    console.log('viewer: distinct states', states.size, 'changes', changes, [...states.keys()].map((k) => k.slice(0, 120)))
    console.log('versions seen during the test:', await page.evaluate(() => window.__pvVersion ?? 'n/a'))
    await page.mouse.click(720, 450, { button: 'right' })
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(shots, 'viewer-menu.png') })
    await page.click('text=Copy picture')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(shots, 'viewer-copied.png') })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }

  if (process.argv.includes('--people-review')) {
    await page.click('nav >> text=People')
    await page.waitForSelector('text=Same person?', { timeout: 120_000 })
    await page.waitForTimeout(2000)
    console.log('people after regroup:', await page.evaluate(() => window.photoVault.peopleStatus()))
    await page.screenshot({ path: join(shots, 'people-banner.png') })
    await page.click('button:has-text("Review")')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(shots, 'people-review.png') })
    const probe = () => page.evaluate(() => [...document.querySelectorAll('.fixed img')].slice(0, 6).map((i) => i.getAttribute('src')).join(' ') + ' | ' + (document.querySelector('.fixed .text-xs')?.textContent ?? ''))
    console.log('before:', await probe())
    await page.click('button:has-text("Not sure")')
    await page.waitForTimeout(1200)
    console.log('after not sure:', await probe())
    await page.keyboard.press('n')
    await page.waitForTimeout(1200)
    console.log('after key n:', await probe())
    await page.screenshot({ path: join(shots, 'people-review2.png') })
    await page.keyboard.press('Escape')
    await page.click('nav >> text=Photos')
    await page.waitForTimeout(800)
  }

  if (process.argv.includes('--phone')) {
    await page.click('button[aria-haspopup="menu"]')
    await page.click('[role="menuitem"]:has-text("Phone or camera")')
    await page.waitForTimeout(6000)
    await page.screenshot({ path: join(shots, 'phone.png') })
    await page.click('button:has-text("Cancel")')
  }

  if (process.argv.includes('--people')) {
    await page.click('nav >> text=People')
    await page.click('button:has-text("Find people in my photos")')
    const t0 = Date.now()
    for (;;) {
      await page.waitForTimeout(15_000)
      const st = await page.evaluate(() => window.photoVault.peopleStatus())
      console.log(`people ${st.phase} ${st.scanned}/${st.total} faces ${st.faces} people ${st.people} (${Math.round((Date.now() - t0) / 1000)} s)`, st.error ?? '')
      if (st.phase === 'error' || st.phase === 'ready' || st.scanned >= Number(process.env.PEOPLE_MIN ?? 3000) || Date.now() - t0 > 15 * 60_000) break
    }
    await page.click('nav >> text=Photos')
    await page.click('nav >> text=People')
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(shots, 'people.png') })
    await page.locator('main button:has-text("photos")').first().click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(shots, 'person.png') })
  }

  if (smart) {
    await page.click('nav >> text=Settings')
    await page.click('button:has-text("Turn on smart search")')
    const t0 = Date.now()
    for (;;) {
      await page.waitForTimeout(10_000)
      const st = await page.evaluate(() => window.photoVault.smartSearchStatus())
      console.log(`smart ${st.phase} ${st.indexed}/${st.total} (${Math.round((Date.now() - t0) / 1000)} s)`, st.error ?? '')
      if (st.phase === 'error' || st.phase === 'ready' || st.indexed >= Number(process.env.SMART_MIN ?? 4000) || Date.now() - t0 > 8 * 60_000) break
    }
    await page.screenshot({ path: join(shots, 'smart-settings.png') })
    await page.click('nav >> text=Photos')
    await page.waitForTimeout(800)
    await page.click('[aria-label="Smart search"]')
    await page.fill('input[placeholder^="Describe it"]', 'swimming pool')
    await page.waitForSelector('text=/Looks like/', { timeout: 30_000 })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(shots, 'smart-pool.png') })
    await page.fill('input[placeholder^="Describe it"]', 'birthday cake')
    await page.waitForSelector('text=/birthday cake/', { timeout: 30_000 })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(shots, 'smart-cake.png') })
    await page.click('[aria-label="Smart search"]')
    await page.fill('input[placeholder^="Search names"]', '')
    await page.waitForTimeout(800)
  }

  if (process.argv.includes('--pets')) {
    // After --smart has indexed some photos: the dog and cat groups.
    const groups = await page.evaluate(() => window.photoVault.pets())
    console.log('pets:', groups.map((g) => `${g.kind} ${g.ids.length}`).join(', ') || 'none')
    writeFileSync(join(shots, 'pets.json'), JSON.stringify(groups))
    await page.locator('nav button').nth(4).click()
    await page.waitForTimeout(3000)
    await page.screenshot({ path: join(shots, 'pets-people.png') })
    for (const g of groups) {
      const card = page.locator(`main button:has-text("${g.kind === 'dog' ? 'Dogs' : 'Cats'}")`).first()
      await card.scrollIntoViewIfNeeded()
      if (g.kind === 'dog') await page.screenshot({ path: join(shots, 'pets-section.png') })
      await card.click()
      await page.waitForTimeout(3500)
      await page.screenshot({ path: join(shots, `pets-${g.kind}.png`) })
      await page.locator('main button:has(svg.lucide-arrow-left)').first().click()
      await page.waitForTimeout(1500)
    }
  }
  await page.click('button:has-text("Date taken")')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, 'recently-added.png') })
  await page.click('button:has-text("Recently added")')

  await page.click('nav >> text=Map')
  await page.waitForTimeout(3500)
  await page.screenshot({ path: join(shots, 'map-world.png') })
  const pin = page.locator('.pv-pin').first()
  if (await pin.count()) {
    await pin.click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(shots, 'map-place.png') })
  }

  if (waitHashes) {
    const t0 = Date.now()
    for (;;) {
      const s = await page.evaluate(() => window.photoVault.similarPhotos(0, 1))
      console.log(`sharpness ${s.hashed}/${s.hashable} (${Math.round((Date.now() - t0) / 1000)} s)`)
      if (s.hashed >= s.hashable || Date.now() - t0 > 15 * 60_000) break
      await page.waitForTimeout(10_000)
    }
  }
  await page.click('nav >> text=Duplicates')
  await page.waitForTimeout(1000)
  await page.click('button:has-text("Similar photos")')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(shots, 'similar.png') })
  const s = await page.evaluate(() => window.photoVault.similarPhotos(0, 1))
  console.log('similar:', { groups: s.totalGroups, extra: s.extraCopies, hashed: s.hashed, hashable: s.hashable })
  console.log('errors:', errors)
} finally {
  await app.close()
  for (const d of ['originals', 'thumbnails']) unlink(join(lib, d))
  console.log('targets intact:', ['originals', 'thumbnails'].every((d) => existsSync(join(srcRoot, d))))
}
