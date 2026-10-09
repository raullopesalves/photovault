import type { AssetQuery, MapCluster } from '@shared/types'
import type { Library } from '../library/library'
import { assetWhere } from './filters'
import { placeLabel } from '../geo/places'

/**
 * Server-side clustering for the map: items with a location inside the visible box are bucketed into a grid
 * whose cells are ~60 px at the current zoom, so the renderer only ever draws a few hundred markers, even for
 * 100k geotagged items. Each cluster reports its centre, count, bounds and a recent item to show as its cover.
 */
export function mapClusters(library: Library, view: { south: number; west: number; north: number; east: number; zoom: number }, query?: AssetQuery): MapCluster[] {
  const zoom = Math.max(0, Math.min(22, Math.round(view.zoom)))
  // Web-Mercator tiles are 256 px wide and 360° / 2^zoom; a cell is ~1/4 tile.
  const cell = 360 / 2 ** zoom / 4
  const w = assetWhere({ ...query, bbox: [view.south, view.west, view.north, view.east] })
  const rows = library.db.all<{
    gy: number
    gx: number
    count: number
    lat: number
    lon: number
    south: number
    west: number
    north: number
    east: number
    cover: number
  }>(
    `SELECT CAST((a.latitude + 180) / ? AS INTEGER) AS gy, CAST((a.longitude + 360) / ? AS INTEGER) AS gx, COUNT(*) AS count,
            AVG(a.latitude) AS lat, AVG(a.longitude) AS lon,
            MIN(a.latitude) AS south, MIN(a.longitude) AS west, MAX(a.latitude) AS north, MAX(a.longitude) AS east,
            MAX(a.id) AS cover
       FROM assets a ${w.sql}
      GROUP BY gy, gx
      LIMIT 3000`,
    [cell, cell, ...w.params]
  )
  // Cover: the most recent photo of the cluster (videos have thumbnails too, but photos read better).
  const coverStmt = (r: (typeof rows)[number]): number =>
    library.db.get<{ id: number }>(
      `SELECT a.id FROM assets a ${assetWhere({ ...query, bbox: [r.south, r.west, r.north, r.east] }).sql}
        AND a.thumb_status = 'ready' ORDER BY a.media_type = 'photo' DESC, a.sort_time DESC LIMIT 1`,
      assetWhere({ ...query, bbox: [r.south, r.west, r.north, r.east] }).params
    )?.id ?? r.cover
  return rows.map((r) => ({
    lat: r.lat,
    lon: r.lon,
    count: r.count,
    bounds: [r.south, r.west, r.north, r.east] as [number, number, number, number],
    coverId: rows.length <= 400 ? coverStmt(r) : r.cover,
    place: rows.length <= 400 ? placeLabel(r.lat, r.lon) : null
  }))
}

/** How many items have a location (for the empty state and the sidebar). */
export function locatedCount(library: Library, query?: AssetQuery): number {
  const w = assetWhere({ ...query, located: true })
  return library.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM assets a ${w.sql}`, w.params)?.n ?? 0
}
