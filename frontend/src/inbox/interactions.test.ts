// Task 9: selection ranges, card keys, and undo of Jira/Calendar sends (POST /actions/:id/undo) against the mock.
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { emailDetailOptions, queryClient, undoAction } from '../api/queries'
import { control } from '../mocks/control'
import { handlers } from '../mocks/handlers'
import { signIn } from '../mocks/session'
import { db, initStore } from '../mocks/store/db'
import { cardKeyAction } from './cardKeys'
import { sendProposal } from './quickActions'
import { selectRange } from './selection'

vi.stubGlobal('location', new URL('http://localhost/'))
const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  initStore({ persistEnabled: false })
  control.latency = [0, 0]
  control.jiraMode = 'ok'
  signIn(db.users[0].id)
  queryClient.clear()
})

const key = (k: string, mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) =>
  cardKeyAction({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods })

describe('selection and keys (FR-UI-027/028)', () => {
  it('Shift+click adds the run between the anchor and the target, either direction; no anchor adds just the target', () => {
    const order = ['a', 'b', 'c', 'd', 'e']
    expect([...selectRange(new Set(['a']), 'b', 'd', order)].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect([...selectRange(new Set(), 'd', 'b', order)].sort()).toEqual(['b', 'c', 'd'])
    expect([...selectRange(new Set(), null, 'c', order)]).toEqual(['c'])
    expect([...selectRange(new Set(), 'zz', 'c', order)]).toEqual(['c'])
  })

  it('maps the card shortcuts; plain letters never fire with Ctrl, Cmd or Alt', () => {
    expect([key('j'), key('k'), key('x'), key('e'), key('J', { shiftKey: true })]).toEqual(['next', 'prev', 'select', 'done', 'jira'])
    expect(key('C', { shiftKey: true })).toBeNull() // Calendar is v2
    expect(key('c', { ctrlKey: true })).toBe('copy')
    expect(key('c', { metaKey: true })).toBe('copy')
    expect(key('F10', { shiftKey: true })).toBe('menu')
    expect(key('ContextMenu')).toBe('menu')
    expect([key('e', { ctrlKey: true }), key('x', { altKey: true }), key('a')]).toEqual([null, null, null])
  })
})

describe('undo of a send (FR-UI-029, §6.5 POST /actions/:id/undo)', () => {
  const withProposal = () => [...db.emails.values()].find((e) => [...db.actions.values()].some((a) => a.email_id === e.id && a.type === 'create_jira_issue' && a.status === 'proposed'))!

  it('deletes the created issue within the window: back to proposed, off the board, audited; then 409', async () => {
    const email = withProposal()
    const sent = (await sendProposal(email.id, 'create_jira_issue'))!
    expect(sent).toMatchObject({ status: 'done', external_ref: expect.any(String), board_column: 'todo' })
    expect(sent).not.toHaveProperty('undo_until')

    const undone = await undoAction(sent)
    expect(undone).toMatchObject({ status: 'proposed', external_ref: null, board_column: null, board_position: null })
    expect(db.audit.at(-1)).toMatchObject({ event: 'action.undo', target: sent.id })
    const detail = await queryClient.fetchQuery(emailDetailOptions(email.id))
    expect(detail.actions.find((a) => a.id === sent.id)?.status).toBe('proposed')

    const again = await undoAction(sent).catch((e: unknown) => e)
    expect(again).toBeInstanceOf(ApiError)
    expect(again).toMatchObject({ status: 409, code: 'conflict' })
  })

  it('refuses after the window', async () => {
    const sent = (await sendProposal(withProposal().id, 'create_jira_issue'))!
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 13_000)
    try {
      expect(await undoAction(sent).catch((e: unknown) => e)).toMatchObject({ status: 409 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('credentials (FR-SEC-007, QA pass 5)', () => {
  it('there is no Reveal: the detail lists only credential types and links to the message in Gmail', async () => {
    const secret = db.secrets.find((x) => x.owner_user_id === db.users[0].id)!
    signIn(secret.owner_user_id)
    const detail = await queryClient.fetchQuery(emailDetailOptions(secret.email_id!))
    expect(detail.masked_secrets).toEqual(expect.arrayContaining([{ id: secret.id, secret_type: secret.secret_type }]))
    expect(detail.open_url).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?authuser=.+#all\/[0-9a-f]+$/)
    expect('value' in secret).toBe(false)
  })
})
