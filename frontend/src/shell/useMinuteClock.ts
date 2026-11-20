import { useEffect, useState } from 'react'

/** Re-renders once a minute, on the minute, rather than polling every second. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, 60_000 - (Date.now() % 60_000))
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  return now
}
