import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const unauthenticated = () =>
  Response.json(
    { error: { code: 'unauthenticated', message: 'Token expired', details: null, request_id: 'req_1' } },
    { status: 401 },
  )

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

// The module keeps the token in a module variable, so each test imports a fresh copy.
async function setup(handler: Handler) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => Promise.resolve(handler(url, init)))
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  const mod = await import('./client')
  const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => url === `/api/v1${path}`)
  return { ...mod, fetchMock, calls }
}

const auth = (init: RequestInit) => new Headers(init.headers).get('Authorization')

beforeEach(() => vi.useRealTimers())
afterEach(() => vi.unstubAllGlobals())

describe('session end (F5)', () => {
  it('a failed refresh marks the app signed out; so does signOutNow, which also calls /auth/logout', async () => {
    const { api } = await setup((url) => (url.endsWith('/auth/refresh') ? new Response(null, { status: 401 }) : unauthenticated()))
    const session = await import('./session')
    expect(session.isSignedOut()).toBe(false)
    await expect(api('/me')).rejects.toMatchObject({ status: 401 })
    expect(session.isSignedOut()).toBe(true)

    const second = await setup(() => new Response(null, { status: 204 }))
    const s2 = await import('./session')
    expect(s2.isSignedOut()).toBe(false)
    await second.signOutNow()
    expect(second.calls('/auth/logout')).toHaveLength(1)
    expect(s2.isSignedOut()).toBe(true)
  })
})

describe('api()', () => {
  it('shares one refresh between concurrent 401s, then retries each request once', async () => {
    const { api, calls } = await setup(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 10)) // still in flight when the other 401s arrive
        return Response.json({ access_token: 't1', expires_in: 900 })
      }
      return auth(init) === 'Bearer t1' ? Response.json({ ok: url }) : unauthenticated()
    })

    const results = await Promise.all([api('/me'), api('/emails'), api('/emails/1')])

    expect(results).toEqual([{ ok: '/api/v1/me' }, { ok: '/api/v1/emails' }, { ok: '/api/v1/emails/1' }])
    expect(calls('/auth/refresh')).toHaveLength(1)
    for (const path of ['/me', '/emails', '/emails/1']) expect(calls(path)).toHaveLength(2)
  })

  it('sends the refresh as POST with the cookie, and the token only as a Bearer header', async () => {
    const { api, calls } = await setup((url, init) =>
      url.endsWith('/auth/refresh')
        ? Response.json({ access_token: 't1', expires_in: 900 })
        : auth(init) ? Response.json({}) : unauthenticated(),
    )

    await api('/me')

    const [[, refreshInit]] = calls('/auth/refresh')
    expect(refreshInit).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(auth(calls('/me')[1][1] ?? {})).toBe('Bearer t1')
  })

  it('gives up after one retry instead of refreshing again', async () => {
    const { api, ApiError, calls } = await setup((url) =>
      url.endsWith('/auth/refresh') ? Response.json({ access_token: 't1', expires_in: 900 }) : unauthenticated(),
    )

    await expect(api('/me')).rejects.toBeInstanceOf(ApiError)
    expect(calls('/auth/refresh')).toHaveLength(1)
    expect(calls('/me')).toHaveLength(2)
  })

  it('does not retry when the refresh itself fails', async () => {
    const { api, calls } = await setup(() => unauthenticated())

    await expect(api('/me')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(calls('/auth/refresh')).toHaveLength(1)
    expect(calls('/me')).toHaveLength(1)
  })

  it('never refreshes on reauth_required (FR-SEC-008)', async () => {
    const details = { reauth_url: '/api/v1/auth/google' }
    const { api, calls } = await setup(() =>
      Response.json(
        { error: { code: 'reauth_required', message: 'Sign in again', details, request_id: 'req_2' } },
        { status: 401 },
      ),
    )

    await expect(api('/secrets/1/reveal', { method: 'POST' })).rejects.toMatchObject({
      code: 'reauth_required',
      details,
    })
    expect(calls('/auth/refresh')).toHaveLength(0)
  })

  it('maps the §6.4.1 error envelope onto ApiError', async () => {
    const { api } = await setup(() =>
      Response.json(
        { error: { code: 'not_found', message: 'No such email', details: null, request_id: 'req_3' } },
        { status: 404 },
      ),
    )

    await expect(api('/emails/x')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'No such email',
      requestId: 'req_3',
    })
  })
})
