import { app } from 'electron'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelInfo } from '@shared/types'
import { CAPTION_MODEL } from '@core/ai/caption'
import { CLIP_MODEL } from '@core/ai/clip'
import { FACE_MODELS } from '@core/ai/faces'

/**
 * The on-device AI models, kept in the app's data folder (not the library). They can be loaded from a folder
 * instead of downloaded (a computer that is never online, or a reinstall), and saved to a folder to carry to
 * another computer. The folder layout is the same as the app's own `models` folder:
 *   Xenova/clip-vit-base-patch32/…, onnx-community/Florence-2-base-ft/…, faces/<two .onnx files>.
 */
const MODELS: Array<{ id: ModelInfo['id']; dir: string; files?: Array<{ file: string; bytes: number }> }> = [
  { id: 'smart', dir: CLIP_MODEL },
  { id: 'captions', dir: CAPTION_MODEL },
  { id: 'faces', dir: 'faces', files: Object.values(FACE_MODELS).map((m) => ({ file: m.file, bytes: m.bytes })) }
]

export const modelsDir = (): string => join(app.getPath('userData'), 'models')

function size(path: string): number {
  if (!existsSync(path)) return 0
  const st = statSync(path)
  if (!st.isDirectory()) return st.size
  return readdirSync(path).reduce((s, f) => s + size(join(path, f)), 0)
}

/** A model folder counts as present when it has its weights (.onnx), or both face files at the right size. */
function present(root: string, m: (typeof MODELS)[number]): boolean {
  const dir = join(root, ...m.dir.split('/'))
  if (m.files) return m.files.every((f) => existsSync(join(dir, f.file)) && statSync(join(dir, f.file)).size === f.bytes)
  const onnx = join(dir, 'onnx')
  return existsSync(onnx) && readdirSync(onnx).some((f) => f.endsWith('.onnx'))
}

export function listModels(): ModelInfo[] {
  return MODELS.map((m) => ({ id: m.id, installed: present(modelsDir(), m), bytes: size(join(modelsDir(), ...m.dir.split('/'))) }))
}

/** Where in `folder` the models are: the folder itself, or a "models" / "Photo Vault models" folder inside it. */
function findRoot(folder: string): string | null {
  for (const root of [folder, join(folder, 'models'), join(folder, 'Photo Vault models')]) if (MODELS.some((m) => present(root, m))) return root
  return null
}

/** Copies every model found in `folder` into the app (already installed ones are left alone). */
export async function importModels(folder: string): Promise<{ installed: Array<ModelInfo['id']>; models: ModelInfo[] }> {
  const root = findRoot(folder)
  if (!root) throw new Error('No Photo Vault models were found in that folder.')
  const installed: Array<ModelInfo['id']> = []
  for (const m of MODELS) {
    if (!present(root, m) || present(modelsDir(), m)) continue
    const to = join(modelsDir(), ...m.dir.split('/'))
    await mkdir(to, { recursive: true })
    await cp(join(root, ...m.dir.split('/')), to, { recursive: true, force: false, errorOnExist: false })
    if (present(modelsDir(), m)) installed.push(m.id)
  }
  return { installed, models: listModels() }
}

/** Saves the installed models into "<folder>/Photo Vault models", ready for importModels on another computer. */
export async function exportModels(folder: string): Promise<string> {
  const out = join(folder, 'Photo Vault models')
  let any = false
  for (const m of MODELS) {
    if (!present(modelsDir(), m)) continue
    any = true
    const to = join(out, ...m.dir.split('/'))
    await mkdir(to, { recursive: true })
    await cp(join(modelsDir(), ...m.dir.split('/')), to, { recursive: true, force: true })
  }
  if (!any) throw new Error('No models are installed yet.')
  return out
}
