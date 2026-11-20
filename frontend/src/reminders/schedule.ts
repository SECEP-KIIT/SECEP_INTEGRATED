// Automatic reminders from due dates (FR-REM-001, decisions item 13): 21:00 the night before, 09:00 on the due day,
// 1 h before when a time is set, and 24 h before for Critical items. Reminders within 30 min of each other merge.
// Pure, used by the mock scheduler; M6 repeats the same rules server-side.

const at = (day: string, hh: number, mm: number, plusDays = 0) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d + plusDays, hh, mm, 0, 0)
}

export interface DueFacts {
  /** YYYY-MM-DD, local. */
  date: string
  /** HH:MM, local, or null for a date only. */
  time: string | null
  critical: boolean
}

/** When this item's reminders fire, oldest first, with close ones merged into the later one. */
export function reminderTimes({ date, time, critical }: DueFacts): Date[] {
  const [hh, mm] = time ? time.split(':').map(Number) : [9, 0]
  const due = at(date, hh, mm)
  const times = [at(date, 21, 0, -1), at(date, 9, 0)]
  if (time) times.push(new Date(due.getTime() - 3_600_000))
  if (critical) times.push(new Date(due.getTime() - 24 * 3_600_000))
  return mergeClose(times)
}

/** Sorted; any reminder within `minutes` of the next one folds into that later one. */
export function mergeClose(times: readonly Date[], minutes = 30): Date[] {
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime())
  const out: Date[] = []
  for (const t of sorted) {
    const last = out.at(-1)
    if (last && t.getTime() - last.getTime() <= minutes * 60_000) out[out.length - 1] = t
    else out.push(t)
  }
  return out
}
