import { describe, expect, it } from 'vitest'
import { remindChoices } from './remindChoices'

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

describe('remindChoices', () => {
  it('offers later today (3 h, on the half hour), tomorrow 9 am and next Monday 9 am', () => {
    const now = local(2026, 11, 19, 10, 10) // Thursday
    const [later, tomorrow, week] = remindChoices(now)
    expect(later.at).toEqual(local(2026, 11, 19, 13, 30))
    expect(tomorrow.at).toEqual(local(2026, 11, 20, 9))
    expect(week.at).toEqual(local(2026, 11, 23, 9))
  })
  it('drops "later today" when it would be tomorrow', () => {
    expect(remindChoices(local(2026, 11, 19, 22, 0)).map((c) => c.id)).toEqual(['tomorrow', 'week'])
  })
  it('next week is always the following Monday, even on a Monday or Sunday', () => {
    expect(remindChoices(local(2026, 11, 23, 8)).at(-1)!.at).toEqual(local(2026, 11, 30, 9))
    expect(remindChoices(local(2026, 11, 22, 8)).at(-1)!.at).toEqual(local(2026, 11, 23, 9))
  })
})
