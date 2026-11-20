import { markSignedOut } from './session'
import type { ApiErrorBody, ErrorCode, RefreshResponse } from './types'

const BASE = '/api/v1'

// Security model (CLAUDE.md, SRS §6.7 M8):
// - The 15-minute access token lives only in this module variable. It is never written to localStorage,
//   sessionStorage or a non-httpOnly cookie, because anything stored there can be read by any script that ends up on
//   the page (XSS, a compromised dependency), and it outlives the tab. In memory, it vanishes on reload and is
//   recovered from the refresh cookie.
// - The refresh token is an httpOnly cookie that scripts can't read. Only POST /auth/refresh sends it, so the
//   long-lived credential never passes through JavaScript.
// - Requests carry the access token as a Bearer header, not a cookie, so a forged cross-site request has no
//   credential attached (CSRF). The only cookie-authenticated call is refresh, and all it returns is a token that
//   a cross-site page can't read.
let accessToken: string | null = null

// Single-flight refresh: while a refresh is in progress, every 401 waits on this same promise instead of starting
// its own. Parallel refreshes could race: the server may rotate the cookie, so the losers would present a stale
// one and sign the user out, and N requests would mean N refresh calls.
let refreshing: Promise<string | null> | null = null

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details: unknown
  readonly requestId: string | null

  constructor(status: number, body: ApiErrorBody['error'] | null) {
    super(body?.message ?? `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    // Fallback for non-JSON errors, e.g. the dev proxy answering 502 while the API is down.
    this.code = body?.code ?? (status >= 500 ? 'unavailable' : 'bad_request')
    this.details = body?.details ?? null
    this.requestId = body?.request_id ?? null
  }
}

function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      // credentials: 'include' so the browser attaches the httpOnly refresh cookie.
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      accessToken = res.ok ? ((await res.json()) as RefreshResponse).access_token : null
    } catch {
      accessToken = null
    } finally {
      refreshing = null
    }
    return accessToken
  })()
  return refreshing
}

/**
 * The current access token for the WebSocket handshake (§6.5: token on connect), refreshing it if there is none.
 * The token is handed to socket.io-client in memory; it never touches storage or a URL.
 */
export async function currentAccessToken(): Promise<string | null> {
  return accessToken ?? (await refreshAccessToken())
}

/** After the socket is refused with an expired token: get a fresh one, sharing the single-flight refresh. */
export function refreshForSocket(): Promise<string | null> {
  accessToken = null
  return refreshAccessToken()
}

/** Sign out (§6.5 POST /auth/logout): the server clears the refresh cookie; the token here is dropped. */
export async function signOutNow() {
  try {
    await send('/auth/logout', { method: 'POST', credentials: 'include' }, accessToken)
  } finally {
    accessToken = null
    markSignedOut()
  }
}

function send(path: string, init: RequestInit, token: string | null) {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(`${BASE}${path}`, { ...init, headers })
}

async function errorBody(res: Response): Promise<ApiErrorBody['error'] | null> {
  try {
    return ((await res.json()) as ApiErrorBody).error ?? null
  } catch {
    return null
  }
}

/**
 * Calls the public API. On `401 unauthenticated` it refreshes the token (shared with any concurrent callers) and
 * retries exactly once. A second 401 is returned as an error, never refreshed again, so a revoked session can't
 * loop. `401 reauth_required` (FR-SEC-008) is not a token problem and is never retried.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init)
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** Same auth and retry as api(), for non-JSON downloads (e.g. the .ics file). */
export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  return (await request(path, init)).blob()
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const sentWith = accessToken
  let res = await send(path, init, sentWith)

  if (res.status === 401) {
    const body = await errorBody(res.clone())
    if (body?.code === 'unauthenticated') {
      // If another caller already refreshed while this request was in flight, reuse that token.
      const token = accessToken && accessToken !== sentWith ? accessToken : await refreshAccessToken()
      if (!token) {
        // No valid refresh cookie: the session is over (F5). The shell shows the sign-in screen.
        markSignedOut()
        throw new ApiError(401, body)
      }
      res = await send(path, init, token)
    }
  }

  if (!res.ok) throw new ApiError(res.status, await errorBody(res))
  return res
}
