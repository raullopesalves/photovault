import type { Library } from '../library/library'
import { PLACES_VERSION, placeLabel } from './places'

/** Looks up place names for located items that do not have one yet (a few thousand per call). Returns how many. */
export function fillPlaces(library: Library, limit = 3000): number {
  const db = library.db
  // A newer bundled list: look every place name up again (once).
  if (db.get<{ value: string }>("SELECT value FROM library_settings WHERE key = 'places_version'")?.value !== PLACES_VERSION) {
    db.tx(() => {
      db.run('UPDATE assets SET place = NULL WHERE place IS NOT NULL')
      db.run("INSERT INTO library_settings (key, value) VALUES ('places_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [PLACES_VERSION])
    })
  }
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
