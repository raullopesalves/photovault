/**
 * On-device image/text embeddings with CLIP (ViT-B/32, 8-bit quantised ONNX, ~150 MB) through transformers.js
 * and onnxruntime. Photos never leave the computer: only the model files are downloaded, once, from
 * Hugging Face into `cacheDir`, and only after the user turns Smart search on.
 * Vectors are L2-normalised, so the dot product of an image and a text vector is their cosine similarity.
 */
export const CLIP_MODEL = 'Xenova/clip-vit-base-patch32'
export const CLIP_DIM = 512

export interface DownloadProgress {
  file: string
  loaded: number
  total: number
}

type Transformers = typeof import('@huggingface/transformers')
type Loaded = {
  t: Transformers
  processor: Awaited<ReturnType<Transformers['AutoProcessor']['from_pretrained']>>
  tokenizer: Awaited<ReturnType<Transformers['AutoTokenizer']['from_pretrained']>>
  vision: Awaited<ReturnType<Transformers['CLIPVisionModelWithProjection']['from_pretrained']>>
  text: Awaited<ReturnType<Transformers['CLIPTextModelWithProjection']['from_pretrained']>>
}

function normalise(v: ArrayLike<number>): Float32Array {
  let n = 0
  for (let i = 0; i < v.length; i++) n += (v[i] as number) ** 2
  n = Math.sqrt(n) || 1
  return Float32Array.from(v as ArrayLike<number>, (x) => x / n)
}

export class Clip {
  private loading: Promise<Loaded> | null = null

  constructor(private readonly cacheDir: string) {}

  /** Loads the model, downloading it first if needed (and allowed). */
  load(opts: { allowDownload: boolean; onProgress?: (p: DownloadProgress) => void }): Promise<Loaded> {
    if (this.loading) return this.loading
    this.loading = (async () => {
      const t = await import('@huggingface/transformers')
      t.env.cacheDir = this.cacheDir
      t.env.allowRemoteModels = opts.allowDownload
      t.env.allowLocalModels = false
      const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }): void => {
        if (p.status === 'progress' && p.file) opts.onProgress?.({ file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 })
      }
      const [processor, tokenizer, vision, text] = await Promise.all([
        t.AutoProcessor.from_pretrained(CLIP_MODEL, { progress_callback }),
        t.AutoTokenizer.from_pretrained(CLIP_MODEL, { progress_callback }),
        t.CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, { dtype: 'q8', progress_callback }),
        t.CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, { dtype: 'q8', progress_callback })
      ])
      return { t, processor, tokenizer, vision, text }
    })()
    this.loading.catch(() => {
      this.loading = null
    })
    return this.loading
  }

  /** Embeds images (normally the cached 512 px thumbnails). A failed image yields null. */
  async embedImages(paths: string[]): Promise<Array<Float32Array | null>> {
    const m = await this.load({ allowDownload: false })
    const out: Array<Float32Array | null> = []
    for (const p of paths) {
      try {
        const image = await m.t.RawImage.read(p)
        const { image_embeds } = (await m.vision(await m.processor(image))) as { image_embeds: { data: Float32Array } }
        out.push(normalise(image_embeds.data))
      } catch {
        out.push(null)
      }
    }
    return out
  }

  async embedText(text: string): Promise<Float32Array> {
    const m = await this.load({ allowDownload: false })
    const tokens = m.tokenizer([text], { padding: true, truncation: true })
    const { text_embeds } = (await m.text(tokens)) as { text_embeds: { data: Float32Array } }
    return normalise(text_embeds.data)
  }
}

/**
 * Picks the matches from cosine scores. CLIP scores are only meaningful relative to each other, so the cut-off
 * adapts to the library: clearly above the typical score (mean + 3 σ), at most `limit`, and never empty
 * when something stands out at all.
 */
export function selectMatches(ids: Int32Array, scores: Float32Array, limit = 400): Array<{ id: number; score: number }> {
  const n = scores.length
  if (n === 0) return []
  let mean = 0
  for (let i = 0; i < n; i++) mean += scores[i] as number
  mean /= n
  let variance = 0
  for (let i = 0; i < n; i++) variance += ((scores[i] as number) - mean) ** 2
  const sd = Math.sqrt(variance / n)
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (scores[b] as number) - (scores[a] as number))
  const cut = mean + 3 * sd
  const out: Array<{ id: number; score: number }> = []
  for (const i of order) {
    if (out.length >= limit) break
    const s = scores[i] as number
    if (s < cut && out.length >= Math.min(12, n)) break
    out.push({ id: ids[i] as number, score: s })
  }
  return out
}
