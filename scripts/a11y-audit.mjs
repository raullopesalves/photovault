// Accessibility audit: launches the built app (node scripts/electron-vite.mjs build first) on a small throwaway
// library, opens every page and the viewer, menus and dialogs, runs axe-core (WCAG 2.1 A/AA and best practice) on
// each, and walks the app with the keyboard. Exits 1 on any violation.
// Usage: node scripts/a11y-audit.mjs [--report <file.json>] [--shots <dir>] [--contrast] [--theme dark]
//   --contrast  also fail on colour contrast (reported either way)
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const electronPath = require('electron')
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const failOnContrast = args.includes('--contrast')
const theme = opt('--theme') ?? 'light'
const shots = opt('--shots')
if (shots) mkdirSync(shots, { recursive: true })
const shot = (name) => (shots ? page.screenshot({ path: join(shots, `${name}.png`) }) : Promise.resolve())

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'photovault-a11y-')))
const photos = join(root, 'Photos')
const userData = join(root, 'userdata')
mkdirSync(photos, { recursive: true })
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme, libraryPath: null }))
for (let i = 0; i < 14; i++) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="hsl(${(i * 53) % 360},60%,55%)"/><circle cx="${100 + i * 40}" cy="300" r="90" fill="white" opacity="0.7"/></svg>`
  await sharp(Buffer.from(svg))
    .jpeg()
    .withExif({ IFD0: { Make: 'Apple', Model: 'iPhone 14 Pro' }, IFD2: { DateTimeOriginal: `2023:0${1 + (i % 3)}:1${i % 10} 10:00:00` } })
    .toFile(join(photos, `IMG_${1000 + i}.jpg`))
}

const env = { ...process.env, PHOTOVAULT_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ executablePath: electronPath, args: ['.'], env })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.setViewportSize({ width: 1360, height: 880 }).catch(() => {})
await page.waitForSelector('text=Your photos, permanently yours.')

const results = []
async function audit(name) {
  await page.waitForTimeout(350)
  const r = await page.evaluate(async (src) => {
    if (!window.axe) (0, eval)(src)
    const out = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] })
    return out.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), html: (n.html ?? "").slice(0, 160), why: n.failureSummary?.split('\n').slice(1, 3).join(' ') })),
      count: v.nodes.length
    }))
  }, axeSource)
  results.push({ name, violations: r })
}

await audit('welcome')
await app.evaluate(async ({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, join(root, 'Library'))
await page.click('text=Create a library')
await page.waitForSelector('text=Start your archive')
await audit('empty library')

await app.evaluate(async ({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, photos)
await page.click('aside button[aria-haspopup="menu"]')
await audit('import menu')
await page.click('text=Folder…')
await page.waitForSelector('text=/Import ready/', { timeout: 60000 })
await audit('import review')
await page.click('[data-testid=import-confirm]')
await page.waitForSelector('text=View photos', { timeout: 120000 })
await page.click('text=View photos')
for (let i = 0; i < 100; i++) {
  const s = await page.evaluate(() => window.photoVault.getState())
  if (s.kind === 'ready' && s.library.pendingThumbnails === 0) break
  await page.waitForTimeout(200)
}

const nav = async (label) => {
  await page.keyboard.press('Escape')
  await page.click(`nav >> text=${label}`)
}
for (const label of ['Photos', 'Memories', 'People', 'Places', 'Albums', 'Favourites', 'Screenshots', 'Videos', 'Tidy up', 'Bin']) {
  await nav(label)
  await audit(label)
}
await page.click('aside button[aria-label^="Safety"]')
await audit('Safety')
await page.click('aside button[aria-label="Settings"]')
await audit('Settings')
await page.click('aside button[aria-label="Guide"]')
await audit('Guide')

// States: search, filters, selection, viewer, a dialog.
await nav('Photos')
await page.keyboard.press('Control+k')
await page.keyboard.type('IMG')
await audit('search box')
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /^Filters/ }).click()
await audit('filters panel')
await page.keyboard.press('Escape')
await page.locator('main [data-index="0"]').click({ modifiers: ['Control'] })
await audit('selection bar')
await page.keyboard.press('Escape')
await page.locator('main [data-index="0"]').click()
await page.waitForTimeout(600)
await audit('viewer')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await nav('Albums')
const newAlbum = page.getByRole('button', { name: /New album/ })
if (await newAlbum.count()) {
  await newAlbum.first().click()
  await audit('prompt dialog')
  await page.keyboard.press('Escape')
}

// Keyboard walk: Tab from the top of Photos and record where focus goes.
await nav('Photos')
await page.waitForTimeout(400)
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
await page.keyboard.press('Shift+Tab')
await page.keyboard.press('Tab')
await page.locator('text=Skip to content').focus()
await shot('a11y-skip-link')
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
const walk = []
for (let i = 0; i < 45; i++) {
  await page.keyboard.press('Tab')
  await page.waitForTimeout(180) // let fade-ins on focus finish before judging visibility
  walk.push(
    await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return { lost: true }
      const r = el.getBoundingClientRect()
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      const cs = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') ?? '',
        name,
        visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05,
        ring: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none'
      }
    })
  )
}
const keyboard = {
  lost: walk.filter((w) => w.lost).length,
  invisible: walk.filter((w) => !w.lost && !w.visible).map((w) => `${w.tag}${w.role ? `[${w.role}]` : ''} "${w.name}"`),
  unnamed: walk.filter((w) => !w.lost && !w.name).map((w) => `${w.tag}${w.role ? `[${w.role}]` : ''}`),
  noRing: walk.filter((w) => !w.lost && !w.ring).map((w) => `${w.tag} "${w.name}"`),
  order: walk.map((w) => (w.lost ? '(body)' : `${w.tag}${w.role ? `[${w.role}]` : ''} ${w.name}`))
}

// Keyboard use, checked: the grid's arrow keys, the viewer and dialogs keep and return focus, Space selects.
const focused = () =>
  page.evaluate(() => {
    const el = document.activeElement
    return { index: el?.getAttribute('data-index') ?? null, role: el?.getAttribute('role') ?? null, inDialog: !!el?.closest('[role="dialog"]'), label: el?.getAttribute('aria-label') ?? el?.textContent?.trim().slice(0, 30) ?? '' }
  })
const checks = {}
await page.locator('main [role="gridcell"][data-index="0"]').focus()
await page.keyboard.press('ArrowRight')
checks.arrowRight = (await focused()).index === '1'
await shot('a11y-grid-focus')
const cols = await page.evaluate(() => document.querySelector('main [role="row"] + [role="row"]') && document.querySelectorAll('main [role="row"]')[1]?.querySelectorAll('[role="gridcell"]').length)
await page.keyboard.press('ArrowLeft')
await page.keyboard.press('ArrowDown')
checks.arrowDown = Number((await focused()).index) === cols || Number((await focused()).index) > 0
await page.keyboard.press('Control+Home')
checks.ctrlHome = (await focused()).index === '0'
await page.keyboard.press('Space')
checks.spaceSelects = (await page.getAttribute('main [role="gridcell"][data-index="0"]', 'aria-selected')) === 'true'
await page.keyboard.press('Escape')
await page.keyboard.press('ArrowRight')
await page.keyboard.press('Enter')
await page.waitForTimeout(700)
const inViewer = await focused()
checks.viewerTakesFocus = inViewer.inDialog
if (!inViewer.inDialog) console.log('focus after opening the viewer:', inViewer)
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
await page.waitForTimeout(900)
checks.viewerReturnsToPhoto = (await focused()).index === '2'
await nav('Albums')
const newAlbum2 = page.getByRole('button', { name: /New album/ }).first()
if (await newAlbum2.count()) {
  await newAlbum2.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  let inside = true
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    inside &&= (await focused()).inDialog
  }
  checks.dialogKeepsFocus = inside
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  checks.dialogReturnsFocus = /New album/.test((await focused()).label)
}
await page.click('aside button[aria-haspopup="menu"]')
await page.waitForTimeout(150)
await page.keyboard.press('ArrowDown')
checks.menuArrows = /ZIP/.test((await focused()).label)
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
checks.menuReturnsFocus = /Import/.test((await focused()).label)
console.log('keyboard checks:', checks)

await app.close()
rmSync(root, { recursive: true, force: true })

const counted = (v) => failOnContrast || v.id !== 'color-contrast'
let failures = 0
for (const r of results) {
  const shown = r.violations
  if (!shown.length) continue
  console.log(`\n## ${r.name}`)
  for (const v of shown) {
    if (counted(v)) failures++
    console.log(`- [${v.impact}] ${v.id} (${v.count}): ${v.help}${counted(v) ? '' : ' (not counted)'}`)
    for (const node of v.nodes.slice(0, 3)) console.log(`    ${node.target}  ${node.why ?? ''}\n      ${node.html}`)
  }
}
console.log('\nkeyboard walk:', JSON.stringify({ lost: keyboard.lost, invisible: keyboard.invisible, unnamed: keyboard.unnamed, noRing: keyboard.noRing }, null, 1))
console.log('tab order:', keyboard.order.join(' → '))
if (opt('--report')) writeFileSync(opt('--report'), JSON.stringify({ results, keyboard, checks, errors }, null, 2))
const keyboardOk = keyboard.lost === 0 && keyboard.invisible.length === 0 && keyboard.unnamed.length === 0 && Object.values(checks).every(Boolean)
console.log(failures === 0 && keyboardOk && errors.length === 0 ? '\nA11Y AUDIT PASSED' : `\nA11Y AUDIT FAILED: ${failures} violations${keyboardOk ? '' : ', keyboard problems'}${errors.length ? `, ${errors.length} page errors` : ''}`)
process.exit(failures === 0 && keyboardOk && errors.length === 0 ? 0 : 1)
