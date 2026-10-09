// Builds src/core/geo/places.json from GeoNames "cities5000" (CC BY 4.0, https://www.geonames.org):
//   curl -O https://download.geonames.org/export/dump/cities5000.zip && unzip cities5000.zip
//   node scripts/make-places.mjs cities5000.txt
// Keeps towns and cities (not city districts) as [name, countryCode, lat, lon, population].
import { readFileSync, writeFileSync } from 'node:fs'

const rows = []
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const c = line.split('\t')
  if (c.length < 15) continue
  if (c[7] === 'PPLX' || c[7] === 'PPLH') continue // districts, historical places
  rows.push([c[1], c[8], Math.round(Number(c[4]) * 1e4) / 1e4, Math.round(Number(c[5]) * 1e4) / 1e4, Number(c[14]) || 0])
}
rows.sort((a, b) => b[4] - a[4])
writeFileSync(
  new URL('../src/core/geo/places.json', import.meta.url),
  JSON.stringify({ source: 'GeoNames cities5000, CC BY 4.0 (https://www.geonames.org)', rows })
)
console.log(rows.length, 'places')
