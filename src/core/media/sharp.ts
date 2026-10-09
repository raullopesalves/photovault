import sharp from 'sharp'

// libvips caches open file handles; on Windows that locks originals and thumbnails
// (they could not be moved/renamed by the user while Photo Vault runs). Disable it.
sharp.cache(false)

export default sharp
export type { Sharp } from 'sharp'
