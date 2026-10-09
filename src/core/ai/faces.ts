import sharp from 'sharp'

/**
 * On-device face detection and recognition with OpenCV Zoo models (both freely licensed):
 *   - YuNet 2023mar (MIT): face boxes + 5 landmarks, 640×640 input.
 *   - SFace 2021dec (Apache-2.0): 128-d identity vector from a 112×112 face aligned on its landmarks.
 * Pre/post-processing follows OpenCV's FaceDetectorYN / FaceRecognizerSF so results match the reference.
 * Nothing leaves the computer; the models (~39 MB) are downloaded once when the user turns People on.
 */
export const FACE_MODELS = {
  detector: {
    file: 'face_detection_yunet_2023mar.onnx',
    url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
    bytes: 232_589,
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'
  },
  recognizer: {
    file: 'face_recognition_sface_2021dec.onnx',
    url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx',
    bytes: 38_696_353,
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'
  }
} as const

/** Bump when detection/embedding changes, so libraries are rescanned. */
export const FACE_VERSION = 1
export const FACE_DIM = 128

const DET = 640
const SCORE_MIN = 0.85
const NMS_IOU = 0.3
/** Faces smaller than this (px, on the ≤ 1600 px working image) are too small to recognise reliably. */
const MIN_FACE = 36
const WORK = 1600

/** ArcFace/SFace 112×112 landmark template: eyes, nose tip, mouth corners. */
const TEMPLATE = [38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041]

export interface DetectedFace {
  /** Box normalised to the (oriented, rotated) image: 0–1. */
  x: number
  y: number
  w: number
  h: number
  score: number
  /** Detection confidence × size factor: better faces lead clusters and become covers. */
  quality: number
  vec: Float32Array
  /** Square face crop (WebP, 160 px) for the People page. */
  crop: Buffer
}

type Ort = typeof import('onnxruntime-node')
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>

interface RawFace {
  x1: number
  y1: number
  x2: number
  y2: number
  score: number
  kps: number[]
}

function iou(a: RawFace, b: RawFace): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  const inter = ix * iy
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
  return union > 0 ? inter / union : 0
}

/** Least-squares similarity transform (Umeyama, no reflection) mapping `src` points onto `dst`. */
export function similarityTransform(src: number[], dst: number[]): [number, number, number, number, number, number] {
  const n = src.length / 2
  let sx = 0
  let sy = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    sx += src[2 * i] as number
    sy += src[2 * i + 1] as number
    dx += dst[2 * i] as number
    dy += dst[2 * i + 1] as number
  }
  sx /= n
  sy /= n
  dx /= n
  dy /= n
  let a = 0
  let b = 0
  let norm = 0
  for (let i = 0; i < n; i++) {
    const px = (src[2 * i] as number) - sx
    const py = (src[2 * i + 1] as number) - sy
    const qx = (dst[2 * i] as number) - dx
    const qy = (dst[2 * i + 1] as number) - dy
    a += px * qx + py * qy
    b += px * qy - py * qx
    norm += px * px + py * py
  }
  const s = norm > 0 ? Math.hypot(a, b) / norm : 1
  const theta = Math.atan2(b, a)
  const c = s * Math.cos(theta)
  const d = s * Math.sin(theta)
  // [x', y'] = [[c, -d], [d, c]] · [x, y] + [tx, ty]
  return [c, -d, dx - (c * sx - d * sy), d, c, dy - (d * sx + c * sy)]
}

export class FaceEngine {
  private loading: Promise<{ ort: Ort; det: Session; rec: Session }> | null = null

  constructor(private readonly modelsDir: string) {}

  private load(): Promise<{ ort: Ort; det: Session; rec: Session }> {
    this.loading ??= (async () => {
      const ort = await import('onnxruntime-node')
      const opts = { logSeverityLevel: 3 as const, intraOpNumThreads: 2 }
      const { join } = await import('node:path')
      const det = await ort.InferenceSession.create(join(this.modelsDir, FACE_MODELS.detector.file), opts)
      const rec = await ort.InferenceSession.create(join(this.modelsDir, FACE_MODELS.recognizer.file), opts)
      return { ort, det, rec }
    })()
    this.loading.catch(() => {
      this.loading = null
    })
    return this.loading
  }

  /** Finds and fingerprints the faces in an image file. `rotation` = the user's extra rotation (degrees). */
  /**
   * Finds and fingerprints faces. With `region` (fractions of the picture) only that area is searched, with a
   * lower confidence bar — for a face the user marked by hand.
   */
  async analyze(path: string, rotation = 0, opts: { region?: { x: number; y: number; w: number; h: number }; minScore?: number } = {}): Promise<DetectedFace[]> {
    const m = await this.load()
    // Working image: EXIF-oriented (+ user rotation), at most 1600 px, RGB.
    let img = sharp(path, { failOn: 'none' }).rotate().resize(WORK, WORK, { fit: 'inside', withoutEnlargement: true }).removeAlpha()
    if (rotation) img = sharp(await img.png({ compressionLevel: 0 }).toBuffer()).rotate(rotation)
    const { data: rgb, info } = await img.raw().toBuffer({ resolveWithObject: true })
    const W = info.width
    const H = info.height
    const ch = info.channels

    // Area to search: the whole picture, or the marked region with a margin.
    let ox = 0
    let oy = 0
    let SW = W
    let SH = H
    let srcImg = sharp(rgb, { raw: { width: W, height: H, channels: ch as 3 } })
    if (opts.region) {
      const r = opts.region
      const mx = r.w * 0.4
      const my = r.h * 0.4
      ox = Math.max(0, Math.floor((r.x - mx) * W))
      oy = Math.max(0, Math.floor((r.y - my) * H))
      SW = Math.max(8, Math.min(W - ox, Math.ceil((r.w + 2 * mx) * W)))
      SH = Math.max(8, Math.min(H - oy, Math.ceil((r.h + 2 * my) * H)))
      srcImg = sharp(await srcImg.extract({ left: ox, top: oy, width: SW, height: SH }).raw().toBuffer(), { raw: { width: SW, height: SH, channels: ch as 3 } })
    }
    const minScore = opts.minScore ?? SCORE_MIN

    // Detector input: letterboxed 640×640, BGR, 0–255, NCHW.
    const scale = Math.min(DET / SW, DET / SH)
    const dw = Math.round(SW * scale)
    const dh = Math.round(SH * scale)
    const small = await srcImg.resize(dw, dh, { fit: 'fill' }).raw().toBuffer()
    const input = new Float32Array(3 * DET * DET)
    const plane = DET * DET
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const s = (y * dw + x) * ch
        const d = y * DET + x
        input[d] = small[s + 2] as number // B
        input[plane + d] = small[s + 1] as number // G
        input[2 * plane + d] = small[s] as number // R
      }
    }
    const out = await m.det.run({ input: new m.ort.Tensor('float32', input, [1, 3, DET, DET]) })
    const raw: RawFace[] = []
    for (const stride of [8, 16, 32]) {
      const cls = out[`cls_${stride}`]?.data as Float32Array
      const obj = out[`obj_${stride}`]?.data as Float32Array
      const box = out[`bbox_${stride}`]?.data as Float32Array
      const kps = out[`kps_${stride}`]?.data as Float32Array
      const cols = DET / stride
      const rows = DET / stride
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          const score = Math.sqrt(Math.min(1, Math.max(0, cls[i] as number)) * Math.min(1, Math.max(0, obj[i] as number)))
          if (score < minScore) continue
          const cx = (c + (box[i * 4] as number)) * stride
          const cy = (r + (box[i * 4 + 1] as number)) * stride
          const w = Math.exp(box[i * 4 + 2] as number) * stride
          const h = Math.exp(box[i * 4 + 3] as number) * stride
          const k: number[] = []
          for (let n = 0; n < 5; n++) k.push(ox + (((kps[i * 10 + 2 * n] as number) + c) * stride) / scale, oy + (((kps[i * 10 + 2 * n + 1] as number) + r) * stride) / scale)
          raw.push({ x1: ox + (cx - w / 2) / scale, y1: oy + (cy - h / 2) / scale, x2: ox + (cx + w / 2) / scale, y2: oy + (cy + h / 2) / scale, score, kps: k })
        }
      }
    }
    raw.sort((a, b) => b.score - a.score)
    const kept: RawFace[] = []
    for (const f of raw) if (kept.every((k) => iou(k, f) < NMS_IOU)) kept.push(f)

    const faces: DetectedFace[] = []
    for (const f of kept) {
      const side = Math.min(f.x2 - f.x1, f.y2 - f.y1)
      if (side < (opts.region ? 12 : MIN_FACE)) continue
      faces.push({
        x: Math.max(0, f.x1 / W),
        y: Math.max(0, f.y1 / H),
        w: Math.min(1, (f.x2 - f.x1) / W),
        h: Math.min(1, (f.y2 - f.y1) / H),
        score: f.score,
        quality: f.score * Math.min(1, side / 120),
        vec: await this.embed(m, rgb, W, H, ch, f.kps),
        crop: await this.crop(rgb, W, H, ch, f)
      })
    }
    return faces
  }

  /** Square crop around the face with some margin, for display. */
  private async crop(rgb: Buffer, W: number, H: number, ch: number, f: RawFace): Promise<Buffer> {
    const side = Math.min(W, H, Math.round(Math.max(f.x2 - f.x1, f.y2 - f.y1) * 1.6))
    const left = Math.min(W - side, Math.max(0, Math.round((f.x1 + f.x2) / 2 - side / 2)))
    const top = Math.min(H - side, Math.max(0, Math.round((f.y1 + f.y2) / 2 - side / 2)))
    return sharp(rgb, { raw: { width: W, height: H, channels: ch as 3 } })
      .extract({ left, top, width: side, height: side })
      .resize(160, 160)
      .webp({ quality: 82 })
      .toBuffer()
  }

  /** Aligns the face on the 112×112 template (bilinear warp) and runs SFace: RGB, 0–255, NCHW. */
  private async embed(m: { ort: Ort; rec: Session }, rgb: Buffer, W: number, H: number, ch: number, kps: number[]): Promise<Float32Array> {
    // Transform from image → template; invert to sample the image for every template pixel.
    const [a, b, tx, c, d, ty] = similarityTransform(kps, TEMPLATE)
    const det = a * d - b * c
    const ia = d / det
    const ib = -b / det
    const ic = -c / det
    const id = a / det
    const S = 112
    const input = new Float32Array(3 * S * S)
    for (let v = 0; v < S; v++) {
      for (let u = 0; u < S; u++) {
        const px = u - tx
        const py = v - ty
        const x = ia * px + ib * py
        const y = ic * px + id * py
        const x0 = Math.floor(x)
        const y0 = Math.floor(y)
        const fx = x - x0
        const fy = y - y0
        for (let k = 0; k < 3; k++) {
          const at = (xx: number, yy: number): number =>
            xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : (rgb[(yy * W + xx) * ch + k] as number)
          const val = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy
          input[k * S * S + v * S + u] = val
        }
      }
    }
    const out = await m.rec.run({ data: new m.ort.Tensor('float32', input, [1, 3, S, S]) })
    const v = out.fc1?.data as Float32Array
    let n = 0
    for (let i = 0; i < v.length; i++) n += (v[i] as number) ** 2
    n = Math.sqrt(n) || 1
    return Float32Array.from(v, (x) => x / n)
  }
}
