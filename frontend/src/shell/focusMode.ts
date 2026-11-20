import { createContext, useContext, useEffect, useState } from 'react'
import { anyLayerOpen, focusKeyAction } from './focusKeys'

// Focus mode (FR-UI-004). The shell owns the state and hides the sidebar and slims the topbar; the card widgets
// (task 6) read it through useFocused() to show only Critical and High.
export const FocusContext = createContext(false)
export const useFocused = () => useContext(FocusContext)

export function useFocusMode() {
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The lock screen stops keys before they get here while it's up.
      if (e.defaultPrevented) return
      const action = focusKeyAction(e, focused, anyLayerOpen())
      if (!action) return
      e.preventDefault()
      setFocused(action === 'toggle' ? !focused : false)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [focused])

  return focused
}
