import type { Readable } from 'node:stream'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

export interface ZipEntryInfo {
  /** Decoded entry path inside the archive ('/'-separated). */
  name: string
  /** Why this entry must not be read (unsafe path, encrypted, ...); null when it is fine. */
  problem: string | null
  size: number
  crc32: number
  mtime: Date | null
  isDirectory: boolean
}

/**
 * Read-only view of a ZIP archive. Entries are only ever *streamed* (for hashing or copying into
 * the library's temp folder) – never extracted to their own paths – so entry names cannot cause
 * path traversal. Names are still validated and unsafe entries are reported, not read.
 * Filenames are decoded per entry (instead of by yauzl) so one malformed name cannot abort the whole archive.
 */
export class ZipArchive {
  private readonly byName = new Map<string, Entry>()

  private constructor(
    readonly path: string,
    private readonly zip: ZipFile,
    readonly entries: ZipEntryInfo[]
  ) {}

  static async open(path: string): Promise<ZipArchive> {
    const zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true })
    const entries: ZipEntryInfo[] = []
    const raw: Array<[ZipEntryInfo, Entry]> = []
    await new Promise<void>((resolve, reject) => {
      zip.on('entry', (entry: Entry) => {
        let name: string
        let problem: string | null = null
        try {
          name = yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, false)
          problem = yauzl.validateFileName(name)
        } catch (err) {
          name = entry.fileNameRaw.toString('latin1')
          problem = `Unreadable entry name (${err instanceof Error ? err.message : String(err)})`
        }
        name = name.replace(/\\/g, '/')
        if (!problem && name.split('/').some((seg) => seg === '..')) problem = 'Unsafe path inside archive'
        if (!problem && entry.isEncrypted()) problem = 'Encrypted archive entry'
        let mtime: Date | null = null
        try {
          const d = entry.getLastModDate()
          mtime = Number.isFinite(d.getTime()) ? d : null
        } catch {
          mtime = null
        }
        const info: ZipEntryInfo = {
          name,
          problem,
          size: entry.uncompressedSize,
          crc32: entry.crc32,
          mtime,
          isDirectory: name.endsWith('/')
        }
        entries.push(info)
        raw.push([info, entry])
        zip.readEntry()
      })
      zip.on('end', () => resolve())
      zip.on('error', reject)
      zip.readEntry()
    })
    const archive = new ZipArchive(path, zip, entries)
    for (const [info, entry] of raw) if (!info.problem && !archive.byName.has(info.name)) archive.byName.set(info.name, entry)
    return archive
  }

  async openEntry(name: string): Promise<Readable> {
    const entry = this.byName.get(name)
    if (!entry) throw new Error(`Entry not found in archive: ${name}`)
    return this.zip.openReadStreamPromise(entry)
  }

  async readEntry(name: string, maxBytes: number): Promise<Buffer> {
    const entry = this.byName.get(name)
    if (!entry) throw new Error(`Entry not found in archive: ${name}`)
    if (entry.uncompressedSize > maxBytes) throw new Error(`Entry too large to read into memory: ${name}`)
    const stream = await this.zip.openReadStreamPromise(entry)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
  }

  close(): void {
    this.zip.close()
  }
}

/** Keeps archives open for the duration of one operation (archives are re-read by path). */
export class ZipPool {
  private readonly open = new Map<string, Promise<ZipArchive>>()

  get(path: string): Promise<ZipArchive> {
    let p = this.open.get(path)
    if (!p) {
      p = ZipArchive.open(path)
      this.open.set(path, p)
      p.catch(() => this.open.delete(path))
    }
    return p
  }

  async closeAll(): Promise<void> {
    for (const p of this.open.values()) {
      try {
        ;(await p).close()
      } catch {
        // already failed to open
      }
    }
    this.open.clear()
  }
}

export const ZIP_SEPARATOR = '!/'

/** Unique, human-readable path for an archive entry, e.g. C:\Takeout\takeout-001.zip!/Takeout/Google Photos/x.jpg */
export function zipEntryPath(zipPath: string, entryName: string): string {
  return `${zipPath}${ZIP_SEPARATOR}${entryName}`
}
