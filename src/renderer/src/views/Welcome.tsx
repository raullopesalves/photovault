import { FolderOpen, ShieldCheck } from 'lucide-react'
import { Mark } from '../components/Mark'
import { t } from '../lib/i18n'

export function Welcome(props: { error?: string; onCreate: () => void; onOpen: () => void }) {
  return (
    <div className="drag relative flex h-full items-center justify-center overflow-hidden">
      <main className="no-drag relative w-[520px] text-center animate-rise-in">
        <Mark size={72} className="mx-auto mb-8" />
        <h1 className="text-balance font-[family-name:var(--font-display)] text-[44px] font-bold leading-[48px] tracking-[-0.025em]">{t('Your photos, permanently yours.')}</h1>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">{t('Photo Vault keeps your originals as ordinary files in a folder you choose, detects exact duplicates and remembers where every photo came from.')}</p>

        <div className="mt-10 flex flex-col items-center gap-3">
          <button
            onClick={props.onCreate}
            className="h-11 w-72 rounded-xl bg-brass text-[14px] font-medium text-on-accent hover:bg-brass-hover shadow-sm transition active:scale-[0.98]"
          >{t('Create a library')}</button>
          <button
            onClick={props.onOpen}
            className="flex h-11 w-72 items-center justify-center gap-2 rounded-xl text-[14px] font-medium text-stone-700 transition hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <FolderOpen className="size-4" strokeWidth={1.75} />{t('Open an existing library')}</button>
        </div>

        {props.error && (
          <div className="mx-auto mt-6 max-w-md rounded-xl bg-red-50 px-4 py-3 text-left text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">
            {props.error}
          </div>
        )}

        <div className="mt-12 flex items-center justify-center gap-2 text-xs text-ink-muted">
          <ShieldCheck className="size-3.5" />{t('Imports copy files. Your source folders are never modified or deleted.')}</div>
      </main>
    </div>
  )
}
