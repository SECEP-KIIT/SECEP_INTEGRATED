// Mounted once in the shell. Offers the tour once (after the lock first opens) and runs it when started from the
// offer, Settings or search. The tour itself is a lazy chunk.
import { lazy, Suspense, useEffect, useState } from 'react'
import { useMe } from '../api/queries'
import { lock, LOCKING, UNLOCKED } from '../boot/lock'
import { onStartTour, saveOnboarding, useOnboarding } from './onboarding'
import './onboarding.css'

const Tour = lazy(() => import('./Tour'))

function useLockOpen() {
  const [open, setOpen] = useState(lock.isOpen)
  useEffect(() => {
    const on = () => setOpen(true)
    const off = () => setOpen(false)
    addEventListener(UNLOCKED, on)
    addEventListener(LOCKING, off)
    return () => {
      removeEventListener(UNLOCKED, on)
      removeEventListener(LOCKING, off)
    }
  }, [])
  return open
}

export function OnboardingHost() {
  const { data: me } = useMe()
  const o = useOnboarding()
  const open = useLockOpen()
  const [running, setRunning] = useState<number | null>(null)

  useEffect(() => {
    // The lock coming down ends the tour where it is (Settings offers Resume).
    const stop = () => setRunning(null)
    addEventListener(LOCKING, stop)
    const off = onStartTour(setRunning)
    return () => {
      off()
      removeEventListener(LOCKING, stop)
    }
  }, [])

  if (!me || !o || !open) return null
  if (running !== null)
    return (
      <Suspense fallback={null}>
        <Tour start={running} admin={me.is_admin} onClose={() => setRunning(null)} />
      </Suspense>
    )
  if (o.tour !== undefined) return null
  return (
    <div className="tour-offer" role="dialog" aria-labelledby="tour-offer-title">
      <h2 id="tour-offer-title">Welcome to SECEP</h2>
      <p>A one-minute tour shows where things are. You can also start it later from Settings, or by searching "tutorial".</p>
      <div className="tour-buttons">
        <button type="button" className="text-button" onClick={() => saveOnboarding({ tour: 'skipped' })}>
          Not now
        </button>
        <span className="tour-spacer" />
        <button type="button" className="primary-button" onClick={() => setRunning(0)}>
          Take the tour
        </button>
      </div>
    </div>
  )
}
