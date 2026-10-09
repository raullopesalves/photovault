export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, data?: Record<string, unknown>): void
}

export type LogSink = (line: string) => void

/** Structured JSON-lines logger. One line per event, easy to grep and to parse later. */
export function createLogger(sinks: LogSink[] = []): Logger {
  const log = (level: LogLevel, event: string, data?: Record<string, unknown>): void => {
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, event, ...data }
    for (const [k, v] of Object.entries(entry)) if (v instanceof Error) entry[k] = { message: v.message, stack: v.stack }
    const line = JSON.stringify(entry)
    for (const sink of sinks) sink(line)
  }
  return {
    log,
    info: (e, d) => log('info', e, d),
    warn: (e, d) => log('warn', e, d),
    error: (e, d) => log('error', e, d)
  }
}

export const silentLogger: Logger = createLogger([])
