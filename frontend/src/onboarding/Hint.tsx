// First-use hints (proposals §29.3): a small bubble the first time you reach a screen, next to the thing it explains.
// Shown once per person (ui_prefs.onboarding.hints), never during the tour or before the tour has been offered.
import { Lightbulb } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useKeyLabel, type KeyActionId } from '../lib/keybinds'
import { markHintSeen, useOnboarding, type HintId } from './onboarding'
import './onboarding.css'

export function Hint({ id, target, children }: { id: HintId; target: string; children: ReactNode }) {
  const o = useOnboarding()
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const show = !!o && o.tour !== undefined && o.tour !== 'paused' && !o.hints?.includes(id) && !document.querySelector('.tour')

  useEffect(() => {
    if (!show) return
    // Wait for the target to render; place the bubble under it, inside the window.
    const t = window.setTimeout(() => {
      const r = document.querySelector(target)?.getBoundingClientRect()
      if (r && r.width) setPos({ x: Math.max(12, Math.min(r.left, innerWidth - 300)), y: Math.min(r.bottom + 8, innerHeight - 140) })
    }, 600)
    return () => clearTimeout(t)
  }, [show, target])

  if (!show || !pos) return null
  return (
    <div className="hint" role="status" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      <Lightbulb size={16} aria-hidden="true" />
      <p>{children}</p>
      <button type="button" className="text-button" onClick={() => markHintSeen(id)}>
        Got it
      </button>
    </div>
  )
}

/** A key as the user has it bound, e.g. <Key id="next" /> → J (or whatever they chose in Settings). */
export function Key({ id }: { id: KeyActionId }) {
  return <kbd>{useKeyLabel(id)}</kbd>
}
