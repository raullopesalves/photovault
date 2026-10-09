import type { PhotoVaultApi } from '@shared/types'

declare global {
  interface Window {
    photoVault: PhotoVaultApi
  }
}

export {}
