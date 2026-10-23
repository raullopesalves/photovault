import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileArchive, FolderOpen, History, Smartphone } from 'lucide-react'
import { t } from '../lib/i18n'
import { useMenu } from '../lib/a11y'

export type ImportKind = 'folder' | 'zip' | 'phone'

/** A button that offers the two import sources: a folder, or ZIP archives (e.g. Google Takeout). */
export function ImportMenu(props: { onImport: (kind: ImportKind) => void; onShowImports?: () => void; className: string; children: ReactNode; placement?: 'above' | 'below' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useMenu(menu, open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const pick = (kind: ImportKind): void => {
    setOpen(false)
    props.onImport(kind)
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={props.className} aria-haspopup="menu" aria-expanded={open}>
        {props.children}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={t('Import')}
          className={`absolute left-0 z-20 w-full min-w-[248px] overflow-hidden rounded-xl bg-white p-1.5 text-left shadow-xl shadow-stone-950/15 ring-1 ring-stone-200 animate-rise-in dark:bg-stone-800 dark:ring-white/10 ${
            props.placement === 'below' ? 'top-full mt-2' : 'bottom-full mb-2'
          }`}
        >
          <MenuItem icon={<FolderOpen className="size-4" />} title={t('Folder…')} body={t('Photos on a disk, phone backup, extracted export')} onClick={() => pick('folder')} />
          <MenuItem icon={<FileArchive className="size-4" />} title={t('ZIP archives…')} body={t('Google Takeout or any ZIP — select several at once')} onClick={() => pick('zip')} />
          <MenuItem icon={<Smartphone className="size-4" />} title={t('Phone or camera…')} body={t('Connected by USB — copies only what is new')} onClick={() => pick('phone')} />
          {props.onShowImports && (
            <>
              <div className="mx-2 my-1 h-px bg-line" />
              <MenuItem
                icon={<History className="size-4" />}
                title={t('Past imports')}
                body={t('What each import found and copied; resume one that stopped')}
                onClick={() => {
                  setOpen(false)
                  props.onShowImports?.()
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem(props: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={props.onClick}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-stone-100 focus-visible:bg-stone-100 dark:hover:bg-stone-700/70 dark:focus-visible:bg-stone-700/70"
    >
      <span className="mt-0.5 text-accent-600 dark:text-accent-400">{props.icon}</span>
      <span>
        <span className="block text-[13.5px] font-medium text-stone-900 dark:text-stone-100">{props.title}</span>
        <span className="block text-xs leading-snug text-ink-muted">{props.body}</span>
      </span>
    </button>
  )
}
