import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Database } from '../db/database'
import { silentLogger, type Logger } from '../log'

export const LIBRARY_MARKER = 'photovault-library.json'
const LIBRARY_FORMAT = 'photo-vault-library'

interface LibraryMarker {
  format: string
  version: number
  id: string
  createdAt: string
}

export interface LibraryPaths {
  root: string
  originals: string
  thumbnails: string
  database: string
  dbFile: string
  temp: string
  logs: string
}

/** The real, canonical form of a path (long names, real casing on Windows), so paths compare reliably. */
function canonical(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync.native(abs)
  } catch {
    return abs // does not exist (yet)
  }
}

export function libraryPaths(root: string): LibraryPaths {
  const r = canonical(root)
  return {
    root: r,
    originals: join(r, 'originals'),
    thumbnails: join(r, 'thumbnails'),
    database: join(r, 'database'),
    dbFile: join(r, 'database', 'photovault.db'),
    temp: join(r, 'temp'),
    logs: join(r, 'logs')
  }
}

export function isLibrary(root: string): boolean {
  return existsSync(join(root, LIBRARY_MARKER))
}

/**
 * A managed library on disk:
 *   originals/YYYY/MM/…   ordinary files, usable without Photo Vault
 *   thumbnails/           regenerable cache
 *   database/photovault.db
 *   temp/                 in-flight copies (never published until verified)
 *   logs/
 */
export class Library {
  private constructor(
    readonly paths: LibraryPaths,
    readonly db: Database,
    readonly id: string,
    readonly managedLocationId: number,
    readonly logger: Logger
  ) {}

  get root(): string {
    return this.paths.root
  }

  /**
   * Creates a library at `root`. If `root` is a non-empty folder that is not already a library,
   * the library is created in a "Photo Vault Library" sub-folder so we never mix with existing files.
   */
  static create(root: string, logger: Logger = silentLogger): Library {
    let target = resolve(root)
    if (isLibrary(target)) return Library.open(target, logger)
    if (existsSync(target) && readdirSync(target).length > 0) target = join(target, 'Photo Vault Library')
    if (isLibrary(target)) return Library.open(target, logger)

    const paths = libraryPaths(target)
    for (const dir of [paths.root, paths.originals, paths.thumbnails, paths.database, paths.temp, paths.logs]) {
      mkdirSync(dir, { recursive: true })
    }
    const marker: LibraryMarker = { format: LIBRARY_FORMAT, version: 1, id: randomUUID(), createdAt: new Date().toISOString() }
    writeFileSync(join(paths.root, LIBRARY_MARKER), JSON.stringify(marker, null, 2), { flag: 'wx' })
    writeFileSync(
      join(paths.root, 'README.txt'),
      [
        'This folder is a Photo Vault library.',
        '',
        'originals/   Your photos and videos as ordinary files, organised by capture year/month.',
        '             They are never modified by Photo Vault and remain usable without it.',
        'thumbnails/  Preview images. Safe to delete; they are regenerated.',
        'database/    The catalogue (SQLite): metadata, duplicates and where each photo came from.',
        'metadata/    The catalogue as one JSON file (catalogue.json), readable without Photo Vault.',
        '             Each original also has an XMP sidecar next to it (IMG_1234.jpg.xmp) with its date, place,',
        '             tags, albums, people and description, for other photo programs.',
        ''
      ].join('\n'),
      { flag: 'wx' }
    )
    logger.info('library.created', { root: paths.root, id: marker.id })
    return Library.open(paths.root, logger)
  }

  static open(root: string, logger: Logger = silentLogger): Library {
    const paths = libraryPaths(root)
    const markerPath = join(paths.root, LIBRARY_MARKER)
    if (!existsSync(markerPath)) throw new Error(`Not a Photo Vault library: ${paths.root}`)
    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as LibraryMarker
    if (marker.format !== LIBRARY_FORMAT) throw new Error(`Unrecognised library format in ${markerPath}`)
    for (const dir of [paths.originals, paths.thumbnails, paths.database, paths.temp, paths.logs]) {
      mkdirSync(dir, { recursive: true })
    }
    const db = Database.open(paths.dbFile, { preMigrationBackupDir: join(paths.database, 'backups') })
    let location = db.get<{ id: number }>("SELECT id FROM storage_locations WHERE kind = 'MANAGED_LIBRARY' ORDER BY id LIMIT 1")
    if (!location) {
      const now = new Date().toISOString()
      db.tx(() => {
        const r = db.run("INSERT INTO storage_locations (name, kind, root_path, created_at) VALUES ('Photo Vault library', 'MANAGED_LIBRARY', NULL, ?)", [now])
        location = { id: r.lastInsertRowid }
        db.run("INSERT OR REPLACE INTO library_meta (key, value) VALUES ('library_id', ?)", [marker.id])
      })
    }
    // Anything left mid-flight by a crash is marked so the user can see it; nothing is rolled back on disk.
    db.run("UPDATE imports SET status = 'interrupted', completed_at = ? WHERE status IN ('scanning', 'ready', 'importing')", [new Date().toISOString()])
    db.run("UPDATE verifications SET status = 'interrupted', completed_at = ? WHERE status = 'running'", [new Date().toISOString()])
    // temp/ only ever holds Photo Vault's own unverified in-flight copies (*.part); clearing them is safe.
    for (const name of readdirSync(paths.temp)) {
      if (name.endsWith('.part')) rmSync(join(paths.temp, name), { force: true })
    }
    logger.info('library.opened', { root: paths.root })
    return new Library(paths, db, marker.id, location!.id, logger)
  }

  close(): void {
    this.db.close()
  }
}
