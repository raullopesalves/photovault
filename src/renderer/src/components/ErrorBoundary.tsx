import { Component, type ErrorInfo, type ReactNode } from 'react'
import { api } from '../lib/format'
import { t } from '../lib/i18n'
import { Mark } from './Mark'

/** Sends a renderer error to the library's log (main process). Never throws. */
export function reportError(kind: string, err: unknown, extra?: { componentStack?: string | null; view?: string }): void {
  const e = err instanceof Error ? err : new Error(String(err))
  try {
    void api.logRendererError({ kind, message: e.message, stack: e.stack ?? null, componentStack: extra?.componentStack ?? null, view: extra?.view ?? null }).catch(() => {})
  } catch {
    /* the bridge itself is gone: nothing more to do */
  }
}

interface State {
  error: Error | null
}

/**
 * Catches a page that throws while rendering, so a bug shows "Something went wrong" with a way out instead of a blank
 * window. `onHome` is offered as "Go to Photos" (the page-level boundary); without it, only Reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; view?: string; onHome?: () => void }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError('render', error, { componentStack: info.componentStack, view: this.props.view })
  }

  render(): ReactNode {
    const error = this.state.error
    if (!error) return this.props.children
    return (
      <div role="alert" className="drag flex h-full items-center justify-center bg-mat px-8">
        <div className="no-drag w-full max-w-md text-center animate-rise-in">
          <Mark size={40} className="mx-auto mb-6" />
          <h1 className="font-[family-name:var(--font-display)] text-[26px] font-bold leading-8 tracking-[-0.015em] text-ink">{t('Something went wrong')}</h1>
          <p className="mt-2 text-[14px] leading-5 text-ink-muted">
            {t('This page hit a problem and stopped. Your photos and your library are not affected, and the problem has been written to the log.')}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            {this.props.onHome && (
              <button
                onClick={() => {
                  this.setState({ error: null })
                  this.props.onHome?.()
                }}
                className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-card px-3 text-[13.5px] font-semibold text-ink"
              >
                {t('Go to Photos')}
              </button>
            )}
            <button onClick={() => window.location.reload()} className="inline-flex h-8 items-center rounded-lg bg-ink px-3 text-[13.5px] font-semibold text-on-ink">
              {t('Reload')}
            </button>
          </div>
          <details className="mt-6 text-left">
            <summary className="cursor-default text-center text-[12.5px] text-ink-muted">{t('Details')}</summary>
            <pre className="mt-2 max-h-40 select-text overflow-auto whitespace-pre-wrap rounded-lg bg-shelf p-3 font-mono text-[11.5px] leading-4 text-ink-muted">{error.message}</pre>
          </details>
        </div>
      </div>
    )
  }
}
