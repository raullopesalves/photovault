import { FolderOpen, ShieldCheck, Sparkles } from 'lucide-react'

export function Welcome(props: { error?: string; onCreate: () => void; onOpen: () => void }) {
  return (
    <div className="drag relative flex h-full items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-70 dark:opacity-40">
        <div className="absolute -left-40 -top-40 size-[520px] rounded-full bg-accent-100 blur-3xl dark:bg-accent-600/30" />
        <div className="absolute -bottom-48 -right-32 size-[560px] rounded-full bg-amber-100 blur-3xl dark:bg-amber-700/20" />
      </div>
      <div className="no-drag relative w-[520px] text-center animate-rise-in">
        <div className="mx-auto mb-8 grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 text-white shadow-lg shadow-accent-600/30">
          <Sparkles className="size-8" strokeWidth={1.5} />
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight">Your photos, permanently yours.</h1>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
          Photo Vault keeps your originals as ordinary files in a folder you choose, detects exact duplicates and remembers where every photo came
          from.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3">
          <button
            onClick={props.onCreate}
            className="h-11 w-72 rounded-xl bg-stone-900 text-[14px] font-medium text-white shadow-sm transition hover:bg-stone-800 active:scale-[0.98] dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
          >
            Create a library
          </button>
          <button
            onClick={props.onOpen}
            className="flex h-11 w-72 items-center justify-center gap-2 rounded-xl text-[14px] font-medium text-stone-700 transition hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <FolderOpen className="size-4" strokeWidth={1.75} />
            Open an existing library
          </button>
        </div>

        {props.error && (
          <div className="mx-auto mt-6 max-w-md rounded-xl bg-red-50 px-4 py-3 text-left text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">
            {props.error}
          </div>
        )}

        <div className="mt-12 flex items-center justify-center gap-2 text-xs text-stone-500 dark:text-stone-500">
          <ShieldCheck className="size-3.5" />
          Imports copy files. Your source folders are never modified or deleted.
        </div>
      </div>
    </div>
  )
}
