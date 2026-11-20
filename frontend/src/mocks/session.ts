// Mock sign-in state. In production the session is an httpOnly refresh cookie that scripts can't read. The mock
// can't set one (the service worker sees no real cookies), so it keeps only the signed-in user id and the time of the
// last Google sign-in in sessionStorage. Neither is a credential: tokens exist only in this module's memory.
import { USERS } from './store/generate'

const KEY = 'secep.mock.session'
const ACCESS_TTL_S = 900 // 15-minute access tokens (§6.5)
export const REAUTH_WINDOW_MS = 5 * 60_000 // FR-SEC-008

interface Session {
  user_id: string
  signed_in_at: number
}

const store = () => (typeof sessionStorage === 'undefined' ? null : sessionStorage)

function read(): Session | null {
  try {
    const raw = store()?.getItem(KEY)
    if (raw === undefined || raw === null) return { user_id: USERS[0].id, signed_in_at: Date.now() } // first visit: signed in as the demo user
    return raw === 'null' ? null : (JSON.parse(raw) as Session)
  } catch {
    return null
  }
}

let session: Session | null = read()
const tokens = new Map<string, { user_id: string; exp: number }>()

function write(next: Session | null) {
  session = next
  try {
    store()?.setItem(KEY, JSON.stringify(next))
  } catch {
    // sessionStorage blocked: the session lives for this page only
  }
}

export const currentSession = () => session

/** POST /auth/refresh: a new access token while the (simulated) refresh cookie is valid. */
export function issueToken(): { access_token: string; expires_in: number } | null {
  if (!session) return null
  const access_token = `mock.${crypto.randomUUID()}`
  tokens.set(access_token, { user_id: session.user_id, exp: Date.now() + ACCESS_TTL_S * 1000 })
  return { access_token, expires_in: ACCESS_TTL_S }
}

export function userIdForToken(token: string | null | undefined): string | null {
  if (!token) return null
  const t = tokens.get(token)
  if (!t || t.exp < Date.now()) return null
  return t.user_id
}

export function signIn(userId: string) {
  write({ user_id: userId, signed_in_at: Date.now() })
}

export function signOut() {
  tokens.clear()
  write(null)
}

/** FR-SEC-008: was the last Google sign-in within 5 minutes? */
export const recentlySignedIn = () => session !== null && Date.now() - session.signed_in_at <= REAUTH_WINDOW_MS
