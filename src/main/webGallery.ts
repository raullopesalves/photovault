import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { ExportProgress, ExportResult } from '@shared/types'
import { applyEdits, decodeOriented } from '@core/media/edits'
import { isSharpDecodable } from '@core/media/formats'
import { isRawMime } from '@core/media/raw'
import sharp from '@core/media/sharp'
import type { Library } from '@core/library/library'
import { originalPathFor } from '@core/thumbnails/thumbnails'
import { errorMessage } from '@core/util'

interface Item {
  type: 'photo' | 'video'
  src: string
  thumb: string
  w: number
  h: number
  date: string | null
  caption: string | null
}

const safe = (name: string): string => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim() || 'Album'
const html = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/**
 * "Share as a web page": a folder with index.html, photos/ and thumbs/ that opens in any browser, offline
 * (double-click it), and can be zipped and sent or uploaded anywhere (Google Drive, a website) to share as a
 * link. Photos are JPEGs at 2048 px with edits applied and location and camera details removed (like Share);
 * videos are copied as they are. The library is not touched.
 */
export async function exportWebGallery(
  library: Library,
  assetIds: number[],
  parent: string,
  opts: { title: string; description?: string | null; onProgress?: (p: ExportProgress) => void }
): Promise<ExportResult> {
  let folder = join(parent, `${safe(opts.title)} (web)`)
  for (let i = 2; existsSync(folder); i++) folder = join(parent, `${safe(opts.title)} (web ${i})`)
  await mkdir(join(folder, 'photos'), { recursive: true })
  await mkdir(join(folder, 'thumbs'), { recursive: true })

  // Oldest first: an album reads like a story.
  const rows = library.db.all<{ id: number; media_type: string; capture_time: string | null; description: string | null; original_filename: string }>(
    `SELECT id, media_type, capture_time, description, original_filename FROM assets
      WHERE id IN (SELECT value FROM json_each(?)) AND trashed_at IS NULL
      ORDER BY undated, sort_time, id`,
    [JSON.stringify(assetIds.slice(0, 20_000))]
  )
  const items: Item[] = []
  const errors: string[] = []
  const progress: ExportProgress = { done: 0, total: rows.length, failed: 0, bytes: 0 }
  opts.onProgress?.({ ...progress })
  for (const [i, r] of rows.entries()) {
    const name = String(i + 1).padStart(5, '0')
    const src = originalPathFor(library, r.id)
    try {
      if (!src) throw new Error('original not found')
      const date = r.capture_time ? r.capture_time.slice(0, 10) : null
      if (r.media_type === 'video') {
        const file = `photos/${name}${extname(src.absolutePath).toLowerCase()}`
        await copyFile(src.absolutePath, join(folder, file))
        const thumb = library.db.get<{ relative_path: string; width: number; height: number }>(
          "SELECT relative_path, width, height FROM asset_thumbnails WHERE asset_id = ? AND variant = 'thumb'",
          [r.id]
        )
        if (thumb) await sharp(join(library.root, ...thumb.relative_path.split('/'))).jpeg({ quality: 80 }).toFile(join(folder, `thumbs/${name}.jpg`))
        items.push({ type: 'video', src: file, thumb: `thumbs/${name}.jpg`, w: thumb?.width ?? 16, h: thumb?.height ?? 9, date, caption: r.description })
        progress.bytes += (await stat(join(folder, file))).size
      } else {
        if (!isSharpDecodable(src.mime) && !isRawMime(src.mime) && src.mime !== 'image/heic' && src.mime !== 'image/heif') throw new Error(`unsupported ${src.mime}`)
        const raw = await decodeOriented(src.absolutePath, src.mime, 2048)
        const img = await applyEdits(raw, src.rotation, src.edits)
        const big = await img.jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true })
        await writeFile(join(folder, `photos/${name}.jpg`), big.data)
        await sharp(big.data).resize(480, 480, { fit: 'inside' }).jpeg({ quality: 78, mozjpeg: true }).toFile(join(folder, `thumbs/${name}.jpg`))
        items.push({ type: 'photo', src: `photos/${name}.jpg`, thumb: `thumbs/${name}.jpg`, w: big.info.width, h: big.info.height, date, caption: r.description })
        progress.bytes += big.data.length
      }
    } catch (err) {
      progress.failed++
      if (errors.length < 20) errors.push(`${r.original_filename}: ${errorMessage(err)}`)
      library.logger.warn('web_gallery.item_failed', { assetId: r.id, error: errorMessage(err) })
    }
    progress.done++
    opts.onProgress?.({ ...progress })
  }
  await writeFile(join(folder, 'index.html'), page(opts.title, opts.description ?? null, items))
  library.logger.info('web_gallery.exported', { folder, items: items.length, failed: progress.failed })
  return { exported: items.length, failed: progress.failed, bytes: progress.bytes, folder, errors }
}

function page(title: string, description: string | null, items: Item[]): string {
  const dates = items.map((i) => i.date).filter((d): d is string => !!d)
  const fmt = (d: string): string => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const range = dates.length ? (dates[0] === dates[dates.length - 1] ? fmt(dates[0]!) : `${fmt(dates[0]!)} – ${fmt(dates[dates.length - 1]!)}`) : ''
  // JSON inside <script>: "</" must not appear literally.
  const data = JSON.stringify(items).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)}</title>
<style>
:root { --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --tile: #e7e5e4; }
@media (prefers-color-scheme: dark) { :root { --bg: #0c0a09; --fg: #f5f5f4; --muted: #a8a29e; --tile: #292524; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { max-width: 1200px; margin: 0 auto; padding: 40px 16px 20px; }
h1 { margin: 0; font-size: clamp(26px, 5vw, 38px); letter-spacing: -0.02em; }
.meta { color: var(--muted); margin-top: 6px; }
.desc { margin-top: 12px; max-width: 70ch; white-space: pre-wrap; }
main { max-width: 1200px; margin: 0 auto; padding: 0 16px 48px; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; }
main button { position: relative; padding: 0; border: 0; background: var(--tile); aspect-ratio: 1; cursor: zoom-in; overflow: hidden; border-radius: 6px; }
main img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .25s; }
main button:hover img { transform: scale(1.03); }
.play { position: absolute; right: 6px; bottom: 6px; background: rgba(0,0,0,.55); color: #fff; border-radius: 99px; padding: 2px 8px; font-size: 12px; }
#view { position: fixed; inset: 0; background: rgba(0,0,0,.94); display: none; align-items: center; justify-content: center; z-index: 10; }
#view.open { display: flex; }
#view img, #view video { max-width: 100vw; max-height: 100vh; object-fit: contain; }
#view .bar { position: fixed; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; color: #e7e5e4; font-size: 14px; background: linear-gradient(rgba(0,0,0,.5), transparent); }
#view .cap { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; color: #e7e5e4; padding: 14px; background: linear-gradient(transparent, rgba(0,0,0,.6)); }
#view .cap:empty { display: none; }
.nav { position: fixed; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,.12); color: #fff; border: 0; width: 44px; height: 44px; border-radius: 99px; font-size: 22px; cursor: pointer; }
.nav:hover { background: rgba(255,255,255,.25); }
#prev { left: 12px; } #next { right: 12px; }
.bar a, .bar button { color: #e7e5e4; background: none; border: 0; font: inherit; cursor: pointer; text-decoration: none; margin-left: 14px; }
footer { text-align: center; color: var(--muted); font-size: 12px; padding: 0 16px 32px; }
</style>
</head>
<body>
<header>
<h1>${html(title)}</h1>
<div class="meta">${items.length} ${items.length === 1 ? 'item' : 'items'}${range ? ` · ${html(range)}` : ''}</div>
${description ? `<p class="desc">${html(description)}</p>` : ''}
</header>
<main id="grid"></main>
<div id="view" role="dialog" aria-modal="true">
  <div class="bar"><span id="count"></span><span><a id="dl" download>Download</a><button id="close" aria-label="Close">✕</button></span></div>
  <button class="nav" id="prev" aria-label="Previous">‹</button>
  <div id="stage"></div>
  <button class="nav" id="next" aria-label="Next">›</button>
  <div class="cap" id="cap"></div>
</div>
<footer>Shared from Photo Vault</footer>
<script>
const items = ${data};
const grid = document.getElementById('grid'), view = document.getElementById('view'), stage = document.getElementById('stage');
let at = -1;
items.forEach((it, i) => {
  const b = document.createElement('button');
  b.setAttribute('aria-label', 'Open item ' + (i + 1));
  const img = document.createElement('img');
  img.src = it.thumb; img.loading = 'lazy'; img.alt = it.caption || '';
  b.appendChild(img);
  if (it.type === 'video') { const p = document.createElement('span'); p.className = 'play'; p.textContent = '▶'; b.appendChild(p); }
  b.onclick = () => show(i);
  grid.appendChild(b);
});
function show(i) {
  at = (i + items.length) % items.length;
  const it = items[at];
  stage.innerHTML = '';
  const el = document.createElement(it.type === 'video' ? 'video' : 'img');
  el.src = it.src;
  if (it.type === 'video') { el.controls = true; el.autoplay = true; el.playsInline = true; } else el.alt = it.caption || '';
  stage.appendChild(el);
  document.getElementById('count').textContent = (at + 1) + ' / ' + items.length + (it.date ? ' · ' + it.date : '');
  document.getElementById('cap').textContent = it.caption || '';
  document.getElementById('dl').href = it.src;
  view.classList.add('open');
  const near = [items[(at + 1) % items.length], items[(at - 1 + items.length) % items.length]];
  near.forEach((n) => { if (n.type === 'photo') new Image().src = n.src; });
}
function close() { view.classList.remove('open'); stage.innerHTML = ''; at = -1; }
document.getElementById('prev').onclick = () => show(at - 1);
document.getElementById('next').onclick = () => show(at + 1);
document.getElementById('close').onclick = close;
document.addEventListener('keydown', (e) => {
  if (at < 0) return;
  if (e.key === 'ArrowRight') show(at + 1);
  else if (e.key === 'ArrowLeft') show(at - 1);
  else if (e.key === 'Escape') close();
});
let x0 = null;
view.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
view.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1)); x0 = null; });
</script>
</body>
</html>
`
}
