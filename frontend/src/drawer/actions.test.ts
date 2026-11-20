// Task 7 client paths against the real mock (msw/node): handled removal, accept, links, .ics.
import { InfiniteQueryObserver } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptAction, emailListOptions, followLink, queryClient, rejectAction, updateEmail } from '../api/queries'
import { apiBlob } from '../api/client'
import { arrivals } from '../api/realtime'
import type { DecoderActionPayload, EmailDetail, EmailListItem, Page } from '../api/types'
import { control } from '../mocks/control'
import { handlers } from '../mocks/handlers'
import { signIn } from '../mocks/session'
import { db, initStore } from '../mocks/store/db'

vi.stubGlobal('location', new URL('http://localhost/'))
const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  initStore({ persistEnabled: false })
  control.latency = [0, 0]
  control.speed = 1000
  control.jiraMode = 'ok'
  signIn(db.users[0].id)
  queryClient.clear()
  arrivals.clear()
})

const items = (query: string) => queryClient.getQueryData<{ pages: Page<EmailListItem>[] }>(emailListOptions(query).queryKey)!.pages.flatMap((p) => p.items)

describe('drawer and quick actions (task 7)', () => {
  it('Done (handled) leaves the default inbox in place and joins nothing it does not match', async () => {
    await queryClient.fetchInfiniteQuery(emailListOptions(''))
    await queryClient.fetchInfiniteQuery(emailListOptions('view=handled'))
    const before = items('')
    const target = before[3]
    const detail = await updateEmail(target.id, { handled: true })
    expect(detail.handled).toBe(true)
    expect(items('').map((e) => e.id)).toEqual(before.filter((e) => e.id !== target.id).map((e) => e.id))
    expect(queryClient.getQueryData<EmailDetail>(['email', target.id])?.handled).toBe(true)

    // F11: the Handled list was cached before the change and isn't on screen: it's marked stale, so showing it
    // reloads it with the email, whatever order the socket echo and the response came in.
    expect(queryClient.getQueryState(emailListOptions('view=handled').queryKey)?.isInvalidated).toBe(true)
    await queryClient.fetchInfiniteQuery(emailListOptions('view=handled'))
    expect(items('view=handled').some((e) => e.id === target.id)).toBe(true)

    // Restore with the inbox on screen: it leaves Handled, isn't inserted into the inbox, and counts in "↑ n new".
    const onScreen = new InfiniteQueryObserver(queryClient, emailListOptions(''))
    const stop = onScreen.subscribe(() => {})
    await updateEmail(target.id, { handled: false })
    expect(items('view=handled').some((e) => e.id === target.id)).toBe(false)
    expect(items('').some((e) => e.id === target.id)).toBe(false)
    expect(arrivals.get().map((a) => a.email)).toContainEqual(expect.objectContaining({ id: target.id, handled: false }))
    stop()
  })

  it('Done then Restore is deterministic across repeated toggles (F11)', async () => {
    await queryClient.fetchInfiniteQuery(emailListOptions(''))
    await queryClient.fetchInfiniteQuery(emailListOptions('view=handled'))
    const target = items('')[2]
    for (let i = 0; i < 3; i++) {
      await updateEmail(target.id, { handled: true })
      await queryClient.fetchInfiniteQuery(emailListOptions('view=handled'))
      expect(items('').some((e) => e.id === target.id)).toBe(false)
      expect(items('view=handled').some((e) => e.id === target.id)).toBe(true)
      await updateEmail(target.id, { handled: false })
      await queryClient.fetchInfiniteQuery(emailListOptions(''))
      expect(items('view=handled').some((e) => e.id === target.id)).toBe(false)
      expect(items('').some((e) => e.id === target.id)).toBe(true)
    }
  })

  it('accept sends the proposal and patches the open detail; a 502 refetches it as failed', async () => {
    const row = [...db.actions.values()].find((a) => a.user_id === db.users[0].id && a.type === 'create_jira_issue' && a.status === 'proposed')!
    const detail = await queryClient.fetchQuery({ queryKey: ['email', row.email_id], queryFn: () => import('../api/client').then(({ api }) => api<EmailDetail>(`/emails/${row.email_id}`)) })
    const action = detail.actions.find((a) => a.id === row.id)!
    const done = await acceptAction(action)
    expect(done).toMatchObject({ status: 'done', external_ref: expect.stringMatching(/^[A-Z]+-\d+$/) })
    expect(queryClient.getQueryData<EmailDetail>(['email', row.email_id])!.actions.find((a) => a.id === row.id)?.status).toBe('done')

    const other = [...db.actions.values()].find((a) => a.user_id === db.users[0].id && a.type === 'create_jira_issue' && a.status === 'proposed')!
    control.jiraMode = 'server_error'
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    await expect(acceptAction({ ...(await import('../mocks/store/serialize')).toAction(other) })).rejects.toMatchObject({ status: 502, code: 'upstream_error' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['email', other.email_id] })
    spy.mockRestore()
  })

  it('accept routes a Jira issue to the given project, or the primary project, and validates the target (§25.2)', async () => {
    const { toAction } = await import('../mocks/store/serialize')
    const { jiraTarget } = await import('../mocks/routes/actions')
    const me = db.users[0]
    const proposals = [...db.actions.values()].filter((a) => a.user_id === me.id && a.type === 'create_jira_issue' && a.status === 'proposed')
    await expect(acceptAction(toAction(proposals[0]), undefined, { project_key: 'bad key', epic: null })).rejects.toMatchObject({ status: 422 })
    const done = await acceptAction(toAction(proposals[0]), undefined, { project_key: 'ONB', epic: 'ONB-7' })
    expect(done.external_ref).toMatch(/^ONB-\d+$/)
    // Without a target: the primary project's Jira project and epic, else the tenant default.
    const project = db.projects.find((p) => p.user_id === me.id && p.jira_project_key === 'ATL' && p.jira_epic)!
    const row = proposals[1]
    db.projectItems = db.projectItems.filter((i) => i.email_id !== row.email_id)
    expect(jiraTarget(row, me)).toEqual({ project_key: db.settings.jira.project_key, epic: null })
    db.projectItems.push({ project_id: project.id, email_id: row.email_id, action_id: null, is_primary: true, added_at: new Date().toISOString() })
    expect(jiraTarget(row, me)).toEqual({ project_key: 'ATL', epic: project.jira_epic })
  })

  it('sends a card to Jira and Calendar (§27.2): off the board, listed under the card, validated', async () => {
    const { createCard, sendCard } = await import('../api/queries')
    const card = await createCard({ title: 'Call vendor', urgency: 'High' })
    const jira = await sendCard(card.id, 'create_jira_issue', { title: 'Call vendor' })
    expect(jira).toMatchObject({ status: 'done', card_id: card.id, email_id: null, board_column: null, external_ref: expect.stringMatching(/^[A-Z]+-\d+$/) })
    expect((db.actions.get(jira.id)!.payload as DecoderActionPayload).priority).toBe('High')
    const start = new Date(Date.now() + 86_400_000).toISOString()
    const ev = await sendCard(card.id, 'add_calendar_event', { title: 'Call vendor', start, end: new Date(Date.parse(start) + 3_600_000).toISOString(), attendees: [db.users[0].email] })
    expect(ev.status).toBe('done')
    const { api } = await import('../api/client')
    const listed = await api<Page<{ id: string }>>(`/actions?card=${card.id}`)
    expect(listed.items.map((a) => a.id).sort()).toEqual([jira.id, ev.id].sort())
    // Not a card you made → 409; an email's action can't be sent from a card.
    const emailAction = [...db.actions.values()].find((a) => a.email_id)!
    await expect(sendCard(emailAction.id, 'create_jira_issue', { title: 'x' })).rejects.toMatchObject({ status: 409 })
  })

  it('reject marks the proposal declined', async () => {
    const row = [...db.actions.values()].find((a) => a.user_id === db.users[0].id && a.status === 'proposed')!
    const { toAction } = await import('../mocks/store/serialize')
    expect((await rejectAction(toAction(row))).status).toBe('rejected')
  })

  it('followLink returns the §6.4.1 click-time shapes: open, interstitial, blocked', async () => {
    const mine = db.urlChecks.filter((c) => db.emails.get(c.email_id)?.user_id === db.users[0].id)
    const go = (v: string) => followLink(`/api/v1/links/${mine.find((c) => c.verdict === v)!.id}/go`)
    expect(await go('clean')).toMatchObject({ action: 'open', url: expect.stringMatching(/^https?:/) })
    expect(await go('suspicious')).toMatchObject({ action: 'interstitial', verdict: 'suspicious', chain: expect.any(Array), signals: expect.any(Array) })
    const blocked = await go('malicious')
    expect(blocked).toMatchObject({ action: 'blocked', verdict: 'malicious' })
    expect(blocked).not.toHaveProperty('url')
  })

  it('the .ics download is a text/calendar file through the authenticated client', async () => {
    const meeting = [...db.actions.values()].find((a) => a.user_id === db.users[0].id && a.type === 'add_calendar_event' && db.emails.get(a.email_id!)?.triage?.email_type.label === 'Meeting')!
    const blob = await apiBlob(`/emails/${meeting.email_id}/ics`, { headers: { Accept: 'text/calendar' } })
    expect(await blob.text()).toMatch(/^BEGIN:VCALENDAR/)
  })
})

describe('read-marking (proposals §12.3)', () => {
  it('reading leaves the Unread list; marking unread brings it back on the next load, never inserted', async () => {
    await queryClient.fetchInfiniteQuery(emailListOptions('view=unread'))
    await queryClient.fetchInfiniteQuery(emailListOptions(''))
    const target = items('view=unread')[0]
    expect(target.read).toBe(false)
    await updateEmail(target.id, { read: true })
    expect(items('view=unread').some((e) => e.id === target.id)).toBe(false)
    expect(items('').find((e) => e.id === target.id)?.read).toBe(true) // patched in place in the inbox
    await updateEmail(target.id, { read: false })
    expect(items('view=unread').some((e) => e.id === target.id)).toBe(false) // not inserted
    expect(queryClient.getQueryState(emailListOptions('view=unread').queryKey)?.isInvalidated).toBe(true)
    await queryClient.fetchInfiniteQuery(emailListOptions('view=unread'))
    expect(items('view=unread').some((e) => e.id === target.id)).toBe(true)
  })
})

describe('seed data for the browser checks', () => {
  it('one email carries every click-time link outcome, plus a slow check', async () => {
    const sample = [...db.emails.values()].find((e) => e.user_id === db.users[0].id && e.subject === 'Links for this week’s planning')!
    const checks = db.urlChecks.filter((c) => c.email_id === sample.id)
    const go = (anchor: string) => followLink(`/api/v1/links/${checks.find((c) => c.anchor_text === anchor)!.id}/go`)
    expect(await go('Sprint board')).toMatchObject({ action: 'open' })
    // Delivered clean; the click-time resolver finds the redirect now lands somewhere suspicious.
    expect(checks.find((c) => c.anchor_text === 'Shared slides')!.verdict).toBe('clean')
    expect(await go('Shared slides')).toMatchObject({ action: 'interstitial', final_url: 'https://slides-share.example/view/88' })
    expect(await go('Vendor portal')).toMatchObject({ action: 'interstitial', verdict: 'suspicious' })
    expect(await go('Invoice viewer')).toMatchObject({ action: 'blocked' })
    expect(checks.find((c) => c.anchor_text === 'Last year’s archive')!.click_delay_ms).toBeGreaterThan(5_000)
  })

  it('event times match the summary text (wall clock, never before the email)', () => {
    const events = [...db.actions.values()].filter((a) => a.type === 'add_calendar_event').map((a) => ({ ...a, payload: a.payload as DecoderActionPayload })).filter((a) => a.payload.start)
    expect(events.length).toBeGreaterThan(0)
    for (const a of events) {
      const email = db.emails.get(a.email_id!)!
      const start = new Date(a.payload.start!)
      expect(start.getTime()).toBeGreaterThan(Date.parse(email.received_at))
      const want = { 'Contoso renewal call': [15, null], 'Onboarding flow design review': [11, 4], 'Weekly sync': [10, 1] }[a.payload.title!]
      if (!want) continue
      expect(start.getHours()).toBe(want[0])
      expect(start.getMinutes()).toBe(0)
      if (want[1] !== null) expect(start.getDay()).toBe(want[1])
    }
  })
})
