import { describe, expect, it } from 'vitest'
import { INITIAL, STEP_WEIGHTS, effectiveMotion, effectiveTheme, isIdle, progressOf, reduce, ringLength, type LockEvent, type LockState, type Step } from './lock-state'

const ALL: Step[] = ['app', 'me', 'emails', 'layout', 'socket']
const run = (events: LockEvent[], from: LockState = INITIAL) => events.reduce(reduce, from)
const steps = (list: Step[]): LockEvent[] => list.map((step) => ({ type: 'step', step }))

describe('lock state (FR-WP-001–005)', () => {
  it('weights sum to 100', () => {
    expect(progressOf(ALL)).toBe(100)
    expect(Object.values(STEP_WEIGHTS).reduce((a, b) => a + b)).toBe(100)
  })

  it('stays on the lock when ready until the user clicks or presses a key (FR-WP-001)', () => {
    const ready = run(steps(ALL))
    expect(ready.view).toBe('locked')
    expect(reduce(ready, { type: 'request' }).view).toBe('open')
  })

  it('shows Loading when asked early, then the done tick, then enters by itself (FR-WP-003)', () => {
    const waiting = run([...steps(['app', 'me']), { type: 'request' }])
    expect(waiting.view).toBe('waiting')
    expect(reduce(waiting, { type: 'step', step: 'emails' }).view).toBe('waiting')
    const done = run(steps(['emails', 'layout', 'socket']), waiting)
    expect(done.view).toBe('done')
    // Clicks, keys and idle during the tick change nothing; only the release opens.
    expect(run([{ type: 'request' }, { type: 'idle' }, { type: 'auto', auto: true }], done).view).toBe('done')
    expect(reduce(done, { type: 'release' })).toMatchObject({ view: 'open', entered: true })
    // A stray release elsewhere is ignored.
    expect(reduce(waiting, { type: 'release' })).toBe(waiting)
  })

  it('counts a step once', () => {
    expect(run(steps(['app', 'app'])).done).toEqual(['app'])
  })

  it('auto (phone or Skip lock) enters as soon as it is ready (FR-WP-005)', () => {
    const auto = reduce(INITIAL, { type: 'auto', auto: true })
    expect(run(steps(ALL), auto).view).toBe('open')
  })

  it('auto arriving after ready (prefs from /me) still enters on first boot', () => {
    expect(reduce(run(steps(ALL)), { type: 'auto', auto: true }).view).toBe('open')
  })

  it('never auto-opens the idle curtain', () => {
    const open = run([{ type: 'auto', auto: true }, ...steps(ALL)])
    const curtain = reduce(open, { type: 'idle' })
    expect(curtain.view).toBe('locked')
    expect(reduce(curtain, { type: 'auto', auto: true }).view).toBe('locked')
    expect(reduce(curtain, { type: 'request' }).view).toBe('open')
  })

  it('ignores idle unless open', () => {
    expect(reduce(INITIAL, { type: 'idle' })).toBe(INITIAL)
  })

  it('ring segment never vanishes and covers the outline at 100 %', () => {
    expect(ringLength(0)).toBe(8)
    expect(ringLength(65)).toBe(65)
    expect(ringLength(100)).toBe(100)
  })
})

describe('idle return (FR-WP-004)', () => {
  const min = 60_000
  it('fires after the idle period on desktop', () => {
    expect(isIdle(0, 15 * min, 15, false)).toBe(true)
    expect(isIdle(0, 14 * min, 15, false)).toBe(false)
  })
  it('is off when idle_minutes is null and never on phones', () => {
    expect(isIdle(0, 999 * min, null, false)).toBe(false)
    expect(isIdle(0, 999 * min, 15, true)).toBe(false)
  })
})

describe('effectiveMotion (FR-UI-032)', () => {
  it('follows the OS when unset', () => {
    expect(effectiveMotion(undefined, true)).toBe('reduced')
    expect(effectiveMotion(undefined, false)).toBe('full')
  })
  it('most reduction wins, unless the user explicitly chose Full', () => {
    expect(effectiveMotion('off', false)).toBe('off')
    expect(effectiveMotion('reduced', false)).toBe('reduced')
    expect(effectiveMotion('full', true)).toBe('full')
  })
})

describe('effectiveTheme (proposals §16.6)', () => {
  it('Light and Dark win; Auto and unset follow the system', () => {
    expect(effectiveTheme('light', true)).toBe('light')
    expect(effectiveTheme('dark', false)).toBe('dark')
    expect(effectiveTheme('auto', true)).toBe('dark')
    expect(effectiveTheme('auto', false)).toBe('light')
    expect(effectiveTheme(undefined, true)).toBe('dark')
  })
})
