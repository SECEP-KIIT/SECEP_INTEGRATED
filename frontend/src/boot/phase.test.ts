import { describe, expect, it } from 'vitest'
import { PHASE_TONE, phaseAt } from './phase'

const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m)

describe('phaseAt', () => {
  it.each([
    [at(4, 59), 'night'],
    [at(5), 'dawn'],
    [at(7), 'day'],
    [at(16, 59), 'day'],
    [at(17), 'golden'],
    [at(18, 30), 'dusk'],
    [at(19, 30), 'night'],
    [at(23, 59), 'night'],
  ] as const)('%s → %s', (date, phase) => {
    expect(phaseAt(date)).toBe(phase)
  })

  it('dark phases get light text', () => {
    expect(PHASE_TONE.night).toBe('dark')
    expect(PHASE_TONE.day).toBe('light')
  })
})
