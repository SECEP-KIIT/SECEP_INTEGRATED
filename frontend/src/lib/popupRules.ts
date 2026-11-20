// Pop-up rules and quiet hours (FR-REM-007, proposals §28.1). Pure, so they're unit-tested and the mock reuses the
// validators. Which new emails interrupt the user with a top alert; the rest arrive silently (inbox, bell counts).
import type { Sentiment, Urgency } from '../api/types'

export type PopupLevel = 'all' | 'medium' | 'high' | 'critical' | 'none'
/** "Also pop up when the mood is…", whatever the urgency: off, Frustrated only, or Negative and Frustrated. */
export type PopupSentiment = 'off' | 'frustrated' | 'negative'
export interface PopupRule {
  urgency: PopupLevel
  sentiment: PopupSentiment
}
export type PopupMode = 'normal' | 'focus' | 'quiet'
export type PopupRules = Record<PopupMode, PopupRule>
/** Local wall-clock times, HH:MM. start > end wraps past midnight (the default 22:00–08:00 does). */
export interface QuietHours {
  start: string
  end: string
}

/** FR-REM-007 defaults: Normal = High+ and Frustrated, Focus = Critical only, Quiet = none. */
export const DEFAULT_POPUP_RULES: PopupRules = {
  normal: { urgency: 'high', sentiment: 'frustrated' },
  focus: { urgency: 'critical', sentiment: 'off' },
  quiet: { urgency: 'none', sentiment: 'off' },
}
export const DEFAULT_QUIET: QuietHours = { start: '22:00', end: '08:00' }

export const LEVELS: { key: PopupLevel; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'medium', label: 'Medium and above' },
  { key: 'high', label: 'High and above' },
  { key: 'critical', label: 'Critical only' },
  { key: 'none', label: 'None' },
]
export const SENTIMENTS: { key: PopupSentiment; label: string }[] = [
  { key: 'off', label: 'No' },
  { key: 'frustrated', label: 'Frustrated' },
  { key: 'negative', label: 'Negative or frustrated' },
]

const RANK: Record<Urgency, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 }
const MIN: Record<PopupLevel, number> = { all: 0, medium: 1, high: 2, critical: 3, none: 99 }

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Whether `now` (local time) falls in quiet hours. null = quiet hours off. start == end = never. */
export function inQuietHours(q: QuietHours | null, now: Date): boolean {
  if (!q) return false
  const t = now.getHours() * 60 + now.getMinutes()
  const s = minutes(q.start)
  const e = minutes(q.end)
  if (s === e) return false
  return s < e ? t >= s && t < e : t >= s || t < e
}

/** Quiet hours win over Focus mode: at night the stricter rule should hold even if Focus was left on. */
export const popupMode = (focused: boolean, quiet: QuietHours | null, now: Date): PopupMode =>
  inQuietHours(quiet, now) ? 'quiet' : focused ? 'focus' : 'normal'

export function shouldPopUp(t: { urgency: Urgency; sentiment: Sentiment }, rule: PopupRule): boolean {
  if (RANK[t.urgency] >= MIN[rule.urgency]) return true
  if (rule.sentiment === 'frustrated') return t.sentiment === 'Frustrated'
  if (rule.sentiment === 'negative') return t.sentiment === 'Frustrated' || t.sentiment === 'Negative'
  return false
}

// ── Validators (mock route and resolvePrefs) ───────────────────────────────────────────────────────────────────
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isRule = (v: unknown): v is PopupRule =>
  isObj(v) && LEVELS.some((l) => l.key === v.urgency) && SENTIMENTS.some((s) => s.key === v.sentiment) && Object.keys(v).length === 2

export const isPopupRules = (v: unknown): v is PopupRules =>
  isObj(v) && Object.keys(v).length === 3 && isRule(v.normal) && isRule(v.focus) && isRule(v.quiet)

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
export const isQuietHours = (v: unknown): v is QuietHours =>
  isObj(v) && Object.keys(v).length === 2 && typeof v.start === 'string' && typeof v.end === 'string' && HHMM.test(v.start) && HHMM.test(v.end)
