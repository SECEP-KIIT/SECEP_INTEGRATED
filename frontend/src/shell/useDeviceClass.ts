import { useSyncExternalStore } from 'react'
import { currentDevice, subscribeDevice, type DeviceClass } from '../lib/breakpoints'

/** The shared breakpoint (src/lib/breakpoints.ts) as React state. */
export const useDeviceClass = (): DeviceClass => useSyncExternalStore(subscribeDevice, currentDevice)
