// Placeholder living wallpaper: a gradient per sun phase (FR-WP-008). Task 16 swaps in photos behind the same markup.
import { PHASE_TONE, phaseAt, type Phase } from './phase'

const CHECK_MS = 5 * 60_000
const FADE_MS = 60_000 // keep in sync with .wp-front.is-in in lock.css

function setTone(phase: Phase) {
  document.documentElement.dataset.tone = PHASE_TONE[phase]
}

export function startWallpaper() {
  const back = document.querySelector<HTMLElement>('.wp-back')
  const front = document.querySelector<HTMLElement>('.wp-front')
  if (!back || !front) return

  let current = phaseAt(new Date())
  back.dataset.phase = current
  setTone(current)

  const settle = (phase: Phase) => {
    back.dataset.phase = phase
    front.classList.remove('is-in') // .wp-front has no transition, so it hides instantly over the now-matching back
  }

  setInterval(() => {
    const next = phaseAt(new Date())
    if (next === current) return
    current = next
    if (document.documentElement.dataset.motion === 'off') {
      settle(next)
      setTone(next)
      return
    }
    front.dataset.phase = next
    front.classList.add('is-in')
    // Flip the bar text at the midpoint, when the new wallpaper starts to dominate, so it's never wrong-contrast
    // for long during the 60 s blend.
    setTimeout(() => setTone(next), FADE_MS / 2)
    front.addEventListener('transitionend', () => settle(next), { once: true })
  }, CHECK_MS)
}
