import { createContext } from 'react'

/**
 * Where Radix popovers portal to. A modal <dialog> (the drawer) makes everything outside it inert, so a popover
 * opened inside the drawer must render inside the dialog, not in <body>. null = <body>.
 */
export const PortalContainer = createContext<HTMLElement | null>(null)
