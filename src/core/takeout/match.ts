import { posix } from 'node:path'

/**
 * Matches media files to Google Takeout JSON sidecars. Takeout names sidecars inconsistently:
 *   IMG_1234.jpg            -> IMG_1234.jpg.json | IMG_1234.jpg.supplemental-metadata.json
 *   long names              -> truncated to ~51 chars: very_long_name_….jp.json | ….jpg.supplemental-met.json
 *   duplicates in a folder  -> IMG_1234(1).jpg  -> IMG_1234.jpg(1).json | IMG_1234.jpg.supplemental-metadata(1).json
 *   edited copies           -> IMG_1234-edited.jpg uses IMG_1234.jpg's sidecar
 *   some exports            -> IMG_1234.json (no media extension)
 *   live photos             -> IMG_1234.MP4 shares IMG_1234.HEIC's sidecar
 * As a last resort the sidecar's "title" (the original upload name) is compared with the media name.
 * Matching is per folder path *inside* the export, so sidecars and media split across several ZIPs still match.
 */

const SUPPLEMENTAL = 'supplemental-metadata'
const EDITED_SUFFIXES = ['-edited', '-bearbeitet', '-modifié', '-modificato', '-editado', '-bewerkt', '-redigerad', '-muokattu', '-edytowane']

export interface SidecarKey {
  base: string
  n: number
}

/** Parses a sidecar filename into the media name it describes (possibly truncated) and its duplicate number. */
export function parseSidecarName(jsonName: string): SidecarKey | null {
  if (!/\.json$/i.test(jsonName)) return null
  let base = jsonName.slice(0, -5)
  let n = 0
  const num = /\((\d+)\)$/.exec(base)
  if (num) {
    n = Number(num[1])
    base = base.slice(0, -num[0].length)
  }
  const dot = base.lastIndexOf('.')
  if (dot > 0) {
    const seg = base.slice(dot + 1)
    // ".supplemental-metadata" or any truncation of it (".supplemental-met", ".sup", ".s"). A very short
    // segment only counts when a media extension precedes it, so "IMG.s" style names are not misread.
    const isSupplemental = seg.length > 0 && SUPPLEMENTAL.startsWith(seg.toLowerCase())
    if (isSupplemental && (base.slice(0, dot).includes('.') || seg.length >= 3)) base = base.slice(0, dot)
  }
  // "IMG_1234.jpg.supplemental-metadata(1)" puts the number after the suffix – handled above;
  // "IMG_1234.jpg(1).supplemental-metadata" is also seen in the wild.
  const num2 = /\((\d+)\)$/.exec(base)
  if (num2 && n === 0) {
    n = Number(num2[1])
    base = base.slice(0, -num2[0].length)
  }
  if (!base) return null
  return { base, n }
}

/** The name a media file had before Takeout added "(n)" or an "-edited" suffix. */
export function mediaKey(mediaName: string): { name: string; n: number; edited: boolean } {
  const ext = posix.extname(mediaName)
  let stem = ext ? mediaName.slice(0, -ext.length) : mediaName
  // Takeout writes "IMG_1234-edited(1).jpg": the duplicate number comes after the edited suffix.
  let n = 0
  const num = /\((\d+)\)$/.exec(stem)
  if (num) {
    n = Number(num[1])
    stem = stem.slice(0, -num[0].length)
  }
  let edited = false
  for (const suffix of EDITED_SUFFIXES) {
    if (stem.toLowerCase().endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length)
      edited = true
      break
    }
  }
  return { name: `${stem}${ext}`, n, edited }
}

export interface SidecarCandidate<T> {
  jsonName: string
  key: SidecarKey
  title: string | null
  value: T
}

/** All sidecars of one export, grouped by their folder path inside the export. */
export class SidecarIndex<T> {
  private readonly byDir = new Map<string, Array<SidecarCandidate<T>>>()

  add(dir: string, jsonName: string, title: string | null, value: T): void {
    const key = parseSidecarName(jsonName)
    if (!key) return
    const list = this.byDir.get(dir) ?? []
    list.push({ jsonName, key, title, value })
    this.byDir.set(dir, list)
  }

  get size(): number {
    let n = 0
    for (const l of this.byDir.values()) n += l.length
    return n
  }

  match(dir: string, mediaName: string): SidecarCandidate<T> | null {
    const list = this.byDir.get(dir)
    if (!list || list.length === 0) return null
    const { name, n } = mediaKey(mediaName)
    const lower = name.toLowerCase()
    const ext = posix.extname(name)
    const stem = (ext ? name.slice(0, -ext.length) : name).toLowerCase()
    const sameN = list.filter((c) => c.key.n === n)

    // 1. exact
    const exact = sameN.find((c) => c.key.base.toLowerCase() === lower)
    if (exact) return exact
    // 2. sidecar without the media extension
    const noExt = sameN.find((c) => c.key.base.toLowerCase() === stem)
    if (noExt) return noExt
    // 3. truncated sidecar name: longest base that is a prefix of the media name
    let best: SidecarCandidate<T> | null = null
    for (const c of sameN) {
      const b = c.key.base.toLowerCase()
      if (b.length >= 20 && lower.startsWith(b) && (!best || b.length > best.key.base.length)) best = c
    }
    if (best) return best
    // 4. title recorded inside the sidecar
    if (n === 0) {
      const byTitle = list.filter((c) => c.title !== null && c.title.toLowerCase() === lower)
      if (byTitle.length === 1) return byTitle[0] as SidecarCandidate<T>
    }
    // 5. live-photo companion: same stem, different extension, only one candidate
    const sameStem = sameN.filter((c) => {
      const b = c.key.base.toLowerCase()
      const bExt = posix.extname(b)
      return bExt !== '' && b.slice(0, -bExt.length) === stem
    })
    if (sameStem.length === 1) return sameStem[0] as SidecarCandidate<T>
    return null
  }
}
