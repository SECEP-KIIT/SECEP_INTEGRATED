// Quick-add line parser (FR-CNT-001, decisions item 11): "Send deck to Priya fri 5pm #Atlas !high @priya".
// A small in-house parser: today, tomorrow, weekdays, "next week", "in 3 days", "21 Nov" / "Nov 21" / "21/11",
// times (5pm, 5:30 pm, 17:00, noon), #project, !urgency, @person. What it recognises is cut from the title and shown
// as chips; everything else stays the title.
import type { Urgency } from '../api/types'

export interface Chip {
  kind: 'date' | 'time' | 'project' | 'urgency' | 'person'
  text: string
}

export interface Parsed {
  title: string
  due_date: string | null
  due_time: string | null
  urgency: Urgency | null
  /** #tags as typed, without the #; matched to projects by the caller. */
  projects: string[]
  person: string | null
  chips: Chip[]
}

const URGENCY: Record<string, Urgency> = {
  critical: 'Critical', crit: 'Critical', c: 'Critical', urgent: 'Critical',
  high: 'High', h: 'High',
  medium: 'Medium', med: 'Medium', m: 'Medium',
  low: 'Low', l: 'Low',
}
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const dayIndex = (w: string) => DAYS.findIndex((d) => w.startsWith(d) && (w.length === 3 || `${d}day`.length >= 3))
const isDayWord = (w: string) => /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|sday|urday|rsday)?$/.test(w)
const monthIndex = (w: string) => (w.length >= 3 ? MONTHS.findIndex((m) => w.startsWith(m)) : -1)

/** A day and month, this year, or next year once it has passed. */
function dayMonth(day: number, month: number, now: Date): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  let d = new Date(now.getFullYear(), month, day)
  if (d.getMonth() !== month) return null
  if (d < addDays(now, 0)) d = new Date(now.getFullYear() + 1, month, day)
  return d
}

/** "5pm", "5:30pm", "17:00", "noon"; returns HH:MM or null. */
function parseTime(w: string, next?: string): { time: string; used: number } | null {
  if (w === 'noon') return { time: '12:00', used: 1 }
  if (w === 'midnight') return { time: '00:00', used: 1 }
  let m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(w)
  let used = 1
  if (!m && next && /^(am|pm)$/.test(next)) {
    m = /^(\d{1,2})(?::(\d{2}))?()$/.exec(w)
    if (m) {
      m[3] = next
      used = 2
    }
  }
  if (m) {
    let h = Number(m[1])
    const min = Number(m[2] ?? 0)
    if (h < 1 || h > 12 || min > 59) return null
    if (m[3] === 'pm' && h !== 12) h += 12
    if (m[3] === 'am' && h === 12) h = 0
    return { time: `${pad(h)}:${pad(min)}`, used }
  }
  const h24 = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(w)
  return h24 ? { time: `${pad(Number(h24[1]))}:${h24[2]}`, used: 1 } : null
}

export function parseQuickAdd(line: string, now: Date = new Date()): Parsed {
  const out: Parsed = { title: '', due_date: null, due_time: null, urgency: null, projects: [], person: null, chips: [] }
  const words = line.split(/\s+/).filter(Boolean)
  const keep: string[] = []
  const today = addDays(now, 0)
  const setDate = (d: Date, text: string) => {
    out.due_date = ymd(d)
    out.chips.push({ kind: 'date', text })
  }

  for (let i = 0; i < words.length; i++) {
    const raw = words[i]
    const w = raw.toLowerCase().replace(/[.,;]$/, '')
    const next = words[i + 1]?.toLowerCase().replace(/[.,;]$/, '')
    const after = words[i + 2]?.toLowerCase().replace(/[.,;]$/, '')

    if (/^#[\p{L}\p{N}_-]+$/u.test(raw)) {
      out.projects.push(raw.slice(1))
      out.chips.push({ kind: 'project', text: raw })
      continue
    }
    if (/^![a-z]+$/i.test(raw) && URGENCY[w.slice(1)] && !out.urgency) {
      out.urgency = URGENCY[w.slice(1)]
      out.chips.push({ kind: 'urgency', text: out.urgency })
      continue
    }
    if (/^@[\p{L}\p{N}._-]+$/u.test(raw) && !out.person) {
      out.person = raw.slice(1)
      out.chips.push({ kind: 'person', text: raw })
      continue
    }
    if (!out.due_date) {
      if (w === 'today' || w === 'tod') {
        setDate(today, 'Today')
        continue
      }
      if (w === 'tomorrow' || w === 'tmr' || w === 'tmrw') {
        setDate(addDays(today, 1), 'Tomorrow')
        continue
      }
      if (w === 'next' && next === 'week') {
        setDate(addDays(today, ((8 - today.getDay()) % 7) || 7), 'Next week')
        i++
        continue
      }
      if (w === 'in' && next && /^\d{1,3}$/.test(next) && after && /^(day|days|week|weeks)$/.test(after)) {
        const n = Number(next) * (after.startsWith('week') ? 7 : 1)
        setDate(addDays(today, n), `In ${next} ${after}`)
        i += 2
        continue
      }
      if (isDayWord(w) && dayIndex(w) >= 0) {
        const target = dayIndex(w)
        // The next one, today included ("fri" on a Friday is today).
        const d = addDays(today, (target - today.getDay() + 7) % 7)
        setDate(d, new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(d))
        continue
      }
      const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(w)
      if (slash) {
        const d = dayMonth(Number(slash[1]), Number(slash[2]) - 1, today)
        if (d) {
          setDate(d, raw)
          continue
        }
      }
      if (/^\d{1,2}(st|nd|rd|th)?$/.test(w) && next && monthIndex(next) >= 0) {
        const d = dayMonth(parseInt(w, 10), monthIndex(next), today)
        if (d) {
          setDate(d, `${raw} ${words[i + 1]}`)
          i++
          continue
        }
      }
      if (monthIndex(w) >= 0 && next && /^\d{1,2}(st|nd|rd|th)?$/.test(next) && !/^\d{1,2}(am|pm)$/.test(next)) {
        const d = dayMonth(parseInt(next, 10), monthIndex(w), today)
        if (d) {
          setDate(d, `${raw} ${words[i + 1]}`)
          i++
          continue
        }
      }
    }
    if (!out.due_time) {
      const at = w === 'at' && next ? parseTime(next, after) : null
      const t = at ?? parseTime(w, next)
      if (t) {
        out.due_time = t.time
        out.chips.push({ kind: 'time', text: t.time })
        i += t.used - 1 + (at ? 1 : 0)
        continue
      }
    }
    keep.push(raw)
  }

  // A time with no date: today, or tomorrow once it has passed.
  if (out.due_time && !out.due_date) {
    const [h, m] = out.due_time.split(':').map(Number)
    const passed = now.getHours() * 60 + now.getMinutes() >= h * 60 + m
    out.due_date = ymd(passed ? addDays(today, 1) : today)
  }
  out.title = keep.join(' ').replace(/\s+(by|on|at|due)$/i, '').trim()
  return out
}

/** Matches a #tag to a project: same name ignoring case, spaces and punctuation, or the start of one. */
export function matchProject<P extends { name: string; archived_at: string | null }>(tag: string, projects: readonly P[]): P | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const t = norm(tag)
  if (!t) return null
  const live = projects.filter((p) => !p.archived_at)
  return live.find((p) => norm(p.name) === t) ?? live.find((p) => norm(p.name).startsWith(t)) ?? null
}
