// "Remind me" choices (FR-REM-002, decisions item 13): Later today, Tomorrow 9 am, Next week, Pick a time.

export interface RemindChoice {
  id: 'later' | 'tomorrow' | 'week'
  label: string
  at: Date
}

const at = (base: Date, days: number, hour: number) => {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d
}

/**
 * The quick choices from `now`. "Later today" is 3 hours on, rounded to the half hour, and only offered while it is
 * still today. "Next week" is the coming Monday at 9 am.
 */
export function remindChoices(now: Date): RemindChoice[] {
  const out: RemindChoice[] = []
  const later = new Date(now.getTime() + 3 * 3_600_000)
  later.setMinutes(later.getMinutes() < 30 ? 30 : 60, 0, 0)
  if (later.toDateString() === now.toDateString()) out.push({ id: 'later', label: 'Later today', at: later })
  out.push({ id: 'tomorrow', label: 'Tomorrow 9 am', at: at(now, 1, 9) })
  const toMonday = ((8 - now.getDay()) % 7) || 7
  out.push({ id: 'week', label: 'Next week', at: at(now, toMonday, 9) })
  return out
}

export function whenText(when: Date, now: Date) {
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (when.toDateString() === now.toDateString()) return `today ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (when.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  return `${when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}
