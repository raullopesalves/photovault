import { useState } from 'react'
import { Eye, EyeOff, RotateCcw, Trash2 } from 'lucide-react'
import type { LibraryInfo } from '@shared/types'
import { api, bytes, plural } from '../lib/format'
import { AssetGrid } from '../components/AssetGrid'
import { BinDeleteDialog } from '../components/BinDelete'
import { ConfirmDialog } from '../components/Dialog'
import { t } from '../lib/i18n'

const actionBtn = 'no-drag inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition disabled:opacity-40'

/** Everything hidden from the Photos timeline, in one place. */
export function HiddenView(props: { version: number; library: LibraryInfo }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <AssetGrid
        version={props.version}
        query={{ hidden: 'only' }}
        title={t('Hidden')}
        subtitle={t('Hidden from the Photos timeline — still in your library, albums and search. Select items to unhide them, or move them to the Bin.')}
        actions={
          props.library.hiddenCount > 0 ? (
            <button onClick={() => setConfirm(true)} className={`${actionBtn} bg-stone-200/70 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`}>
              <Eye className="size-3.5" />{' '}{t('Show all in Photos')}</button>
          ) : undefined
        }
        empty={
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-stone-200/70 text-ink-muted dark:bg-stone-800 dark:text-stone-400">
              <EyeOff className="size-6" strokeWidth={1.6} />
            </div>
            <div className="text-[16px] font-semibold">{t('Nothing hidden')}</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{t('Hide clutter from the Photos timeline with “Hide” on a selection, in Cleanup or in Duplicates. It stays in your library and shows up here.')}</p>
          </div>
        }
      />
      {confirm && (
        <ConfirmDialog
          title={t('Show {hiddenCount} in Photos again?', { hiddenCount: plural(props.library.hiddenCount, 'item') })}
          body={t('All hidden items will appear in the Photos timeline again.')}
          confirm={t('Show all')}
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false)
            await api.setHiddenByQuery({ hidden: 'only' }, false)
          }}
        />
      )}
    </>
  )
}

/** Items moved to the Bin: restore them, or delete them permanently. Nothing is deleted automatically. */
export function BinView(props: { version: number; library: LibraryInfo }) {
  const [emptying, setEmptying] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const count = props.library.binCount
  return (
    <>
      <AssetGrid
        version={props.version}
        query={{ trash: 'only' }}
        mode="bin"
        title={t('Bin')}
        subtitle={
          count > 0
            ? t('{count} · {v1} · kept until you delete them — nothing is deleted automatically', { count: plural(count, 'item'), v1: bytes(props.library.binBytes) })
            : t('Items you move to the Bin wait here until you restore or delete them.')
        }
        actions={
          count > 0 ? (
            <>
              <button onClick={() => setRestoring(true)} className={`${actionBtn} bg-stone-200/70 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`}>
                <RotateCcw className="size-3.5" />{' '}{t('Restore all')}</button>
              <button onClick={() => setEmptying(true)} className={`${actionBtn} bg-red-600 text-white hover:bg-red-700`}>
                <Trash2 className="size-3.5" />{' '}{t('Empty Bin')}</button>
            </>
          ) : undefined
        }
        empty={
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-stone-200/70 text-ink-muted dark:bg-stone-800 dark:text-stone-400">
              <Trash2 className="size-6" strokeWidth={1.6} />
            </div>
            <div className="text-[16px] font-semibold">{t('The Bin is empty')}</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{t('Select photos anywhere and choose “Bin”. They stay here — out of every other view — until you restore them or delete them permanently.')}</p>
          </div>
        }
      />
      {restoring && (
        <ConfirmDialog
          title={t('Restore {count}?', { count: plural(count, 'item') })}
          body={t('They return to Photos, albums and everywhere else they were.')}
          confirm={t('Restore all')}
          onClose={() => setRestoring(false)}
          onConfirm={async () => {
            setRestoring(false)
            await api.restoreFromBin('all')
          }}
        />
      )}
      {emptying && <BinDeleteDialog ids="all" count={count} sizeBytes={props.library.binBytes} onClose={() => setEmptying(false)} />}
    </>
  )
}
