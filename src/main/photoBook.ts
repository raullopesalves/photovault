import { BrowserWindow } from 'electron'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExportProgress, Language, PhotoBookLayout } from '@shared/types'
import { applyEdits, decodeOriented } from '@core/media/edits'
import { isSharpDecodable } from '@core/media/formats'
import { isRawMime } from '@core/media/raw'
import type { Library } from '@core/library/library'
import { originalPathFor } from '@core/thumbnails/thumbnails'
import { errorMessage } from '@core/util'

interface Pic {
  file: string
  w: number
  h: number
  date: string | null
  caption: string | null
}

const MAX_ITEMS = 600
/** Long side in pixels: about 200 dpi on A4 for full pages, less for the contact sheet. */
const SIZE: Record<PhotoBookLayout, number> = { book: 2400, single: 2400, grid: 700 }

const html = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/**
 * Print-ready PDF of photos (A4): a photo book (cover, then one landscape or two portrait photos per page with
 * date and caption), a contact sheet (20 per page) or one photo per page. Edits are applied; videos are left
 * out. Rendered by Chromium in a hidden window; print it at home or send it to a print shop.
 */
export async function makePhotoBook(
  library: Library,
  assetIds: number[],
  out: string,
  opts: { title: string; layout: PhotoBookLayout; lang: Language; onProgress?: (p: ExportProgress) => void }
): Promise<{ pages: number; photos: number; skipped: number; file: string }> {
  const rows = library.db.all<{ id: number; media_type: string; capture_time: string | null; description: string | null }>(
    `SELECT id, media_type, capture_time, description FROM assets
      WHERE id IN (SELECT value FROM json_each(?)) AND trashed_at IS NULL
      ORDER BY undated, sort_time, id`,
    [JSON.stringify(assetIds)]
  )
  const photos = rows.filter((r) => r.media_type === 'photo').slice(0, MAX_ITEMS)
  let skipped = rows.length - photos.length
  const dir = await mkdtemp(join(tmpdir(), 'pv-book-'))
  try {
    await mkdir(join(dir, 'img'))
    const pics: Pic[] = []
    const progress: ExportProgress = { done: 0, total: photos.length, failed: 0, bytes: 0 }
    for (const [i, r] of photos.entries()) {
      try {
        const src = originalPathFor(library, r.id)
        if (!src || (!isSharpDecodable(src.mime) && !isRawMime(src.mime) && src.mime !== 'image/heic' && src.mime !== 'image/heif')) throw new Error('not printable')
        const raw = await decodeOriented(src.absolutePath, src.mime, SIZE[opts.layout])
        const img = await applyEdits(raw, src.rotation, src.edits)
        const file = `img/${String(i).padStart(5, '0')}.jpg`
        const res = await img.jpeg({ quality: 90 }).toFile(join(dir, file))
        pics.push({ file, w: res.width, h: res.height, date: r.capture_time, caption: r.description })
      } catch (err) {
        skipped++
        progress.failed++
        library.logger.warn('photo_book.item_failed', { assetId: r.id, error: errorMessage(err) })
      }
      progress.done++
      opts.onProgress?.({ ...progress })
    }
    if (pics.length === 0) throw new Error('None of these items can be printed (videos are left out).')
    const { body, pages, landscape } = layout(opts.title, pics, opts.layout, opts.lang)
    const page = join(dir, 'book.html')
    await writeFile(page, body)
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
    try {
      await win.loadURL(pathToFileURL(page).href)
      const pdf = await win.webContents.printToPDF({ pageSize: 'A4', landscape, printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
      await writeFile(out, pdf)
    } finally {
      win.destroy()
    }
    library.logger.info('photo_book.made', { file: out, layout: opts.layout, photos: pics.length, pages, skipped })
    return { pages, photos: pics.length, skipped, file: out }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function layout(title: string, pics: Pic[], kind: PhotoBookLayout, lang: Language): { body: string; pages: number; landscape: boolean } {
  const locale = lang === 'pt' ? 'pt-PT' : 'en-GB'
  const day = (iso: string | null): string =>
    iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''
  const caption = (p: Pic): string => {
    const parts = [day(p.date), p.caption ?? ''].filter(Boolean).map(html)
    return parts.length ? `<figcaption>${parts.join(' · ')}</figcaption>` : ''
  }
  const fig = (p: Pic, withCaption = true): string => `<figure><div class="frame"><img src="${p.file}"></div>${withCaption ? caption(p) : ''}</figure>`
  const dates = pics.map((p) => p.date).filter((d): d is string => !!d)
  const range = dates.length ? (day(dates[0]!) === day(dates[dates.length - 1]!) ? day(dates[0]!) : `${day(dates[0]!)} – ${day(dates[dates.length - 1]!)}`) : ''
  const count = `${pics.length} ${lang === 'pt' ? (pics.length === 1 ? 'fotografia' : 'fotografias') : pics.length === 1 ? 'photo' : 'photos'}`

  const pages: string[] = []
  let landscape = false
  if (kind === 'book') {
    landscape = true
    const cover = pics.find((p) => p.w >= p.h) ?? pics[0]!
    pages.push(
      `<section class="page cover"><div class="frame"><img src="${cover.file}"></div><div class="title"><h1>${html(title)}</h1><p>${html([range, count].filter(Boolean).join(' · '))}</p></div></section>`
    )
    const rest = pics.filter((p) => p !== cover)
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!
      const b = rest[i + 1]
      if (a.h > a.w && b && b.h > b.w) {
        pages.push(`<section class="page two">${fig(a)}${fig(b)}</section>`)
        i++
      } else pages.push(`<section class="page one">${fig(a)}</section>`)
    }
  } else if (kind === 'single') {
    for (const p of pics) pages.push(`<section class="page one">${fig(p)}</section>`)
  } else {
    const per = 20
    for (let i = 0; i < pics.length; i += per) {
      const cells = pics
        .slice(i, i + per)
        .map((p) => `<figure><div class="frame"><img src="${p.file}"></div><figcaption>${html(day(p.date))}</figcaption></figure>`)
        .join('')
      pages.push(
        `<section class="page grid"><header><b>${html(title)}</b><span>${Math.floor(i / per) + 1} / ${Math.ceil(pics.length / per)}</span></header><div class="cells">${cells}</div></section>`
      )
    }
  }
  const [w, h] = landscape ? ['297mm', '210mm'] : ['210mm', '297mm']
  const body = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${html(title)}</title><style>
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: Georgia, "Times New Roman", serif; color: #1c1917; }
.page { width: ${w}; height: ${h}; padding: 12mm; page-break-after: always; break-after: page; overflow: hidden; display: flex; gap: 8mm; }
.page:last-child { page-break-after: auto; break-after: auto; }
figure { margin: 0; flex: 1; display: flex; flex-direction: column; min-width: 0; }
.frame { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.frame img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
figcaption { text-align: center; font-size: 10pt; color: #57534e; padding-top: 3mm; font-style: italic; }
.cover { flex-direction: column; padding: 16mm; }
.cover .frame { flex: 1; }
.cover .title { text-align: center; padding-top: 7mm; }
.cover h1 { font-size: 28pt; margin: 0; font-weight: normal; letter-spacing: 0.01em; }
.cover p { margin: 2mm 0 0; color: #78716c; font-size: 11pt; }
.grid { flex-direction: column; gap: 4mm; padding: 10mm; font-family: system-ui, "Segoe UI", sans-serif; }
.grid header { display: flex; justify-content: space-between; font-size: 10pt; color: #44403c; }
.grid .cells { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(5, 1fr); gap: 4mm; min-height: 0; }
.grid figure { min-height: 0; }
.grid figcaption { font-style: normal; font-size: 7pt; padding-top: 1mm; }
</style></head><body>${pages.join('\n')}</body></html>`
  return { body, pages: pages.length, landscape }
}
