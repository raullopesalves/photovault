import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { migrations, runMigrations, schemaVersion } from './migrations'

export type Param = SQLInputValue | boolean | undefined
export type Params = Param[] | Record<string, Param>

function normalise(value: Param): SQLInputValue {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

/**
 * Thin wrapper over node:sqlite with a statement cache and a transaction helper.
 * node:sqlite is built into Node/Electron, so there is no native module to rebuild
 * per Electron ABI, and tests run against exactly the same engine as the app.
 */
export class Database {
  private readonly statements = new Map<string, StatementSync>()

  constructor(readonly raw: DatabaseSync) {}

  /**
   * Opens (and migrates) a database. With `preMigrationBackupDir`, an existing database that is about to be
   * upgraded is first copied there, so a schema change can always be rolled back.
   */
  static open(file: string, opts: { preMigrationBackupDir?: string } = {}): Database {
    const raw = new DatabaseSync(file)
    raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `)
    const db = new Database(raw)
    if (opts.preMigrationBackupDir) {
      db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
      const current = schemaVersion(db)
      const latest = Math.max(...migrations.map((m) => m.version))
      if (current > 0 && current < latest) {
        raw.exec('PRAGMA wal_checkpoint(TRUNCATE)') // everything in the main file before copying it
        mkdirSync(opts.preMigrationBackupDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        copyFileSync(file, join(opts.preMigrationBackupDir, `photovault-v${current}-before-upgrade-${stamp}.db`))
      }
    }
    runMigrations(db)
    // Keep the query planner's statistics current (cheap; analyses only tables that changed a lot).
    try {
      raw.exec('PRAGMA optimize=0x10002')
    } catch {
      /* statistics are an optimisation only */
    }
    return db
  }

  private statement(sql: string): StatementSync {
    let stmt = this.statements.get(sql)
    if (!stmt) {
      stmt = this.raw.prepare(sql)
      this.statements.set(sql, stmt)
    }
    return stmt
  }

  private bind<T>(sql: string, params: Params | undefined, fn: (stmt: StatementSync, args: SQLInputValue[] | [Record<string, SQLInputValue>]) => T): T {
    const stmt = this.statement(sql)
    if (params === undefined) return fn(stmt, [])
    if (Array.isArray(params)) return fn(stmt, params.map(normalise))
    const named: Record<string, SQLInputValue> = {}
    for (const [k, v] of Object.entries(params)) named[k] = normalise(v)
    return fn(stmt, [named])
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
    return this.bind(sql, params, (stmt, args) => {
      const r = stmt.run(...(args as SQLInputValue[]))
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
    })
  }

  get<T>(sql: string, params?: Params): T | undefined {
    return this.bind(sql, params, (stmt, args) => stmt.get(...(args as SQLInputValue[])) as T | undefined)
  }

  all<T>(sql: string, params?: Params): T[] {
    return this.bind(sql, params, (stmt, args) => stmt.all(...(args as SQLInputValue[])) as T[])
  }

  /** Runs fn inside a transaction. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.raw.isTransaction) return fn()
    this.raw.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.raw.exec('COMMIT')
      return result
    } catch (err) {
      if (this.raw.isTransaction) this.raw.exec('ROLLBACK')
      throw err
    }
  }

  close(): void {
    this.statements.clear()
    if (this.raw.isOpen) this.raw.close()
  }
}
