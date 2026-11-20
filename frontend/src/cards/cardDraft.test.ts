import { describe, expect, it } from 'vitest'
import { cardDraft } from './cardDraft'

const card = { title: 'Call vendor', description: 'About the quote', due_date: '2026-11-21', due_time: '15:30', urgency: 'Critical' as const, checklist: [], source: null, person: null }

describe('cardDraft', () => {
  it('prefills a Jira issue from the card', () => {
    expect(cardDraft(card, 'create_jira_issue')).toMatchObject({ title: 'Call vendor', description: 'About the quote', priority: 'Highest', due_date: '2026-11-21' })
  })
  it('places an event at the due time for an hour, else tomorrow 9 am', () => {
    const e = cardDraft(card, 'add_calendar_event')
    expect(new Date(e.start!).getHours()).toBe(15)
    expect(Date.parse(e.end!) - Date.parse(e.start!)).toBe(3_600_000)
    expect(cardDraft(card, 'add_calendar_event', new Date(), 'me@x.example').attendees).toEqual(['me@x.example'])
    expect(cardDraft({ ...card, urgency: null }, 'create_jira_issue').priority).toBe('Medium')
    const t = cardDraft({ ...card, due_date: null, due_time: null }, 'add_calendar_event', new Date(2026, 10, 19, 22))
    expect([new Date(t.start!).getDate(), new Date(t.start!).getHours()]).toEqual([20, 9])
  })
})
