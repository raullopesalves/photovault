import type { CaptureTimeSource, SortTimeSource } from '@shared/types'

export const api = window.photoVault

const nf = new Intl.NumberFormat()

export function n(value: number): string {
  return nf.format(value)
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${n(count)} ${count === 1 ? one : many}`
}

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = value / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

/** Timeline dates are wall-clock dates encoded as UTC; always format them in UTC. */
export function monthLabel(month: string): string {
  if (month === 'undated') return 'No date'
  if (month === 'matches') return 'Best matches'
  // A day key (Recently added groups by import day).
  if (month.length === 10) return new Date(`${month}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function wallClock(wall: string): string {
  const d = new Date(`${wall.slice(0, 19)}Z`)
  return d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' })
}

export function sortTimeLabel(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
}

export function isoLocal(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function offsetLabel(minutes: number | null): string {
  if (minutes === null) return ''
  const sign = minutes < 0 ? '−' : '+'
  const m = Math.abs(minutes)
  return `UTC${sign}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** "About 3 min left", "A few seconds left", or "Estimating time…" while there is no honest estimate. */
export function etaLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'Estimating time…'
  if (seconds < 10) return 'A few seconds left'
  if (seconds < 60) return `About ${Math.max(10, Math.round(seconds / 5) * 5)} seconds left`
  if (seconds < 3600) {
    const m = Math.round(seconds / 60)
    return `About ${m} min left`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `About ${h} h ${m} min left` : `About ${h} h left`
}

export function rateLabel(rate: number | null | undefined, unit: 'files' | 'bytes' | null | undefined): string {
  if (!rate || !unit) return ''
  return unit === 'bytes' ? `${bytes(rate)}/s` : `${rate < 10 ? rate.toFixed(1) : Math.round(rate)} files/s`
}

export function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function duration(ms: number | null): string {
  if (ms === null) return ''
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const SOURCE_LABELS: Record<SortTimeSource, string> = {
  exif_original: 'Camera metadata (EXIF date taken)',
  exif_digitized: 'Camera metadata (EXIF date digitised)',
  xmp: 'XMP metadata',
  takeout: 'Google Photos metadata (Takeout)',
  icloud: 'iCloud export details',
  quicktime: 'Video container metadata',
  filename: 'Estimated from the file name',
  exif_modified: 'EXIF modification date (may reflect editing)',
  estimated: 'Estimated from neighbouring files',
  duplicate: 'From a matching copy of this picture',
  manual: 'Set by you',
  file_modified: 'No capture date found — placed by file modified date'
}

export function timeSourceLabel(source: CaptureTimeSource | SortTimeSource | null): string {
  return source ? SOURCE_LABELS[source] : 'Unknown'
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** "takeout-001.zip", "takeout-001.zip and 2 more". */
export function sourcesLabel(sources: string[]): string {
  if (sources.length === 0) return ''
  const first = basename(sources[0] as string)
  return sources.length === 1 ? first : `${first} and ${sources.length - 1} more`
}

export function sourceTypeLabel(type: string): string {
  switch (type) {
    case 'GOOGLE_TAKEOUT':
      return 'Google Photos Takeout'
    case 'ZIP':
      return 'ZIP archive'
    case 'ICLOUD_EXPORT':
      return 'iCloud export'
    default:
      return 'Folder'
  }
}

/** Splits "<archive>.zip!/Takeout/Google Photos/a.jpg" into the archive and the path inside it. */
export function splitArchivePath(path: string, containerPath: string | null): { archive: string | null; inner: string } {
  if (containerPath && path.startsWith(`${containerPath}!/`)) return { archive: containerPath, inner: path.slice(containerPath.length + 2) }
  return { archive: null, inner: path }
}

export function mimeLabel(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/heic': 'HEIC',
    'image/heif': 'HEIF',
    'image/webp': 'WebP',
    'image/gif': 'GIF',
    'image/tiff': 'TIFF',
    'image/avif': 'AVIF',
    'image/bmp': 'BMP',
    'video/mp4': 'MP4',
    'video/quicktime': 'MOV'
  }
  return map[mime] ?? mime.split('/')[1]?.replace(/^x-/, '').toUpperCase() ?? mime
}

/** `rev` (an asset's `rev`) makes the URL change when a rotated or edited rendition replaces the cached one. */
export function mediaUrl(kind: 'thumb' | 'preview' | 'original' | 'playable', id: number, rev?: string | number): string {
  return rev && rev !== '0.0' ? `pv-media://${kind}/${id}?r=${rev}` : `pv-media://${kind}/${id}`
}
