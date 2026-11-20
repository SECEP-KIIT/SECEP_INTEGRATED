// Toasts from outside a page's inbox tree (the sidebar, the project dialog): the page's InboxHost shows them.
import type { ToastAction } from '../inbox/inboxContext'

const EVENT = 'secep:toast'

export interface ShellToast {
  message: string
  tone?: 'info' | 'error'
  action?: ToastAction
}

export const shellToast = (message: string, tone: ShellToast['tone'] = 'info', action?: ToastAction) =>
  dispatchEvent(new CustomEvent<ShellToast>(EVENT, { detail: { message, tone, action } }))

export function onShellToast(fn: (t: ShellToast) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<ShellToast>).detail)
  addEventListener(EVENT, handler)
  return () => removeEventListener(EVENT, handler)
}
