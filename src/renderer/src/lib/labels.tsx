import type { ReactNode } from 'react'
import { Camera, Clapperboard, Download, Image, Images, Inbox, MessageCircle, Repeat, ScreenShare, Send, Smartphone, Sticker, Users, Video } from 'lucide-react'
import type { AssetKind, AssetOrigin } from '@shared/types'
import { t } from './i18n'

const ORIGINS: Record<AssetOrigin | 'unknown', { label: string; clutter: boolean; icon: (c: string) => ReactNode }> = {
  whatsapp: { label: t('WhatsApp'), clutter: true, icon: (c) => <MessageCircle className={c} /> },
  telegram: { label: t('Telegram'), clutter: true, icon: (c) => <Send className={c} /> },
  signal: { label: t('Signal'), clutter: true, icon: (c) => <MessageCircle className={c} /> },
  messenger: { label: t('Messenger'), clutter: true, icon: (c) => <MessageCircle className={c} /> },
  snapchat: { label: t('Snapchat'), clutter: true, icon: (c) => <Smartphone className={c} /> },
  instagram: { label: t('Instagram'), clutter: true, icon: (c) => <Smartphone className={c} /> },
  tiktok: { label: t('TikTok'), clutter: true, icon: (c) => <Clapperboard className={c} /> },
  facebook: { label: t('Facebook'), clutter: true, icon: (c) => <Smartphone className={c} /> },
  twitter: { label: t('X / Twitter'), clutter: true, icon: (c) => <Smartphone className={c} /> },
  screenshot: { label: t('Screenshots'), clutter: true, icon: (c) => <Smartphone className={c} /> },
  screen_recording: { label: t('Screen recordings'), clutter: true, icon: (c) => <ScreenShare className={c} /> },
  download: { label: t('Downloads'), clutter: true, icon: (c) => <Download className={c} /> },
  shared: { label: t('Shared with you'), clutter: false, icon: (c) => <Users className={c} /> },
  received: { label: t('Probably received or saved'), clutter: true, icon: (c) => <Inbox className={c} /> },
  camera: { label: t('Camera'), clutter: false, icon: (c) => <Camera className={c} /> },
  unknown: { label: t('Unknown origin'), clutter: false, icon: (c) => <Images className={c} /> }
}

const KINDS: Record<AssetKind, { label: string; plural: string; icon: (c: string) => ReactNode }> = {
  photo: { label: t('Photo'), plural: t('Photos'), icon: (c) => <Image className={c} /> },
  video: { label: t('Video'), plural: t('Videos'), icon: (c) => <Video className={c} /> },
  loop: { label: t('GIF-like loop'), plural: t('GIF-like loops'), icon: (c) => <Repeat className={c} /> },
  animated: { label: t('Animated image'), plural: t('Animated images'), icon: (c) => <Repeat className={c} /> },
  sticker: { label: t('Sticker'), plural: t('Stickers'), icon: (c) => <Sticker className={c} /> }
}

export function originLabel(o: AssetOrigin | 'unknown' | null): string {
  return ORIGINS[o ?? 'unknown']?.label ?? o ?? t('Unknown')
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
