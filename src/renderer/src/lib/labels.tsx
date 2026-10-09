import type { ReactNode } from 'react'
import { Camera, Clapperboard, Download, Image, Images, Inbox, MessageCircle, Repeat, ScreenShare, Send, Smartphone, Sticker, Users, Video } from 'lucide-react'
import type { AssetKind, AssetOrigin } from '@shared/types'

const ORIGINS: Record<AssetOrigin | 'unknown', { label: string; clutter: boolean; icon: (c: string) => ReactNode }> = {
  whatsapp: { label: 'WhatsApp', clutter: true, icon: (c) => <MessageCircle className={c} /> },
  telegram: { label: 'Telegram', clutter: true, icon: (c) => <Send className={c} /> },
  signal: { label: 'Signal', clutter: true, icon: (c) => <MessageCircle className={c} /> },
  messenger: { label: 'Messenger', clutter: true, icon: (c) => <MessageCircle className={c} /> },
  snapchat: { label: 'Snapchat', clutter: true, icon: (c) => <Smartphone className={c} /> },
  instagram: { label: 'Instagram', clutter: true, icon: (c) => <Smartphone className={c} /> },
  tiktok: { label: 'TikTok', clutter: true, icon: (c) => <Clapperboard className={c} /> },
  facebook: { label: 'Facebook', clutter: true, icon: (c) => <Smartphone className={c} /> },
  twitter: { label: 'X / Twitter', clutter: true, icon: (c) => <Smartphone className={c} /> },
  screenshot: { label: 'Screenshots', clutter: true, icon: (c) => <Smartphone className={c} /> },
  screen_recording: { label: 'Screen recordings', clutter: true, icon: (c) => <ScreenShare className={c} /> },
  download: { label: 'Downloads', clutter: true, icon: (c) => <Download className={c} /> },
  shared: { label: 'Shared with you', clutter: false, icon: (c) => <Users className={c} /> },
  received: { label: 'Probably received or saved', clutter: true, icon: (c) => <Inbox className={c} /> },
  camera: { label: 'Camera', clutter: false, icon: (c) => <Camera className={c} /> },
  unknown: { label: 'Unknown origin', clutter: false, icon: (c) => <Images className={c} /> }
}

const KINDS: Record<AssetKind, { label: string; plural: string; icon: (c: string) => ReactNode }> = {
  photo: { label: 'Photo', plural: 'Photos', icon: (c) => <Image className={c} /> },
  video: { label: 'Video', plural: 'Videos', icon: (c) => <Video className={c} /> },
  loop: { label: 'GIF-like loop', plural: 'GIF-like loops', icon: (c) => <Repeat className={c} /> },
  animated: { label: 'Animated image', plural: 'Animated images', icon: (c) => <Repeat className={c} /> },
  sticker: { label: 'Sticker', plural: 'Stickers', icon: (c) => <Sticker className={c} /> }
}

export function originLabel(o: AssetOrigin | 'unknown' | null): string {
  return ORIGINS[o ?? 'unknown']?.label ?? o ?? 'Unknown'
}

export function originIcon(o: AssetOrigin | 'unknown' | null, className = 'size-4'): ReactNode {
  return (ORIGINS[o ?? 'unknown'] ?? ORIGINS.unknown).icon(className)
}

/** Origins that are usually clutter (chat apps, screenshots, downloads), as opposed to your own camera. */
export function isClutterOrigin(o: AssetOrigin | 'unknown'): boolean {
  return ORIGINS[o]?.clutter ?? false
}

export function kindLabel(k: AssetKind | null, plural = false): string {
  if (!k) return ''
  return plural ? KINDS[k].plural : KINDS[k].label
}

export function kindIcon(k: AssetKind, className = 'size-4'): ReactNode {
  return KINDS[k].icon(className)
}
