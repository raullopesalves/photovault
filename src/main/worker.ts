// Worker thread for work that would otherwise stall the main process (and with it every IPC answer to the
// window): whole-library computations and on-device AI. It opens its own READ-ONLY connections to the
// catalogue and only computes; the main process writes any result.
import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { Database } from '@core/db/database'
import { computeNearDuplicateGroups, nearDuplicateStamp } from '@core/repo/nearDuplicates'
import { CLIP_DIM, Clip, selectMatches, zeroShot } from '@core/ai/clip'
import { Captioner } from '@core/ai/caption'
import { FaceEngine } from '@core/ai/faces'
import { clusterFaces } from '@core/ai/people'
import { loadClusterContext, loadClusterFaces } from '@core/repo/people'

export type WorkerTask =
  | { task: 'setOffline'; offline: boolean }
  /** Tests only: an uncaught error that kills this thread. */
  | { task: 'testCrash' }
  | { task: 'nearDuplicateGroups'; dbFile: string }
  | { task: 'clipLoad'; cacheDir: string; allowDownload: boolean }
  | { task: 'clipEmbed'; cacheDir: string; paths: string[] }
  | { task: 'clipSearch'; cacheDir: string; dbFile: string; text: string; limit: number }
  | { task: 'captionLoad'; cacheDir: string; allowDownload: boolean }
  | { task: 'caption'; cacheDir: string; paths: string[] }
  | { task: 'clipClassify'; cacheDir: string; dbFile: string; labels: string[]; targets: number[]; minP: number }
  | { task: 'faceScan'; modelsDir: string; items: Array<{ path: string; rotation: number }> }
  | { task: 'faceCluster'; dbFile: string }
  | { task: 'faceRegion'; modelsDir: string; path: string; rotation: number; box: { x: number; y: number; w: number; h: number } }

// Offline mode (see main/network.ts): model downloads go through fetch, which fails while it is on.
// Models already on disk load without any request.
let offline = (workerData as { offline?: boolean } | null)?.offline === true
const realFetch = globalThis.fetch
globalThis.fetch = ((...args: Parameters<typeof fetch>) =>
  offline
    ? Promise.reject(new Error('Offline mode is on, so nothing is downloaded. Turn it off in Settings, or load the models from a folder (Settings → AI models).'))
    : realFetch(...args)) as typeof fetch

export type WorkerMessage =
  | { id: number; kind: 'done'; result: unknown }
  | { id: number; kind: 'error'; error: string }
  | { id: number; kind: 'progress'; progress: unknown }

let clip: Clip | null = null
let captioner: Captioner | null = null
let faceEngine: FaceEngine | null = null
const clipFor = (cacheDir: string): Clip => (clip ??= new Clip(cacheDir))

/** Vectors of the open catalogue, reloaded when embeddings change. */
let vectors: { dbFile: string; stamp: string; ids: Int32Array; data: Float32Array } | null = null

function loadVectors(dbFile: string): NonNullable<typeof vectors> {
  const raw = new DatabaseSync(dbFile, { readOnly: true })
  try {
    raw.exec('PRAGMA busy_timeout = 5000')
    const stamp = JSON.stringify(raw.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS t FROM asset_embeddings').get())
    if (vectors && vectors.dbFile === dbFile && vectors.stamp === stamp) return vectors
    const rows = raw.prepare('SELECT asset_id, vec FROM asset_embeddings').all() as Array<{ asset_id: number; vec: Uint8Array }>
    const ids = new Int32Array(rows.length)
    const data = new Float32Array(rows.length * CLIP_DIM)
    rows.forEach((r, i) => {
      ids[i] = r.asset_id
      data.set(new Float32Array(r.vec.buffer, r.vec.byteOffset, CLIP_DIM), i * CLIP_DIM)
    })
    vectors = { dbFile, stamp, ids, data }
    return vectors
  } finally {
    raw.close()
  }
}

async function run(id: number, t: WorkerTask): Promise<unknown> {
  switch (t.task) {
    case 'testCrash':
      setTimeout(() => {
        throw new Error('test: worker crash')
      })
      return true
    case 'nearDuplicateGroups': {
      const raw = new DatabaseSync(t.dbFile, { readOnly: true })
      try {
        raw.exec('PRAGMA busy_timeout = 5000')
        const db = new Database(raw)
        // Stamp and data from one snapshot, so the result matches its key.
        raw.exec('BEGIN')
        const key = nearDuplicateStamp(db)
        const groups = computeNearDuplicateGroups(db)
        raw.exec('COMMIT')
        return { key, groups }
      } finally {
        raw.close()
      }
    }
    case 'faceScan': {
      faceEngine ??= new FaceEngine(t.modelsDir)
      const out = []
      for (const item of t.items) {
        try {
          const faces = await faceEngine.analyze(item.path, item.rotation)
          out.push({ faces: faces.map((f) => ({ ...f, vec: Buffer.from(f.vec.buffer, f.vec.byteOffset, f.vec.byteLength) })) })
        } catch (err) {
          out.push({ error: err instanceof Error ? err.message : String(err) })
        }
      }
      return out
    }
    case 'faceRegion': {
      faceEngine ??= new FaceEngine(t.modelsDir)
      const faces = await faceEngine.analyze(t.path, t.rotation, { region: t.box, minScore: 0.5 })
      return faces.map((f) => ({ ...f, vec: Buffer.from(f.vec.buffer, f.vec.byteOffset, f.vec.byteLength) }))
    }
    case 'faceCluster': {
      const raw = new DatabaseSync(t.dbFile, { readOnly: true })
      try {
        raw.exec('PRAGMA busy_timeout = 5000')
        const db = new Database(raw)
        return clusterFaces(loadClusterFaces(db), {}, loadClusterContext(db))
      } finally {
        raw.close()
      }
    }
    case 'setOffline':
      offline = t.offline
      return true
    case 'clipLoad':
      await clipFor(t.cacheDir).load({
        allowDownload: t.allowDownload,
        onProgress: (progress) => parentPort?.postMessage({ id, kind: 'progress', progress } satisfies WorkerMessage)
      })
      return true
    case 'captionLoad':
      await (captioner ??= new Captioner(t.cacheDir)).load({
        allowDownload: t.allowDownload,
        onProgress: (progress) => parentPort?.postMessage({ id, kind: 'progress', progress } satisfies WorkerMessage)
      })
      return true
    case 'caption':
      return (captioner ??= new Captioner(t.cacheDir)).caption(t.paths)
    case 'clipEmbed': {
      const vecs = await clipFor(t.cacheDir).embedImages(t.paths)
      return vecs.map((v) => (v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : null))
    }
    case 'clipSearch': {
      const q = await clipFor(t.cacheDir).embedText(t.text)
      const v = loadVectors(t.dbFile)
      const n = v.ids.length
      const scores = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let s = 0
        const o = i * CLIP_DIM
        for (let k = 0; k < CLIP_DIM; k++) s += (v.data[o + k] as number) * (q[k] as number)
        scores[i] = s
      }
      return selectMatches(v.ids, scores, t.limit)
    }
    case 'clipClassify': {
      const c = clipFor(t.cacheDir)
      const labels: Float32Array[] = []
      for (const text of t.labels) labels.push(await c.embedText(text))
      const v = loadVectors(t.dbFile)
      const found = zeroShot(v.ids, v.data, labels, t.targets, t.minP)
      return t.targets.map((k) => (found.get(k) ?? []).map((r) => r.id))
    }
  }
}

parentPort?.on('message', (msg: { id: number } & WorkerTask) => {
  run(msg.id, msg).then(
    (result) => parentPort?.postMessage({ id: msg.id, kind: 'done', result } satisfies WorkerMessage),
    (err: unknown) => parentPort?.postMessage({ id: msg.id, kind: 'error', error: err instanceof Error ? err.message : String(err) } satisfies WorkerMessage)
  )
})
