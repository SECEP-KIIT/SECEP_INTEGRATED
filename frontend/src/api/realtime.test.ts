import { QueryClient, type InfiniteData } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../mocks/store/generate'
import { toAction, toDetail, toListItem } from '../mocks/store/serialize'
import { matchesColumn, parseColumnQuery } from '../inbox/cardModel'
import { localDate } from '../lib/due'
import { applyEvent, arrivals } from './realtime'
import type { EmailDetail, EmailListItem, Page } from './types'

const db = createDb(Date.parse('2026-11-04T10:00:00Z'))
const items = [...db.emails.values()].filter((e) => e.user_id === db.users[0].id).slice(0, 5).map((e) => toListItem(db, e))
const LIST_KEY = ['emails', { type: 'Task' }]

let qc: QueryClient
beforeEach(() => {
  qc = new QueryClient()
  qc.setQueryData<Page<EmailListItem>>(LIST_KEY, { items, next_cursor: null })
  arrivals.clear()
})
const list = () => qc.getQueryData<Page<EmailListItem>>(LIST_KEY)!.items

describe('realtime cache policy (task 5 refinement 1)', () => {
  it('email.triaged for a known email patches it in place, without reordering', () => {
    const target = items[2]
    const relabelled = { ...target, triage: { ...target.triage!, urgency: { label: 'Critical' as const, confidence: 1 } } }
    applyEvent(qc, 'email.triaged', { email_id: target.id, email: relabelled })
    expect(list().map((e) => e.id)).toEqual(items.map((e) => e.id))
    expect(list()[2].triage?.urgency.label).toBe('Critical')
    expect(arrivals.get()).toEqual([])
  })

  it('email.triaged for an unknown email is only signalled, never inserted into a visible list', () => {
    const fresh = { ...items[0], id: 'brand-new-id' }
    applyEvent(qc, 'email.triaged', { email_id: fresh.id, email: fresh })
    expect(list()).toHaveLength(items.length)
    expect(list().some((e) => e.id === fresh.id)).toBe(false)
    expect(arrivals.get().map((a) => a.email.id)).toEqual(['brand-new-id'])
  })

  it('email.enriched and email.flagged patch in place; detail-only fields stay out of lists', () => {
    const target = items[1]
    applyEvent(qc, 'email.enriched', { email_id: target.id, status: 'enriched', summary_one_line: 'One line', summary_short: 'Short', actions: [] })
    applyEvent(qc, 'email.flagged', { email_id: target.id, security_flag: 'suspicious', links: [] })
    const patched = list()[1]
    expect(patched).toMatchObject({ summary_one_line: 'One line', security_flag: 'suspicious', proposed_action_count: 0 })
    expect(patched).not.toHaveProperty('summary_short')
    expect(patched).not.toHaveProperty('links')
    expect(list().map((e) => e.id)).toEqual(items.map((e) => e.id))
  })

  it('the open detail gets the detail fields too', () => {
    const row = db.emails.get(items[1].id)!
    qc.setQueryData<EmailDetail>(['email', row.id], toDetail(db, row))
    applyEvent(qc, 'email.enriched', { email_id: row.id, status: 'enriched', summary_one_line: 'x', summary_short: 'Short summary', actions: [] })
    expect(qc.getQueryData<EmailDetail>(['email', row.id])?.summary_short).toBe('Short summary')
  })

  it('action.updated replaces an action in place in action lists', () => {
    const actions = [...db.actions.values()].slice(0, 3).map(toAction)
    qc.setQueryData(['actions', {}], { items: actions, next_cursor: null })
    const updated = { ...actions[1], status: 'done' as const, external_ref: 'ATL-999' }
    applyEvent(qc, 'action.updated', { action: updated })
    const after = qc.getQueryData<Page<typeof updated>>(['actions', {}])!.items
    expect(after.map((a) => a.id)).toEqual(actions.map((a) => a.id))
    expect(after[1].external_ref).toBe('ATL-999')
  })

  it('column widgets (infinite pages) are patched in place too; arrivals keep their card and get patched', () => {
    const key = ['emails', 'list', '']
    const pages = { pages: [{ items: items.slice(0, 2), next_cursor: 'c' }, { items: items.slice(2), next_cursor: null }], pageParams: [null, 'c'] }
    qc.setQueryData<InfiniteData<Page<EmailListItem>>>(key, pages)
    const target = items[3]
    applyEvent(qc, 'email.flagged', { email_id: target.id, security_flag: 'malicious', links: [] })
    const after = qc.getQueryData<InfiniteData<Page<EmailListItem>>>(key)!
    expect(after.pages.flatMap((p) => p.items).map((e) => e.id)).toEqual(items.map((e) => e.id))
    expect(after.pages[1].items[1].security_flag).toBe('malicious')
    expect(after.pageParams).toEqual([null, 'c'])

    const fresh = { ...items[0], id: 'arrival-1', summary_one_line: null }
    applyEvent(qc, 'email.triaged', { email_id: fresh.id, email: fresh })
    applyEvent(qc, 'email.enriched', { email_id: fresh.id, status: 'enriched', summary_one_line: 'Now summarised', summary_short: 's', actions: [] })
    expect(arrivals.get()).toHaveLength(1)
    expect(arrivals.get()[0].email.summary_one_line).toBe('Now summarised')
    expect(arrivals.get()[0].email).not.toHaveProperty('summary_short')
    expect(qc.getQueryData<InfiniteData<Page<EmailListItem>>>(key)!.pages.flatMap((p) => p.items)).toHaveLength(items.length)
  })
})

describe('live updates reach dashboard tiles (QA pass 3, commit 1)', () => {
  const action = (payload: Record<string, unknown>) => ({ ...toAction([...db.actions.values()][0]), status: 'proposed' as const, payload: { ...[...db.actions.values()][0].payload, due_date: null, start: null, ...payload } })

  it('an arrival whose due date only appears at enrichment counts towards a Due today tile', () => {
    const today = localDate(new Date().toISOString())
    const fresh = { ...items[0], id: 'arrival-due', due_date: null, handled: false }
    applyEvent(qc, 'email.triaged', { email_id: fresh.id, email: fresh })
    const dueToday = parseColumnQuery('view=due_today').filters
    expect(matchesColumn(arrivals.get()[0].email, dueToday, false)).toBe(false)

    applyEvent(qc, 'email.enriched', { email_id: fresh.id, status: 'enriched', summary_one_line: 'x', summary_short: 'y', actions: [action({ due_date: today })] })
    expect(arrivals.get()[0].email.due_date).toBe(today)
    expect(matchesColumn(arrivals.get()[0].email, dueToday, false)).toBe(true)
  })

  it('handled in another tab or session (email.triaged) leaves lists it no longer belongs to', () => {
    const key = ['emails', 'list', '']
    qc.setQueryData<InfiniteData<Page<EmailListItem>>>(key, { pages: [{ items, next_cursor: null }], pageParams: [null] })
    const target = { ...items[2], handled: true }
    applyEvent(qc, 'email.triaged', { email_id: target.id, email: target })
    const after = qc.getQueryData<InfiniteData<Page<EmailListItem>>>(key)!.pages[0].items
    expect(after.map((e) => e.id)).toEqual(items.filter((e) => e.id !== target.id).map((e) => e.id))
    // A plain relabel (no state change) still patches in place without removing anything.
    applyEvent(qc, 'email.triaged', { email_id: items[1].id, email: { ...items[1], subject: 'Relabelled' } })
    expect(qc.getQueryData<InfiniteData<Page<EmailListItem>>>(key)!.pages[0].items).toHaveLength(items.length - 1)
  })
})
