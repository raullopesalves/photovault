import { useRef, type HTMLAttributes } from 'react'
import { useModal } from '../lib/a11y'

/**
 * The panel of a dialog, sheet or full-screen viewer: announced as a modal dialog (named by `aria-label` or its first
 * heading), focus moves into it, stays inside while it is open, and returns to the opener when it closes.
 */
export function ModalPanel(props: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)
  useModal(ref)
  return <div ref={ref} role="dialog" aria-modal="true" {...props} />
}
