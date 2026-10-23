import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Library } from './library'

/**
 * Metadata outside the app (1.0, D96). Everything people add or correct in Photo Vault (dates, places, favourites,
 * descriptions, tags, albums, people) is written in open formats, so the library stays usable without the app:
 *
 * - an XMP sidecar next to each original, `IMG_1234.jpg.xmp` (the darktable/digiKam convention, which keeps
 *   IMG_1234.jpg and IMG_1234.heic apart), with the standard fields other photo programs read;
 * - one `metadata/catalogue.json` with the whole catalogue: every item, album, smart album and person.
 *
 * Originals are never touched. Sidecars are rewritten only when their content changes.
 */

export const SIDECAR_EXT = '.xmp'
export const CATALOGUE_FILE = 'metadata/catalogue.json'
/** Photo Vault's own XMP namespace, for facts no standard field holds. */
export const PV_NS = 'https://github.com/raullopesalves/photovault/ns/1.0/'

export interface AssetMetadata {
  id: number
  sha256: string
  /** Original, relative to the library root (POSIX). */
  file: string
  originalFilename: string
  mediaType: 'photo' | 'video'
  /** Wall-clock capture time, as recorded (YYYY-MM-DDTHH:MM:SS[.sss]); null when unknown. */
  captureTime: string | null
  captureOffsetMinutes: number | null
  dateSource: string | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  locationSource: string | null
  place: string | null
  camera: string | null
  favorite: boolean
  hidden: boolean
  inBin: boolean
  description: string | null
  autoDescription: string | null
  /** User rotation, degrees clockwise (non-destructive). */
  rotation: number
  /** The original's own EXIF orientation (1–8), if any. */
  orientation: number | null
  origin: string | null
  kind: string | null
  tags: string[]
  albums: string[]
  people: string[]
  livePhotoOf: number | null
  versionOf: number | null
  foundAt: string[]
}

interface AssetRow {
  id: number
  sha256: string
  relative_path: string
  original_filename: string
  media_type: 'photo' | 'video'
  capture_time: string | null
  capture_offset_minutes: number | null
  capture_time_source: string | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  location_source: string | null
  place: string | null
  camera_make: string | null
  camera_model: string | null
  favorite: number
  hidden: number
  trashed_at: string | null
  description: string | null
  rotation: number
  orientation: number | null
  origin: string | null
  kind: string | null
  live_photo_of: number | null
  version_of: number | null
}

function groupBy(rows: Array<{ asset_id: number; v: string }>): Map<number, string[]> {
  const m = new Map<number, string[]>()
  for (const r of rows) {
    const list = m.get(r.asset_id)
    if (list) {
      if (!list.includes(r.v)) list.push(r.v)
    } else m.set(r.asset_id, [r.v])
  }
  return m
}

/** Everything the sidecars and the catalogue export record, for the given items (all items when `ids` is null). */
export function assetMetadata(library: Library, ids: number[] | null): AssetMetadata[] {
  const db = library.db
  const only = ids ? 'AND a.id IN (SELECT value FROM json_each(?))' : ''
  const params = ids ? [JSON.stringify(ids)] : []
  const rows = db.all<AssetRow>(
    `SELECT a.id, a.sha256, f.relative_path, a.original_filename, a.media_type, a.capture_time, a.capture_offset_minutes,
            a.capture_time_source, a.latitude, a.longitude, a.altitude, a.location_source, a.place, a.camera_make, a.camera_model,
            a.favorite, a.hidden, a.trashed_at, a.description, a.rotation, a.orientation, a.origin, a.kind, a.live_photo_of, a.version_of
       FROM assets a JOIN files f ON f.asset_id = a.id AND f.role = 'original' AND f.storage_location_id = ?
      WHERE 1 = 1 ${only}
      ORDER BY a.id`,
    [library.managedLocationId, ...params]
  )
  if (rows.length === 0) return []
  const scope = ids ? 'WHERE x.asset_id IN (SELECT value FROM json_each(?))' : ''
  const tags = groupBy(db.all(`SELECT x.asset_id, x.tag AS v FROM asset_tags x ${scope} ORDER BY x.tag`, params))
  const albums = groupBy(db.all(`SELECT x.asset_id, al.name AS v FROM album_assets x JOIN albums al ON al.id = x.album_id ${scope} ORDER BY al.name`, params))
  const people = groupBy(
    db.all(`SELECT x.asset_id, p.name AS v FROM faces x JOIN persons p ON p.id = x.person_id ${scope ? `${scope} AND` : 'WHERE'} p.name IS NOT NULL AND p.hidden = 0 ORDER BY p.name`, params)
  )
  const captions = new Map(
    db.all<{ asset_id: number; v: string }>(`SELECT x.asset_id, x.caption AS v FROM asset_captions x ${scope ? `${scope} AND` : 'WHERE'} x.caption IS NOT NULL`, params).map((r) => [r.asset_id, r.v])
  )
  const found = groupBy(db.all(`SELECT x.asset_id, x.source_path AS v FROM provenance x ${scope} ORDER BY x.first_seen_at`, params))
  return rows.map((r) => ({
    id: r.id,
    sha256: r.sha256,
    file: r.relative_path,
    originalFilename: r.original_filename,
    mediaType: r.media_type,
    captureTime: r.capture_time,
    captureOffsetMinutes: r.capture_offset_minutes,
    dateSource: r.capture_time_source,
    latitude: r.latitude,
    longitude: r.longitude,
    altitude: r.altitude,
    locationSource: r.location_source,
    place: r.place,
    camera: [r.camera_make, r.camera_model].filter(Boolean).join(' ') || null,
    favorite: r.favorite === 1,
    hidden: r.hidden === 1,
    inBin: r.trashed_at !== null,
    description: r.description,
    autoDescription: captions.get(r.id) ?? null,
    rotation: r.rotation,
    orientation: r.orientation,
    origin: r.origin,
    kind: r.kind,
    tags: tags.get(r.id) ?? [],
    albums: albums.get(r.id) ?? [],
    people: people.get(r.id) ?? [],
    livePhotoOf: r.live_photo_of,
    versionOf: r.version_of,
    foundAt: found.get(r.id) ?? []
  }))
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** XMP GPS coordinate: "DDD,MM.mmmmmmK". */
function gps(value: number, pos: string, neg: string): string {
  const abs = Math.abs(value)
  const deg = Math.floor(abs)
  const min = (abs - deg) * 60
  return `${deg},${min.toFixed(6)}${value >= 0 ? pos : neg}`
}

/** "+01:00" from minutes east of UTC. */
function offset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const m = Math.abs(minutes)
  return `${sign}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * The EXIF orientation that shows the picture the way Photo Vault does: the original's own orientation turned by the
 * user's rotation. Mirrored originals (2, 4, 5, 7) are left as they are (rotation stays in pv:Rotation).
 */
export function combinedOrientation(original: number | null, rotation: number): number | null {
  if (!rotation) return null
  const cycle = [1, 6, 3, 8] // each step is 90° clockwise
  const start = cycle.indexOf(original ?? 1)
  if (start < 0) return null
  return cycle[(start + Math.round(rotation / 90)) % 4] ?? null
}

const bag = (tag: string, values: string[], kind: 'Bag' | 'Seq' = 'Bag'): string =>
  values.length ? `   <${tag}><rdf:${kind}>${values.map((v) => `<rdf:li>${esc(v)}</rdf:li>`).join('')}</rdf:${kind}></${tag}>\n` : ''

/** The XMP sidecar for one item. Standard fields first; Photo Vault's own facts in the pv: namespace. */
export function xmpDocument(m: AssetMetadata): string {
  const attrs: string[] = []
  if (m.captureTime) {
    const when = `${m.captureTime}${m.captureOffsetMinutes !== null ? offset(m.captureOffsetMinutes) : ''}`
    attrs.push(`exif:DateTimeOriginal="${esc(when)}"`, `photoshop:DateCreated="${esc(when)}"`, `xmp:CreateDate="${esc(when)}"`)
  }
  if (m.latitude !== null && m.longitude !== null) {
    attrs.push(`exif:GPSLatitude="${gps(m.latitude, 'N', 'S')}"`, `exif:GPSLongitude="${gps(m.longitude, 'E', 'W')}"`, 'exif:GPSVersionID="2.3.0.0"')
    if (m.altitude !== null) attrs.push(`exif:GPSAltitude="${Math.round(Math.abs(m.altitude) * 100)}/100"`, `exif:GPSAltitudeRef="${m.altitude < 0 ? 1 : 0}"`)
  }
  if (m.favorite) attrs.push('xmp:Rating="5"')
  const orientation = m.mediaType === 'photo' ? combinedOrientation(m.orientation, m.rotation) : null
  if (orientation) attrs.push(`tiff:Orientation="${orientation}"`)
  attrs.push(
    `pv:AssetId="${m.id}"`,
    `pv:SHA256="${m.sha256}"`,
    `pv:OriginalFilename="${esc(m.originalFilename)}"`,
    `pv:Favourite="${m.favorite ? 'True' : 'False'}"`,
    `pv:Hidden="${m.hidden ? 'True' : 'False'}"`,
    `pv:InBin="${m.inBin ? 'True' : 'False'}"`
  )
  if (m.rotation) attrs.push(`pv:Rotation="${m.rotation}"`)
  if (m.dateSource) attrs.push(`pv:DateSource="${esc(m.dateSource)}"`)
  if (m.locationSource) attrs.push(`pv:LocationSource="${esc(m.locationSource)}"`)
  if (m.place) attrs.push(`pv:Place="${esc(m.place)}"`)
  if (m.origin) attrs.push(`pv:Origin="${esc(m.origin)}"`)

  const hierarchy = [...m.tags.map((t) => `Tags|${t}`), ...m.albums.map((a) => `Albums|${a}`), ...m.people.map((p) => `People|${p}`)]
  let body = ''
  if (m.description) body += `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(m.description)}</rdf:li></rdf:Alt></dc:description>\n`
  body += bag('dc:subject', m.tags)
  body += bag('lr:hierarchicalSubject', hierarchy)
  body += bag('digiKam:TagsList', hierarchy.map((h) => h.replace(/\|/g, '/')), 'Seq')
  body += bag('Iptc4xmpExt:PersonInImage', m.people)
  body += bag('pv:Albums', m.albums)
  if (m.autoDescription) body += `   <pv:AutoDescription>${esc(m.autoDescription)}</pv:AutoDescription>\n`

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Photo Vault">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
    xmlns:digiKam="http://www.digikam.org/ns/1.0/"
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmlns:pv="${PV_NS}"
    ${attrs.join('\n    ')}>
${body}  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`
}

/** Absolute path of an item's sidecar. */
export function sidecarPath(library: Library, file: string): string {
  return join(library.root, ...file.split('/')) + SIDECAR_EXT
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path).catch(async (err) => {
    await unlink(tmp).catch(() => undefined)
    throw err
  })
}

/** Writes the sidecars of these items where their content changed. Returns how many files were written. */
export async function writeSidecars(library: Library, ids: number[]): Promise<number> {
  let written = 0
  for (const m of assetMetadata(library, ids)) {
    const path = sidecarPath(library, m.file)
    const xml = xmpDocument(m)
    try {
      if (existsSync(path) && readFileSync(path, 'utf8') === xml) continue
    } catch {
      /* unreadable: rewrite it */
    }
    await writeAtomically(path, xml)
    written++
  }
  return written
}

/** Removes the sidecar of an original that left the library (permanent delete). */
export async function removeSidecar(absoluteOriginal: string): Promise<void> {
  await unlink(absoluteOriginal + SIDECAR_EXT).catch(() => undefined)
}

const README = `Photo Vault metadata
====================

Everything added or corrected in Photo Vault, in open formats, so this library is usable without the app.

catalogue.json   The whole catalogue: every item (file, dates, places, favourite, hidden, description, tags,
                 albums, people, automatic description, where it was found), every album, smart album and person.

Next to each original in originals/ there is also an XMP sidecar, IMG_1234.jpg.xmp, which photo programs such as
digiKam, darktable, Lightroom and exiftool read: date taken (exif:DateTimeOriginal), location (exif:GPS*),
favourite (xmp:Rating 5), description (dc:description), tags (dc:subject), albums and people as keywords
(lr:hierarchicalSubject "Albums|…", "People|…"), people's names (Iptc4xmpExt:PersonInImage) and Photo Vault's
own facts (namespace ${PV_NS}).

Photo Vault rewrites these files itself; edits made to them elsewhere are not read back.
`

/** Writes metadata/catalogue.json (and its README) for the whole library. */
export async function writeCatalogueExport(library: Library, appVersion: string | null = null): Promise<{ assets: number }> {
  const db = library.db
  const dir = join(library.root, 'metadata')
  mkdirSync(dir, { recursive: true })
  const assets = assetMetadata(library, null)
  const albums = db.all<{ id: number; name: string; description: string | null; kind: string; created_at: string }>(
    'SELECT id, name, description, kind, created_at FROM albums ORDER BY name'
  )
  const members = db.all<{ album_id: number; asset_id: number }>('SELECT album_id, asset_id FROM album_assets ORDER BY album_id, sort_order, asset_id')
  const people = db.all<{ id: number; name: string | null; hidden: number }>('SELECT id, name, hidden FROM persons ORDER BY name')
  const faces = db.all<{ person_id: number; asset_id: number }>('SELECT DISTINCT person_id, asset_id FROM faces WHERE person_id IS NOT NULL ORDER BY person_id, asset_id')
  const smart = db.all<{ id: number; name: string; query_json: string }>('SELECT id, name, query_json FROM smart_albums ORDER BY name')
  const byAlbum = new Map<number, number[]>()
  for (const m of members) byAlbum.set(m.album_id, [...(byAlbum.get(m.album_id) ?? []), m.asset_id])
  const byPerson = new Map<number, number[]>()
  for (const f of faces) byPerson.set(f.person_id, [...(byPerson.get(f.person_id) ?? []), f.asset_id])
  const doc = {
    format: 'photo-vault-catalogue',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: appVersion ? `Photo Vault ${appVersion}` : 'Photo Vault',
    note: 'Times are wall-clock as recorded by the camera; captureOffsetMinutes is the UTC offset when known. Paths are relative to the library folder.',
    assets,
    albums: albums.map((a) => ({ id: a.id, name: a.name, description: a.description, kind: a.kind, createdAt: a.created_at, assets: byAlbum.get(a.id) ?? [] })),
    smartAlbums: smart.map((s) => ({ id: s.id, name: s.name, query: JSON.parse(s.query_json) as unknown })),
    people: people.map((p) => ({ id: p.id, name: p.name, hidden: p.hidden === 1, assets: byPerson.get(p.id) ?? [] }))
  }
  await writeAtomically(join(library.root, CATALOGUE_FILE), JSON.stringify(doc, null, 1))
  if (!existsSync(join(dir, 'README.txt'))) await writeAtomically(join(dir, 'README.txt'), README)
  return { assets: assets.length }
}

/**
 * Keeps the sidecars and the catalogue export current: rewrites the sidecars of items the database triggers marked in
 * `metadata_dirty` (in batches, so a first run over a large library stays responsive), then the catalogue file.
 */
export class MetadataExporter {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private stopped = false
  private catalogueDue = false
  private catalogueWrittenAt = 0
  private catalogueAssets = -1

  /**
   * `catalogueEveryMs`: the catalogue file (megabytes on a large library) is rewritten at most this often while changes
   * keep coming (descriptions mark items for hours); sidecars follow within `intervalMs`.
   */
  constructor(
    private readonly library: Library,
    private readonly appVersion: string | null = null,
    private readonly intervalMs = 15_000,
    private readonly catalogueEveryMs = 10 * 60_000
  ) {}

  start(): void {
    // Once per start, so changes made just before the app last quit are never left out of the file.
    this.catalogueDue = true
    this.schedule(2_000)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
  }

  private schedule(ms: number): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick().finally(() => this.schedule(this.intervalMs)), ms)
    this.timer.unref?.()
  }

  /** Writes everything pending now, the catalogue included. Safe to call at any time; concurrent calls share one run. */
  flush(): Promise<void> {
    this.running ??= this.run(true).finally(() => {
      this.running = null
    })
    return this.running
  }

  private tick(): Promise<void> {
    this.running ??= this.run(false).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(force: boolean): Promise<void> {
    const db = this.library.db
    let sidecars = 0
    for (;;) {
      if (this.stopped) return
      const ids = db.all<{ asset_id: number }>('SELECT asset_id FROM metadata_dirty ORDER BY asset_id LIMIT 200').map((r) => r.asset_id)
      if (ids.length === 0) break
      try {
        sidecars += await writeSidecars(this.library, ids)
      } catch (err) {
        this.library.logger.warn('metadata.sidecars_failed', { error: err instanceof Error ? err.message : String(err) })
        return // try again on the next round
      }
      // Clear only what was written; anything changed meanwhile is marked again by its trigger.
      db.run('DELETE FROM metadata_dirty WHERE asset_id IN (SELECT value FROM json_each(?))', [JSON.stringify(ids)])
      this.catalogueDue = true
    }
    if (sidecars > 0) this.library.logger.info('metadata.sidecars_written', { count: sidecars })
    // Items added or deleted (imports, permanent deletes) show at once; other changes at most every catalogueEveryMs.
    const count = this.library.db.get<{ n: number }>("SELECT COUNT(DISTINCT asset_id) AS n FROM files WHERE role = 'original'")?.n ?? 0
    const waited = Date.now() - this.catalogueWrittenAt >= this.catalogueEveryMs
    if (this.catalogueDue && !this.stopped && (force || waited || count !== this.catalogueAssets)) {
      try {
        const r = await writeCatalogueExport(this.library, this.appVersion)
        this.catalogueDue = false
        this.catalogueWrittenAt = Date.now()
        this.catalogueAssets = count
        this.library.logger.info('metadata.catalogue_written', r)
      } catch (err) {
        this.library.logger.warn('metadata.catalogue_failed', { error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}
