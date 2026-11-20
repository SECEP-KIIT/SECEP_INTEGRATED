// Runtime knobs for the mock, changed from the dev panel. Dev-only, like everything under src/mocks.
export type JiraMode = 'ok' | 'rate_limited_once' | 'server_error' | 'unauthorized' | 'bad_request'

export const control = {
  /** Simulated network latency in ms (min, max). Tests set 0. */
  latency: [80, 250] as [number, number],
  jiraMode: 'ok' as JiraMode,
  /** Incoming mail: seconds between arrivals, and a speed multiplier for every simulated delay. */
  arrivalEvery: [60, 120] as [number, number],
  speed: 1,
  paused: false,
}

export const scaled = (ms: number) => ms / control.speed

type ControlPatch = Partial<typeof control>
const listeners = new Set<(patch: ControlPatch) => void>()

/**
 * The dev panel changes knobs only through this, not by mutating `control` from components. Every open tab gets
 * the change too (src/mocks/tabsync.ts), so pausing mail in one tab pauses the tab that sends it; `remote` marks a
 * change that came from another tab, so it isn't sent back.
 */
export function setControl(patch: ControlPatch, { remote = false } = {}) {
  Object.assign(control, patch)
  if (!remote) for (const l of listeners) l(patch)
}

export function onControl(listener: (patch: ControlPatch) => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
