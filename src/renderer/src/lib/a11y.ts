import { useEffect, useLayoutEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Elements Tab can reach inside `root`, in order, leaving out hidden ones. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]'))
}

/**
 * A modal surface (dialog, sheet, viewer): focus moves into it when it opens (to `[data-autofocus]`, an element
 * with `autoFocus`, or the first control), Tab and Shift+Tab stay inside it, and focus returns to where it was
 * (the button or photo that opened it) when it closes. Give the element role="dialog" and aria-modal="true".
 */
export function useModal(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Named by its first heading unless it names itself.
    const heading = root.querySelector<HTMLElement>('h1, h2')
    if (heading && !root.hasAttribute('aria-label') && !root.hasAttribute('aria-labelledby')) {
      heading.id ||= `dialog-title-${Math.random().toString(36).slice(2, 8)}`
      root.setAttribute('aria-labelledby', heading.id)
    }
    if (!root.contains(document.activeElement)) {
      const target = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0] ?? root
      if (target === root && !root.hasAttribute('tabindex')) root.tabIndex = -1
      target.focus({ preventScroll: true })
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const list = focusables(root)
      if (!list.length) return e.preventDefault()
      const first = list[0] as HTMLElement
      const last = list[list.length - 1] as HTMLElement
      const inside = root.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      // After the surface is gone (and its opener may have re-rendered), put focus back, but only if it was lost
      // with it: a remount, or a surface that moved focus somewhere on purpose, is left alone.
      requestAnimationFrame(() => {
        const lost = !document.activeElement || document.activeElement === document.body
        if (lost && before?.isConnected) before.focus({ preventScroll: true })
      })
    }
  }, [])
}

/**
 * A menu (role="menu" with role="menuitem…" children): the first item is focused when it opens, Up/Down/Home/End
 * move between items, and Tab closes it. Escape and outside clicks are handled by the menu itself; focus returns
 * to the button that opened it.
 */
export function useMenu(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    const root = ref.current
    if (!open || !root) return
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const items = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')]
    items()[0]?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent): void => {
      const list = items()
      const at = list.indexOf(document.activeElement as HTMLElement)
      const move = (i: number): void => {
        e.preventDefault()
        list[(i + list.length) % list.length]?.focus()
      }
      if (e.key === 'ArrowDown') move(at + 1)
      else if (e.key === 'ArrowUp') move(at < 0 ? -1 : at - 1)
      else if (e.key === 'Home') move(0)
      else if (e.key === 'End') move(-1)
      else if (e.key === 'Tab') onClose()
    }
    root.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('keydown', onKey)
      if (before?.isConnected && (root.contains(document.activeElement) || document.activeElement === document.body)) before.focus({ preventScroll: true })
    }
  }, [open])
}
