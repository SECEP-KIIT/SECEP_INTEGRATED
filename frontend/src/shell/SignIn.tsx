import { LogIn } from 'lucide-react'
import { useEffect, useState } from 'react'
import { startSignIn } from '../api/session'
import { lock } from '../boot/lock'

/**
 * The sign-in screen (NFR-SEC-003; F5): shown when there is no session, at boot or after Sign out, instead of a
 * shell full of failing columns. Only allow-listed accounts get in (FR-ADM-004); the server says so if not.
 */
export function SignIn() {
  const [busy, setBusy] = useState(false)
  // Signed out, the app's boot steps never run: finish them so the lock screen can open onto this page.
  useEffect(() => {
    for (const step of ['app', 'me', 'emails', 'layout', 'socket'] as const) lock.step(step)
  }, [])
  return (
    <main className="signin" aria-labelledby="signin-title">
      <div className="signin-card">
        <h1 id="signin-title" className="signin-title">
          SECEP
        </h1>
        <p className="signin-sub">Your email, sorted. Sign in with your work Google account to continue.</p>
        <button
          type="button"
          className="signin-button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void startSignIn().finally(() => setBusy(false))
          }}
        >
          <LogIn size={18} aria-hidden="true" />
          {busy ? 'Opening Google…' : 'Sign in with Google'}
        </button>
        <p className="signin-note">Only accounts your administrator has added can sign in.</p>
      </div>
    </main>
  )
}
