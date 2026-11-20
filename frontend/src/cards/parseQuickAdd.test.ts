import { describe, expect, it } from 'vitest'
import { matchProject, parseQuickAdd } from './parseQuickAdd'

// Wednesday 19 Nov 2026, 14:00 local.
const NOW = new Date(2026, 10, 19, 14, 0)

describe('parseQuickAdd (FR-CNT-001)', () => {
  it('pulls date, time, project, urgency and person out of the title', () => {
    const p = parseQuickAdd('Send deck to Priya fri 5pm #Atlas !high @priya', NOW)
    expect(p).toMatchObject({ title: 'Send deck to Priya', due_date: '2026-11-20', due_time: '17:00', urgency: 'High', projects: ['Atlas'], person: 'priya' })
    expect(p.chips.map((c) => c.kind)).toEqual(['date', 'time', 'project', 'urgency', 'person'])
  })

  it('knows today, tomorrow, next week and in n days', () => {
    expect(parseQuickAdd('call bank today', NOW).due_date).toBe('2026-11-19')
    expect(parseQuickAdd('call bank tomorrow', NOW).due_date).toBe('2026-11-20')
    expect(parseQuickAdd('plan next week', NOW).due_date).toBe('2026-11-23')
    expect(parseQuickAdd('renew in 3 days', NOW)).toMatchObject({ title: 'renew', due_date: '2026-11-22' })
    expect(parseQuickAdd('review in 2 weeks', NOW).due_date).toBe('2026-12-03')
  })

  it('reads day-month dates, rolling past ones to next year', () => {
    expect(parseQuickAdd('submit 21 Nov', NOW).due_date).toBe('2026-11-21')
    expect(parseQuickAdd('submit Nov 21st', NOW).due_date).toBe('2026-11-21')
    expect(parseQuickAdd('submit 25/12', NOW).due_date).toBe('2026-12-25')
    expect(parseQuickAdd('taxes 10 jan', NOW).due_date).toBe('2027-01-10')
  })

  it('reads times, and puts a bare time today or tomorrow', () => {
    expect(parseQuickAdd('sync at 5:30 pm', NOW)).toMatchObject({ title: 'sync', due_time: '17:30', due_date: '2026-11-19' })
    expect(parseQuickAdd('standup 09:15', NOW)).toMatchObject({ due_time: '09:15', due_date: '2026-11-20' })
    expect(parseQuickAdd('lunch noon tomorrow', NOW)).toMatchObject({ title: 'lunch', due_time: '12:00', due_date: '2026-11-20' })
  })

  it('leaves ordinary words and numbers alone', () => {
    const p = parseQuickAdd('Buy 3 monitors for the may launch', NOW)
    expect(p).toMatchObject({ title: 'Buy 3 monitors for the may launch', due_date: null, due_time: null, urgency: null })
    expect(parseQuickAdd('ship v2!', NOW).title).toBe('ship v2!')
  })

  it('matches #tags to live projects', () => {
    const projects = [
      { name: 'Q3 board meeting', archived_at: null },
      { name: 'Pune client visit', archived_at: null },
      { name: 'Old', archived_at: '2026-01-01T00:00:00Z' },
    ]
    expect(matchProject('q3', projects)?.name).toBe('Q3 board meeting')
    expect(matchProject('PuneClientVisit', projects)?.name).toBe('Pune client visit')
    expect(matchProject('old', projects)).toBeNull()
  })
})
