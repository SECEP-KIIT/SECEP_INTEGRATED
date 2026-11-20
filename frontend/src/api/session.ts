// Signed-in state as the app sees it (NFR-SEC-003, F5). The session itself is the httpOnly refresh cookie; this
// only tells the shell to swap to the sign-in screen when the cookie is gone or the user signs out.
import { useEffect, useState } from 'react'

const events = new EventTarget()
let signedOut = false

export function markSignedOut() {
  if (signedOut) return
  signedOut = true
  events.dispatchEvent(new Event('change'))
}

export const isSignedOut = () => signedOut

export function useSignedOut() {
  const [out, setOut] = useState(signedOut)
  useEffect(() => {
    const on = () => setOut(signedOut)
    events.addEventListener('change', on)
    return () => events.removeEventListener('change', on)
  }, [])
  return out
}

/**
 * Google sign-in (§6.5 GET /auth/google). The server sends the user to Google and back to `return`, with the
 * refresh cookie set. `reauth` asks Google for a fresh sign-in (FR-SEC-008) and returns to the same page.
 * Mock mode (dev only, removed from production builds): signs the demo user in on the spot.
 */
export async function startSignIn(reauth = false) {
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === '1') {
    const [{ signIn, currentSession }, { USERS }] = await Promise.all([import('../mocks/session'), import('../mocks/store/generate')])
    signIn(currentSession()?.user_id ?? USERS[0].id)
    if (!reauth) location.reload()
    return
  }
  const back = encodeURIComponent(location.pathname + location.search)
  location.assign(`/api/v1/auth/google?${reauth ? 'reauth=1&' : ''}return=${back}`)
}
