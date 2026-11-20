// Time of day → wallpaper phase. Fixed local-time bands until task 16 replaces them with suncalc (FR-WP-008).
export type Phase = 'dawn' | 'day' | 'golden' | 'dusk' | 'night'

/** Wallpaper brightness: `light` wallpaper → dark bar text, `dark` → light text (FR-UI-005). */
export type Tone = 'light' | 'dark'

const BANDS: [startHour: number, phase: Phase][] = [
  [5, 'dawn'],
  [7, 'day'],
  [17, 'golden'],
  [18.5, 'dusk'],
  [19.5, 'night'],
]

export function phaseAt(date: Date): Phase {
  const hour = date.getHours() + date.getMinutes() / 60
  let phase: Phase = 'night'
  for (const [start, p] of BANDS) if (hour >= start) phase = p
  return phase
}

export const PHASE_TONE: Record<Phase, Tone> = {
  dawn: 'light',
  day: 'light',
  golden: 'light',
  dusk: 'dark',
  night: 'dark',
}
