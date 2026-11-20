import { createContext, useContext } from 'react'
import type { EmailListItem } from '../api/types'
import type { Density, FilterPatch } from './cardModel'

/** The card a lift is for: its element (where to float the copy), its data, and its column's callbacks. */
export interface LiftTarget {
  el: HTMLElement
  email: EmailListItem
  now: Date
  density: Density
  onFilter: (patch: FilterPatch) => void
  onLeave: (leaving: boolean) => void
}

/** What a card asks of the page's lift (src/inbox/CardLift.tsx). */
export interface LiftApi {
  /** Pointer entered the card: lift it after the hover intent. */
  enter: (target: LiftTarget) => void
  /** Pointer left the card (or its bar or tags): drop the lift after a short grace. */
  leave: () => void
  /** Keyboard focus on the card itself: lift it now. */
  focus: (target: LiftTarget) => void
  /** Focus left the card for `next`: drop the lift unless focus went into it. */
  blur: (id: string, next: EventTarget | null) => void
  /** The card re-rendered (a live update): the lift shows the new data. */
  refresh: (target: LiftTarget) => void
  isLifted: (id: string) => boolean
  /** Long-press on touch: the card's action menu (TouchActions). */
  menu: (target: LiftTarget) => void
  /** Moves focus to the bar's first button; false if there is none. */
  enterBar: () => boolean
  hide: () => void
}

/** Mouse-like pointers only: never on touch (hover: none or pointer: coarse; QA pass 3). */
export const canLift = () => matchMedia('(hover: hover) and (pointer: fine)').matches

export const LiftContext = createContext<LiftApi | null>(null)
export const useLift = () => useContext(LiftContext)

export interface LiftPlace {
  bar: 'above' | 'below'
  tags: 'above' | 'below'
}

/**
 * Where the lift's bar and tags go around a card (QA pass 3): the bar above and the tags below, each flipping to
 * the other side when it wouldn't fit in the viewport (`margin` from its edges, `gap` between the parts).
 */
export function placeLift(card: { top: number; bottom: number }, barH: number, tagsH: number, viewportH: number, gap = 4, margin = 8): LiftPlace {
  const bar = card.top - gap - barH >= margin ? 'above' : 'below'
  const below = card.bottom + gap + (bar === 'below' ? barH + gap : 0) + tagsH
  return { bar, tags: below <= viewportH - margin ? 'below' : 'above' }
}
