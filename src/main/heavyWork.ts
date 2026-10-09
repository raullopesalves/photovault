import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { DownloadProgress } from '@core/ai/clip'
import type { ClusterResult } from '@core/ai/people'
import type { WorkerMessage, WorkerTask } from './worker'

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  onProgress?: (p: unknown) => void
}

/** One lazily started worker thread (see worker.ts) shared by all heavy computations. */
export class HeavyWork {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()

  private get(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(join(__dirname, 'worker.js'))
    w.on('message', (m: WorkerMessage) => {
      const p = this.pending.get(m.id)
      if (!p) return
      if (m.kind === 'progress') return p.onProgress?.(m.progress)
      this.pending.delete(m.id)
      if (m.kind === 'done') p.resolve(m.result)
      else p.reject(new Error(m.error))
    })
    const failAll = (error: string): void => {
      for (const p of this.pending.values()) p.reject(new Error(error))
      this.pending.clear()
      this.worker = null
    }
    w.on('error', (err) => failAll(err.message))
    w.on('exit', () => failAll('worker exited'))
    w.unref()
    this.worker = w
    return w
  }

  private call<T>(task: WorkerTask, onProgress?: (p: unknown) => void): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
      this.get().postMessage({ id, ...task })
    })
  }

  nearDuplicateGroups(dbFile: string): Promise<{ key: string; groups: number[][] }> {
    return this.call({ task: 'nearDuplicateGroups', dbFile })
  }

  clipLoad(cacheDir: string, allowDownload: boolean, onProgress?: (p: DownloadProgress) => void): Promise<void> {
    return this.call({ task: 'clipLoad', cacheDir, allowDownload }, onProgress as (p: unknown) => void)
  }

  /** Image vectors as raw float32 bytes (null where an image could not be read). */
  clipEmbed(cacheDir: string, paths: string[]): Promise<Array<Uint8Array | null>> {
    return this.call({ task: 'clipEmbed', cacheDir, paths })
  }

  clipSearch(cacheDir: string, dbFile: string, text: string, limit: number): Promise<Array<{ id: number; score: number }>> {
    return this.call({ task: 'clipSearch', cacheDir, dbFile, text, limit })
  }

  /** Ids classified as each target label (zero-shot over `labels`), most certain first. */
  clipClassify(cacheDir: string, dbFile: string, labels: string[], targets: number[], minP: number): Promise<number[][]> {
    return this.call({ task: 'clipClassify', cacheDir, dbFile, labels, targets, minP })
  }

  /** Faces per image: vectors as float32 bytes, or an error for unreadable images. */
  faceScan(
    modelsDir: string,
    items: Array<{ path: string; rotation: number }>
  ): Promise<Array<{ faces: Array<{ x: number; y: number; w: number; h: number; score: number; quality: number; vec: Uint8Array; crop: Uint8Array }> } | { error: string }>> {
    return this.call({ task: 'faceScan', modelsDir, items })
  }

  /** Faces inside a marked area (lower confidence bar), in whole-picture fractions. */
  faceRegion(
    modelsDir: string,
    path: string,
    rotation: number,
    box: { x: number; y: number; w: number; h: number }
  ): Promise<Array<{ x: number; y: number; w: number; h: number; score: number; quality: number; vec: Uint8Array; crop: Uint8Array }>> {
    return this.call({ task: 'faceRegion', modelsDir, path, rotation, box })
  }

  faceCluster(dbFile: string): Promise<ClusterResult> {
    return this.call({ task: 'faceCluster', dbFile })
  }

  stop(): void {
    void this.worker?.terminate()
    this.worker = null
  }
}
