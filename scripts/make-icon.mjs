// Renders build/icon.svg to the icons used for packaging: build/icon.png (1024), build/icon.ico (16–256,
// PNG-compressed entries, supported since Windows Vista) and resources/icon.png for the window. Sizes of 32 px and
// below come from build/icon-small.svg, a simpler drawing that stays crisp in the taskbar and title bar.
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sharp = require('sharp')

const render = (size) =>
  size <= 32
    ? sharp('build/icon-small.svg', { density: 72 * 16 }).resize(size, size).png().toBuffer()
    : sharp('build/icon.svg', { density: 300 }).resize(size, size).png().toBuffer()

await sharp(await render(1024)).toFile('build/icon.png')
await sharp(await render(256)).toFile('resources/icon.png')

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(sizes.map(render))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(sizes.length, 4)
const entries = []
let offset = 6 + 16 * sizes.length
sizes.forEach((size, i) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(size === 256 ? 0 : size, 0)
  e.writeUInt8(size === 256 ? 0 : size, 1)
  e.writeUInt16LE(1, 4) // colour planes
  e.writeUInt16LE(32, 6) // bits per pixel
  e.writeUInt32LE(images[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += images[i].length
  entries.push(e)
})
writeFileSync('build/icon.ico', Buffer.concat([header, ...entries, ...images]))
console.log('icons written')
