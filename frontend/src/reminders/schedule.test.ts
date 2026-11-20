import { describe, expect, it } from 'vitest'
import { mergeClose, reminderTimes } from './schedule'

const d = (y: number, m: number, day: number, h: number, min = 0) => new Date(y, m - 1, day, h, min)

describe('reminderTimes', () => {
  it('a date only: 21:00 the night before and 09:00 on the day', () => {
    expect(reminderTimes({ date: '2026-11-20', time: null, critical: false })).toEqual([d(2026, 11, 19, 21), d(2026, 11, 20, 9)])
  })
  it('a time adds one hour before; a Critical item adds 24 h before', () => {
    expect(reminderTimes({ date: '2026-11-20', time: '17:00', critical: false })).toEqual([d(2026, 11, 19, 21), d(2026, 11, 20, 9), d(2026, 11, 20, 16)])
    expect(reminderTimes({ date: '2026-11-20', time: '17:00', critical: true })).toEqual([d(2026, 11, 19, 17), d(2026, 11, 19, 21), d(2026, 11, 20, 9), d(2026, 11, 20, 16)])
  })
  it('merges reminders within 30 min: the 1 h before of a 09:30 deadline folds into 09:00', () => {
    expect(reminderTimes({ date: '2026-11-20', time: '09:30', critical: false })).toEqual([d(2026, 11, 19, 21), d(2026, 11, 20, 9)])
    expect(reminderTimes({ date: '2026-11-20', time: '10:00', critical: false })).toEqual([d(2026, 11, 19, 21), d(2026, 11, 20, 9)])
  })
})

describe('mergeClose', () => {
  it('keeps the later of two close times and sorts', () => {
    expect(mergeClose([d(2026, 1, 1, 10, 20), d(2026, 1, 1, 9), d(2026, 1, 1, 10)])).toEqual([d(2026, 1, 1, 9), d(2026, 1, 1, 10, 20)])
  })
})
