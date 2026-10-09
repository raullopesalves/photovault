import { useState } from 'react'
import { Eye, EyeOff, RotateCcw, Trash2 } from 'lucide-react'
import type { LibraryInfo } from '@shared/types'
import { api, bytes, plural } from '../lib/format'
import { AssetGrid } from '../components/AssetGrid'
import { BinDeleteDialog } from '../components/BinDelete'
import { ConfirmDialog } from '../components/Dialog'

const actionBtn = 'no-drag inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition disabled:opacity-40'

/** Everything hidden from the Photos timeline, in one place. */
export function HiddenView(props: { version: number; library: LibraryInfo }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <AssetGrid
        version={props.version}
        query={{ hidden: 'only' }}
        title="Hidden"
        subtitle="Hidden from the Photos timeline — still in your library, albums and search. Select items to unhide them, or move them to the Bin."
        actions={
          props.library.hiddenCount > 0 ? (
            <button onClick={() => setConfirm(true)} className={`${actionBtn} bg-stone-200/70 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`}>
              <Eye className="size-3.5" /> Show all in Photos
            </button>
          ) : undefined
        }
        empty={
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-stone-200/70 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              <EyeOff className="size-6" strokeWidth={1.6} />
            </div>
            <div className="text-[16px] font-semibold">Nothing hidden</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              Hide clutter from the Photos timeline with “Hide” on a selection, in Cleanup or in Duplicates. It stays in your library and shows up here.
            </p>
          </div>
        }
      />
      {confirm && (
        <ConfirmDialog
          title={`Show ${plural(props.library.hiddenCount, 'item')} in Photos again?`}
          body="All hidden items will appear in the Photos timeline again."
          confirm="Show all"
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
        title="Bin"
        subtitle={
          count > 0
            ? `${plural(count, 'item')} · ${bytes(props.library.binBytes)} · kept until you delete them — nothing is deleted automatically`
            : 'Items you move to the Bin wait here until you restore or delete them.'
        }
        actions={
          count > 0 ? (
            <>
              <button onClick={() => setRestoring(true)} className={`${actionBtn} bg-stone-200/70 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700`}>
                <RotateCcw className="size-3.5" /> Restore all
              </button>
              <button onClick={() => setEmptying(true)} className={`${actionBtn} bg-red-600 text-white hover:bg-red-700`}>
                <Trash2 className="size-3.5" /> Empty Bin
              </button>
            </>
          ) : undefined
        }
        empty={
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-stone-200/70 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              <Trash2 className="size-6" strokeWidth={1.6} />
            </div>
            <div className="text-[16px] font-semibold">The Bin is empty</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              Select photos anywhere and choose “Bin”. They stay here — out of every other view — until you restore them or delete them permanently.
            </p>
          </div>
        }
      />
      {restoring && (
        <ConfirmDialog
          title={`Restore ${plural(count, 'item')}?`}
          body="They return to Photos, albums and everywhere else they were."
          confirm="Restore all"
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
