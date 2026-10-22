import type { AssetKind, AssetOrigin } from '@shared/types'

/** Bump when rules change: assets classified with an older version are re-classified in the background. */
export const CLASSIFY_VERSION = 5

export interface ClassifyInput {
  mediaType: 'photo' | 'video'
  mime: string
  width: number | null
  height: number | null
  durationMs: number | null
  hasAudio: boolean | null
  frames: number | null
  cameraMake: string | null
  cameraModel: string | null
  /** Embedded tags: EXIF Software, video encoder/comment/title… */
  tags: Record<string, string>
  /** Every name the file has been seen under. */
  filenames: string[]
  /** Every folder path (inside the source, '/'-separated) it has been seen in. */
  folders: string[]
  /** Google Takeout "googlePhotosOrigin" phone folder names, e.g. "WhatsApp Images". */
  deviceFolders: string[]
  /** Takeout says it came from a shared album / partner sharing. */
  sharedWithMe: boolean
  /**
   * The file carries no capture metadata at all. Photos: no camera, date taken or editing software.
   * Videos: no container creation date and no camera tags (phones always write one; chat apps re-encode without).
   */
  metadataStripped: boolean
}

export type OriginConfidence = 'certain' | 'probable'

/** Sub-groups for probable origins, from the image size apps resize to. */
export type OriginHint = 'whatsapp_size' | 'social_size'

export interface Classification {
  origin: AssetOrigin | null
  originConfidence: OriginConfidence | null
  originHint: OriginHint | null
  originEvidence: string[]
  kind: AssetKind
  kindEvidence: string[]
}

interface OriginRule {
  origin: AssetOrigin
  folder?: RegExp
  file?: RegExp[]
  tag?: RegExp
}

/** Order matters only for ties at the same evidence strength. Patterns are deliberately specific. */
const RULES: OriginRule[] = [
  {
    origin: 'whatsapp',
    folder: /whatsapp/i,
    file: [/^(IMG|VID|AUD|PTT|STK|DOC)-\d{8}-WA\d+/i, /^WhatsApp (Image|Video|Audio|Ptt|GIF) \d{4}-\d{2}-\d{2} at /i]
  },
  { origin: 'telegram', folder: /telegram/i, file: [/^(photo|video)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/i] },
  { origin: 'signal', folder: /^signal$/i, file: [/^signal-\d{4}-\d{2}-\d{2}/i] },
  { origin: 'messenger', folder: /messenger/i, file: [/^received_\d{6,}/i] },
  { origin: 'snapchat', folder: /snapchat/i, file: [/^Snapchat-\d+/i] },
  { origin: 'instagram', folder: /instagram/i, tag: /instagram/i },
  { origin: 'tiktok', folder: /tiktok/i, file: [/tiktok/i], tag: /tiktok|bytedance|aweme|douyin|^vid:/i },
  { origin: 'facebook', folder: /^facebook$/i, file: [/^FB_IMG_\d+/i] },
  { origin: 'twitter', folder: /^twitter$/i },
  {
    origin: 'screen_recording',
    folder: /screen ?record|screenrecord/i,
    file: [/^(screen[_ -]?recording|screenrecorder|rpreplay|screen-\d{8})/i]
  },
  {
    origin: 'screenshot',
    folder: /^(screenshots?|bildschirmfotos|captures d.écran|capturas de pantalla|schermate)$/i,
    file: [/^(screenshot|screen shot|bildschirmfoto|capture d.écran|captura de pantalla|schermata)/i]
  },
  { origin: 'download', folder: /^(downloads?|download manager|téléchargements|descargas)$/i }
]

/** Frame sizes (long×short) WhatsApp re-encodes videos to. */
const WHATSAPP_VIDEO_SIZES = new Set(['640x352', '848x480', '854x480'])

const CAMERA_FOLDER = /^(dcim|camera|\d{3}apple|\d{3}[a-z_]{5}|100andro|opencamera)$/i

/**
 * Names only camera apps produce. Deliberately excludes "IMG_1234": iCloud exports rename
 * everything (WhatsApp images included) to that pattern.
 */
const CAMERA_FILE = [
  /^PXL_\d{8}_\d{6,9}/i, // Google Pixel
  /^(IMG|VID)_\d{8}_\d{6}(?:_\d+)?(?:_HDR)?\.\w+$/i, // Android camera apps (WhatsApp uses IMG-YYYYMMDD-WA)
  /^(DSC_|_DSC|DSCN|DSCF)\d{4}/i, // Nikon, Sony, Fujifilm
  /^(GOPR|GP\d{2}|GX\d{2}|GH\d{2})\d{4}/i, // GoPro
  /^DJI_\d{4}/i // DJI drones
]

function cameraLabel(make: string | null, model: string | null): string {
  if (make && model && !model.toLowerCase().startsWith(make.toLowerCase())) return `${make} ${model}`
  return (model ?? make ?? '').trim()
}

/**
 * Where did this come from, and what kind of thing is it? Deterministic, local and explainable:
 * every label carries the evidence that produced it. Strength order for origin:
 *   1. Google Photos' record of the phone folder it was backed up from (Takeout)
 *   2. the folder it was found in
 *   3. the file name pattern apps use
 *   4. app markers embedded in the file
 *   5. camera make/model in EXIF → camera
 */
export function classifyAsset(input: ClassifyInput): Classification {
  const evidence = new Map<AssetOrigin, string[]>()
  const add = (o: AssetOrigin, e: string): void => {
    const list = evidence.get(o) ?? []
    if (!list.includes(e)) list.push(e)
    evidence.set(o, list)
  }
  let strongest: { origin: AssetOrigin; strength: number } | null = null
  const consider = (o: AssetOrigin, strength: number, e: string): void => {
    add(o, e)
    if (!strongest || strength > strongest.strength) strongest = { origin: o, strength }
  }

  for (const f of input.deviceFolders) {
    for (const r of RULES) if (r.folder?.test(f.trim())) consider(r.origin, 5, `Google Photos backed it up from the phone folder “${f}”`)
    if (CAMERA_FOLDER.test(f.trim())) consider('camera', 5, `Google Photos backed it up from the phone folder “${f}”`)
  }
  for (const path of input.folders) {
    for (const seg of path.split('/').filter(Boolean)) {
      for (const r of RULES) if (r.folder?.test(seg)) consider(r.origin, 4, `Found in a folder named “${seg}”`)
      if (CAMERA_FOLDER.test(seg)) consider('camera', 2, `Found in the camera folder “${seg}”`)
    }
  }
  for (const name of input.filenames) {
    for (const r of RULES) if (r.file?.some((re) => re.test(name))) consider(r.origin, 3, `File name “${name}” matches ${r.origin === 'screenshot' || r.origin === 'screen_recording' ? 'the system pattern' : 'the app’s naming pattern'}`)
  }
  for (const [key, value] of Object.entries(input.tags)) {
    for (const r of RULES) if (r.tag?.test(value)) consider(r.origin, 2, `Embedded ${key.toLowerCase()} tag “${value.slice(0, 60)}”`)
  }
  const cam = cameraLabel(input.cameraMake, input.cameraModel)
  if (cam) consider('camera', 1, `Camera metadata: ${cam}`)
  for (const name of input.filenames) {
    if (CAMERA_FILE.some((re) => re.test(name))) consider('camera', 1, `File name “${name}” matches a camera’s naming pattern`)
    // iPhones save screenshots as IMG_####.PNG; the camera itself never produces PNG.
    if (input.mime === 'image/png' && /^IMG_\d{4}\.png$/i.test(name) && !cam) consider('screenshot', 3, `“${name}” is a PNG with an iPhone name — iPhones save screenshots this way`)
  }
  if (input.sharedWithMe) consider('shared', 2, 'Google Photos lists it as shared with you')

  let origin: AssetOrigin | null = (strongest as { origin: AssetOrigin } | null)?.origin ?? null
  let originConfidence: OriginConfidence | null = origin ? 'certain' : null
  let originHint: OriginHint | null = null
  const originEvidence = origin ? (evidence.get(origin) ?? []) : []
  // Strip-mined files (no camera data) are worth saying out loud for chat-app media.
  if (origin && origin !== 'camera' && !cam && input.mediaType === 'photo') originEvidence.push('No camera metadata (typical of re-sent or saved images)')

  // Nothing direct, but the photo carries no capture metadata at all. Photos straight from a phone
  // camera keep theirs (even through Google Photos downloads); messaging apps and "save image" strip it.
  // This is an inference, so it is labelled 'probable' and its evidence says so. Camera-sized photos
  // (3,000 px or more on the long side) are left unlabelled: chat apps and social sites never send that
  // large, so these are far more likely the owner's own photos that lost their metadata in an edit or export.
  const cameraSized = input.mediaType === 'photo' && Math.max(input.width ?? 0, input.height ?? 0) >= 3000
  if (!origin && input.metadataStripped && !cameraSized) {
    origin = 'received'
    originConfidence = 'probable'
    const w = input.width ?? 0
    const h = input.height ?? 0
    const long = Math.max(w, h)
    if (input.mediaType === 'photo') {
      originEvidence.push('No camera metadata at all — photos taken with a phone camera keep it; chat apps and saved images strip it')
      if (long === 1600 || long === 1599) {
        originHint = 'whatsapp_size'
        originEvidence.push(`${long} px on the long side — the size WhatsApp resizes sent photos to`)
      } else if (long === 2048) {
        originHint = 'social_size'
        originEvidence.push('2048 px on the long side — the size Facebook, Messenger and X save photos at')
      }
    } else {
      originEvidence.push('No recording date in the video — phone cameras always write one; chat apps and downloads re-encode without it')
      if (WHATSAPP_VIDEO_SIZES.has(`${Math.max(w, h)}x${Math.min(w, h)}`)) {
        originHint = 'whatsapp_size'
        originEvidence.push(`${w}×${h} — one of the sizes WhatsApp re-encodes videos to`)
      }
    }
  }

  // Kind
  let kind: AssetKind = input.mediaType === 'video' ? 'video' : 'photo'
  const kindEvidence: string[] = []
  if (input.mediaType === 'video') {
    const short = input.durationMs !== null && input.durationMs <= 30_000
    const gifFolder = input.folders.concat(input.deviceFolders).find((f) => /animated gifs?|\bgifs?\b/i.test(f))
    if (input.hasAudio === false && short) {
      kind = 'loop'
      kindEvidence.push(`No sound track, ${((input.durationMs ?? 0) / 1000).toFixed(1)} s long — how chat apps store GIFs`)
    } else if (gifFolder) {
      kind = 'loop'
      kindEvidence.push(`Found in “${gifFolder}”`)
    }
  } else {
    const animated = (input.frames ?? 1) > 1 && (input.mime === 'image/gif' || input.mime === 'image/webp')
    const stickerName = input.filenames.find((n) => /^STK-\d{8}-WA/i.test(n))
    const stickerFolder = input.folders.concat(input.deviceFolders).find((f) => /stickers?/i.test(f))
    if (input.mime === 'image/webp' && (stickerName || stickerFolder || (input.width === 512 && input.height === 512))) {
      kind = 'sticker'
      kindEvidence.push(stickerName ? `File name “${stickerName}”` : stickerFolder ? `Found in “${stickerFolder}”` : '512×512 WebP, the sticker format')
    } else if (animated) {
      kind = 'animated'
      kindEvidence.push(`${input.frames} frames`)
    }
  }
  return { origin, originConfidence, originHint, originEvidence, kind, kindEvidence }
}

/** Phone folder names recorded by Google Photos in a Takeout sidecar (schema varies, so search for the key). */
export function deviceFoldersFromSidecar(json: unknown): { folders: string[]; shared: boolean } {
  const folders: string[] = []
  let shared = false
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || v === null || typeof v !== 'object') return
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'localFolderName' && typeof val === 'string' && val.trim()) folders.push(val.trim())
      if (k === 'fromSharedAlbum' || k === 'fromPartnerSharing') shared = true
      walk(val, depth + 1)
    }
  }
  walk((json as Record<string, unknown> | null)?.googlePhotosOrigin, 0)
  return { folders, shared }
}
