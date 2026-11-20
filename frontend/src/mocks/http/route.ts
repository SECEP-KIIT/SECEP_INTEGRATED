// Route wrapper for every mock endpoint: deny-by-default access (SRS §4.3 / FR-ADM-005), body parsing, latency and
// the §6.4.1 error envelope. A route cannot be registered without an access rule, and unmatched /api/v1 paths get
// 404 (see `fallback`). Ownership ("owner" in §6.5) is checked in the handler with `own()`, answering 404 so other
// users' ids aren't confirmed to exist.
import { delay, http, HttpResponse, type DefaultBodyType, type PathParams } from 'msw'
import type { ApiErrorBody, ErrorCode } from '../../api/types'
import { control } from '../control'
import { currentSession, userIdForToken } from '../session'
import { userById } from '../store/db'
import type { UserRow } from '../store/types'

export const API = '/api/v1'

/** §6.5 Access column. `owner` routes register as `user` and check ownership in the handler. */
export type Access = 'public' | 'cookie' | 'user' | 'admin' | 'security.review'

export class Fail extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details: unknown
  constructor(status: number, code: ErrorCode, message: string, details: unknown = null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

let seq = 0
export const requestId = () => `req_mock_${(++seq).toString(36)}`

export const errorResponse = (status: number, code: ErrorCode, message: string, details: unknown = null, headers?: HeadersInit) =>
  HttpResponse.json<ApiErrorBody>({ error: { code, message, details, request_id: requestId() } }, { status, headers })

export interface Ctx<P extends PathParams = PathParams> {
  request: Request
  params: P
  url: URL
  /** The caller; null only on public and cookie routes. */
  user: UserRow
  body: unknown
}

type Result = Response | object | undefined
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** Registered routes, so tests can check every §6.5 route exists with the right access rule. */
export const registry: { method: Method; path: string; access: Access }[] = []

function authenticate(request: Request, access: Access): UserRow | null {
  if (access === 'public') return null
  if (access === 'cookie') {
    const s = currentSession()
    return s ? (userById(s.user_id) ?? null) : null
  }
  const header = request.headers.get('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  const userId = userIdForToken(token)
  return userId ? (userById(userId) ?? null) : null
}

function authorize(user: UserRow, access: Access) {
  if (access === 'admin' && !user.is_admin) throw new Fail(403, 'forbidden', 'Admins only')
  if (access === 'security.review' && !user.permissions.includes('security.review')) {
    throw new Fail(403, 'forbidden', 'Requires the security.review permission')
  }
}

export function route<P extends PathParams = PathParams>(
  method: Method,
  path: string,
  access: Access,
  handler: (ctx: Ctx<P>) => Result | Promise<Result>,
  { status = 200, raw = false }: { status?: number; raw?: boolean } = {},
) {
  registry.push({ method, path, access })
  return http[method]<P, DefaultBodyType>(`${API}${path}`, async ({ request, params }) => {
    const [min, max] = control.latency
    if (max > 0) await delay(min + Math.random() * (max - min))
    try {
      const user = authenticate(request, access)
      if (!user && access !== 'public') {
        throw new Fail(401, 'unauthenticated', access === 'cookie' ? 'Not signed in' : 'Missing or expired access token')
      }
      if (user) authorize(user, access)

      let body: unknown = undefined
      // raw: the handler reads the body itself (multipart uploads).
      if (!raw && method !== 'get' && method !== 'delete' && request.headers.get('Content-Length') !== '0') {
        const text = await request.text()
        if (text) {
          try {
            body = JSON.parse(text)
          } catch {
            throw new Fail(400, 'bad_request', 'Malformed JSON body')
          }
        }
      }

      const result = await handler({ request, params, url: new URL(request.url), user: user!, body })
      if (result instanceof Response) return result
      if (result === undefined) return new HttpResponse(null, { status: 204 })
      return HttpResponse.json(result as DefaultBodyType, { status })
    } catch (err) {
      if (err instanceof Fail) return errorResponse(err.status, err.code, err.message, err.details)
      console.error('[mock] handler crashed', err)
      return errorResponse(503, 'unavailable', 'Mock handler error')
    }
  })
}

/** Deny by default: any /api/v1 path without a handler is a 404, never passed through to the network. */
export const fallback = http.all(`${API}/*`, ({ request }) => {
  console.warn(`[mock] no handler for ${request.method} ${new URL(request.url).pathname}`)
  return errorResponse(404, 'not_found', 'No such route')
})

/** Owner check: the row must belong to the caller, else 404 (don't confirm other users' ids). */
export function own<T extends { user_id?: string; owner_user_id?: string }>(row: T | undefined, user: UserRow, what: string): T {
  if (!row || (row.user_id ?? row.owner_user_id) !== user.id) throw new Fail(404, 'not_found', `${what} not found`)
  return row
}
