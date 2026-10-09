import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ShareOptions } from '@shared/types'

function Shell(props: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        props.onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/30 p-8 backdrop-blur-[4px] animate-fade-in dark:bg-black/50" onMouseDown={props.onClose}>
      <div
        className="w-[420px] rounded-2xl bg-white p-6 shadow-2xl shadow-stone-950/20 animate-rise-in dark:bg-stone-900 dark:ring-1 dark:ring-white/10"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {props.children}
      </div>
    </div>
  )
}

const btn = 'h-9 rounded-lg px-4 text-[13.5px] font-medium transition'
const secondary = `${btn} text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800`
const primary = `${btn} bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200`
const danger = `${btn} bg-red-600 text-white hover:bg-red-700`

export function PromptDialog(props: {
  title: string
  label?: string
  initial?: string
  confirm: string
  placeholder?: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(props.initial ?? '')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const submit = (): void => {
    if (value.trim()) props.onSubmit(value.trim())
  }
  return (
    <Shell onClose={props.onClose}>
      <h2 className="text-[17px] font-semibold">{props.title}</h2>
      {props.label && <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400">{props.label}</p>}
      <input
        ref={input}
        value={value}
        placeholder={props.placeholder}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="mt-4 h-10 w-full select-text rounded-lg bg-stone-100 px-3 text-[14px] outline-none ring-accent-500 focus:ring-2 dark:bg-stone-800"
      />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={props.onClose} className={secondary}>
          Cancel
        </button>
        <button onClick={submit} disabled={!value.trim()} className={primary}>
          {props.confirm}
        </button>
      </div>
    </Shell>
  )
}

/** Pick a date (and optionally a time) for one or more items. */
export function DateDialog(props: {
  title: string
  label?: string
  initial?: string | null
  allowRemove?: boolean
  onSubmit: (wall: string | null) => void
  onClose: () => void
}) {
  const [date, setDate] = useState(props.initial?.slice(0, 10) ?? '')
  const [time, setTime] = useState(props.initial?.slice(11, 16) ?? '12:00')
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(date.slice(0, 4)) > 1825 && date <= new Date().toISOString().slice(0, 10)
  const submit = (): void => {
    if (valid) props.onSubmit(`${date}T${/^\d{2}:\d{2}$/.test(time) ? time : '12:00'}:00`)
  }
  const field = 'h-10 select-text rounded-lg bg-stone-100 px-3 text-[14px] outline-none ring-accent-500 focus:ring-2 dark:bg-stone-800 dark:[color-scheme:dark]'
  return (
    <Shell onClose={props.onClose}>
      <h2 className="text-[17px] font-semibold">{props.title}</h2>
      {props.label && <p className="mt-1 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">{props.label}</p>}
      <div className="mt-4 flex gap-2">
        <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} className={`${field} flex-1`} autoFocus />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} className={`${field} w-32`} />
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        {props.allowRemove && (
          <button onClick={() => props.onSubmit(null)} className={`${secondary} mr-auto`}>
            Remove date
          </button>
        )}
        <button onClick={props.onClose} className={secondary}>
          Cancel
        </button>
        <button onClick={submit} disabled={!valid} className={primary}>
          Set date
        </button>
      </div>
    </Shell>
  )
}

export function ConfirmDialog(props: { title: string; body: ReactNode; confirm: string; destructive?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Shell onClose={props.onClose}>
      <h2 className="text-[17px] font-semibold">{props.title}</h2>
      <div className="mt-2 text-[13.5px] leading-relaxed text-stone-600 dark:text-stone-400">{props.body}</div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={props.onClose} className={secondary}>
          Cancel
        </button>
        <button onClick={props.onConfirm} className={props.destructive ? danger : primary}>
          {props.confirm}
        </button>
      </div>
    </Shell>
  )
}

/** "Share": choose the size, then the copies are prepared in a folder that opens in Explorer. */
export function ShareDialog(props: { count: number; onShare: (opts: ShareOptions) => void; onClose: () => void }) {
  const [size, setSize] = useState<ShareOptions['size']>('large')
  const [includeDate, setIncludeDate] = useState(true)
  const sizes: Array<{ id: ShareOptions['size']; label: string; hint: string }> = [
    { id: 'small', label: 'Small', hint: '1280 px — chats, quick to send' },
    { id: 'large', label: 'Large', hint: '2048 px — good for screens and email' },
    { id: 'original', label: 'Full size', hint: 'original resolution, as JPEG' }
  ]
  return (
    <Shell onClose={props.onClose}>
      <h2 className="text-[17px] font-semibold">Share {props.count === 1 ? 'this item' : `${props.count} items`}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600 dark:text-stone-400">
        Copies are made in a new folder that opens in Explorer — drag them into WhatsApp, email or a phone. Your edits are applied; location and camera details are
        removed. Videos are copied as they are.
      </p>
      <div className="mt-4 space-y-1.5">
        {sizes.map((s) => (
          <label key={s.id} className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${size === s.id ? 'bg-stone-100 dark:bg-stone-800' : 'hover:bg-stone-50 dark:hover:bg-stone-800/50'}`}>
            <input type="radio" checked={size === s.id} onChange={() => setSize(s.id)} className="accent-accent-500" />
            <span className="text-[13.5px] font-medium">{s.label}</span>
            <span className="text-xs text-stone-500 dark:text-stone-400">{s.hint}</span>
          </label>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 px-3 text-[13px]">
        <input type="checkbox" checked={includeDate} onChange={(e) => setIncludeDate(e.target.checked)} className="accent-accent-500" />
        Keep the date taken
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={props.onClose} className={secondary}>
          Cancel
        </button>
        <button onClick={() => props.onShare({ size, includeDate })} className={primary}>
          Prepare copies
        </button>
      </div>
    </Shell>
  )
}
