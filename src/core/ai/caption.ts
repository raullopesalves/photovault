import type { DownloadProgress } from './clip'

/**
 * Automatic descriptions ("A dog sitting in a field with trees in the background.") from Florence-2-base
 * (MIT licence, ~265 MB quantised), run on this computer. Downloaded once into the models folder.
 */
export const CAPTION_MODEL = 'onnx-community/Florence-2-base-ft'

type Transformers = typeof import('@huggingface/transformers')

interface Loaded {
  t: Transformers
  model: Awaited<ReturnType<Transformers['Florence2ForConditionalGeneration']['from_pretrained']>>
  processor: Awaited<ReturnType<Transformers['AutoProcessor']['from_pretrained']>>
  tokenizer: Awaited<ReturnType<Transformers['AutoTokenizer']['from_pretrained']>>
}

const TASK = '<CAPTION>'

export class Captioner {
  private loading: Promise<Loaded> | null = null

  constructor(private readonly cacheDir: string) {}

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
      const [model, processor, tokenizer] = await Promise.all([
        t.Florence2ForConditionalGeneration.from_pretrained(CAPTION_MODEL, { dtype: 'q8', progress_callback }),
        t.AutoProcessor.from_pretrained(CAPTION_MODEL, { progress_callback }),
        t.AutoTokenizer.from_pretrained(CAPTION_MODEL, { progress_callback })
      ])
      return { t, model, processor, tokenizer }
    })()
    this.loading.catch(() => {
      this.loading = null
    })
    return this.loading
  }

  /** One sentence per image (normally the cached thumbnails); null where an image cannot be read. */
  async caption(paths: string[]): Promise<Array<string | null>> {
    const m = await this.load({ allowDownload: false })
    const processor = m.processor as unknown as {
      construct_prompts(task: string): string[]
      (image: unknown): Promise<Record<string, unknown>>
      post_process_generation(text: string, task: string, size: unknown): Record<string, string>
    }
    const text = m.tokenizer(processor.construct_prompts(TASK))
    const out: Array<string | null> = []
    for (const p of paths) {
      try {
        const image = await m.t.RawImage.read(p)
        const ids = await (m.model as unknown as { generate(a: Record<string, unknown>): Promise<unknown> }).generate({
          ...text,
          ...(await processor(image)),
          max_new_tokens: 48
        })
        const decoded = (m.tokenizer.batch_decode(ids as never, { skip_special_tokens: false }) as string[])[0] ?? ''
        out.push(cleanCaption(processor.post_process_generation(decoded, TASK, image.size)[TASK] ?? ''))
      } catch {
        out.push(null)
      }
    }
    return out
  }
}

/** "A dog sitting in a field ." → "A dog sitting in a field." */
export function cleanCaption(s: string): string | null {
  const c = s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim()
  if (!c) return null
  const first = c.charAt(0).toUpperCase() + c.slice(1)
  return /[.!?]$/.test(first) ? first : `${first}.`
}
