// Flow geometry for desktop and tablet pages (proposals §16.3, replacing the 12-column snap grid of FR-UI-008).
// A page is an ordered list of tiles that fill rows of 3 slots, left to right, top to bottom. Pure, unit-tested;
// the page renders the same flow with CSS grid's sparse auto-placement, so this is the model the tests pin.
import type { LayoutDeviceClass, WidgetSize } from '../api/types'

export const SLOTS_PER_ROW = 3
/** Slots each size takes. */
export const SPAN: Record<WidgetSize, number> = { small: 1, medium: 2, large: 3 }
export const SIZES: WidgetSize[] = ['small', 'medium', 'large']

export const isPhoneLayout = (device: LayoutDeviceClass) => device === 'phone'

/**
 * Where each tile lands, in order: it goes in the current row if its slots fit there, otherwise it starts the next
 * row (leaving the rest of this row empty). So a larger tile that doesn't fit a gap pushes the following tiles right,
 * then down. Each row is as tall as its tallest tile (CSS grid auto rows).
 */
export function flow(sizes: readonly WidgetSize[]): { row: number; col: number }[] {
  let row = 0
  let col = 0
  return sizes.map((size) => {
    const span = SPAN[size]
    if (col + span > SLOTS_PER_ROW) {
      row++
      col = 0
    }
    const at = { row, col }
    col += span
    return at
  })
}

/** How many rows a page's tiles fill. */
export const rowCount = (sizes: readonly WidgetSize[]) => (sizes.length === 0 ? 0 : (flow(sizes).at(-1)?.row ?? 0) + 1)
