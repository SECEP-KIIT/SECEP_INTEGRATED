// The one breakpoint definition (task 8 decision). Phone ≤ 640 px, tablet 641–1023 px, desktop ≥ 1024 px.
//
// Everything reads from here: the layout's device class (FR-UI-010), the idle lock (phones never idle-lock), and the
// CSS. Stylesheets can't import a constant, so instead of width media queries they select on <html data-device>,
// which watchDevice() keeps in sync from these queries. A test fails if a width media query appears in any CSS file.
// The boot chunk sets it before the app paints, and the lock screen covers the app until then anyway.

export type DeviceClass = 'phone' | 'tablet' | 'desktop'

export const PHONE_MAX = 640
export const TABLET_MAX = 1023

const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`
const TABLET_QUERY = `(max-width: ${TABLET_MAX}px)`

export function deviceClassOf(width: number): DeviceClass {
  if (width <= PHONE_MAX) return 'phone'
  return width <= TABLET_MAX ? 'tablet' : 'desktop'
}

/** The current device class, from the same media queries the CSS mirror uses (so they can never disagree). */
export function currentDevice(): DeviceClass {
  if (matchMedia(PHONE_QUERY).matches) return 'phone'
  return matchMedia(TABLET_QUERY).matches ? 'tablet' : 'desktop'
}

const listeners = new Set<() => void>()
let watching = false

/** Starts mirroring the device class to <html data-device> and to subscribers. Idempotent. */
export function watchDevice() {
  if (watching) return
  watching = true
  const apply = () => {
    document.documentElement.dataset.device = currentDevice()
    for (const l of listeners) l()
  }
  apply()
  matchMedia(PHONE_QUERY).addEventListener('change', apply)
  matchMedia(TABLET_QUERY).addEventListener('change', apply)
}

/** For useSyncExternalStore. */
export function subscribeDevice(listener: () => void) {
  watchDevice()
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
