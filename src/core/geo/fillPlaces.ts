import type { Library } from '../library/library'
import { placeLabel } from './places'

/** Looks up place names for located items that do not have one yet (a few thousand per call). Returns how many. */
export function fillPlaces(library: Library, limit = 3000): number {
  const db = library.db
  const rows = db.all<{ id: number; latitude: number; longitude: number }>(
    'SELECT id, latitude, longitude FROM assets WHERE place IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL LIMIT ?',
    [limit]
  )
  if (rows.length === 0) return 0
  db.tx(() => {
    for (const r of rows) db.run('UPDATE assets SET place = ? WHERE id = ?', [placeLabel(r.latitude, r.longitude) ?? '', r.id])
  })
  return rows.length
}

/** Fills everything still missing in small steps, yielding between them. */
export async function fillPlacesInBackground(library: Library, isCurrent: () => boolean): Promise<void> {
  while (isCurrent() && fillPlaces(library) > 0) await new Promise((r) => setTimeout(r, 20))
}
