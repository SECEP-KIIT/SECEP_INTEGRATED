// When the lock comes down (idle, Alt+L, the lock button), nothing may show over it: browser dialogs sit in the top
// layer, above any z-index, so they are closed, and open menus get an Escape. The email panel is remembered and
// reopens on the same email once the lock goes up again (19 Nov 2026).
import { useEffect } from 'react'
import { LOCKING, UNLOCKED } from '../boot/lock'
import { openEmail } from './openEmail'

export function useLockLayers() {
  useEffect(() => {
    let reopen: string | null = null
    const onLocking = () => {
      const drawer = document.querySelector<HTMLDialogElement>('dialog[open][data-email-id]')
      reopen = drawer?.dataset.emailId ?? null
      for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close()
      // Radix menus and popovers close on Escape (they listen on document); the lock ignores synthetic keys.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    const onUnlocked = () => {
      if (reopen) openEmail(reopen, true)
      reopen = null
    }
    addEventListener(LOCKING, onLocking)
    addEventListener(UNLOCKED, onUnlocked)
    return () => {
      removeEventListener(LOCKING, onLocking)
      removeEventListener(UNLOCKED, onUnlocked)
    }
  }, [])
}
