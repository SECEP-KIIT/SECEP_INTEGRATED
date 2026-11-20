import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { createContext, useContext } from 'react'

/** The title bar is a tile's drag handle (FR-UI-008): FlowPage provides it per tile, WidgetFrame uses it in Edit. */
export interface Handle {
  ref: (el: HTMLElement | null) => void
  listeners: DraggableSyntheticListeners
  attributes: DraggableAttributes
}
export const DragHandle = createContext<Handle | null>(null)
export const useDragHandle = () => useContext(DragHandle)
