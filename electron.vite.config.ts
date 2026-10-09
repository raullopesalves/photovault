import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared'), '@core': resolve('src/core') } },
    // worker.js: worker thread for whole-library computations (see src/main/worker.ts).
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), worker: resolve('src/main/worker.ts') } } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()]
  }
})
