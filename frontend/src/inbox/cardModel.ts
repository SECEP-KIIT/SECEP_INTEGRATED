// Pure card and column logic (decisions items 3, 4, 6). No React here, so all of it is unit-tested.
// Everything is derived from §6.4.1 EmailListItem fields plus the PROPOSED due_date / handled / view (proposals §10).
// Parts of items 4 and 6 that still have no shape (projects, external sender, notes, custom tags, facets) are not
// built; see docs/proposals/srs-v1.3-frontend-shapes.md §9.
import type { DueBucket, EmailListItem, EmailType, EmailView, RoleCategory, SecurityFlag, SenderPerson, Sentiment, Urgency } from '../api/types'
import { DUE_BUCKETS, matchesDue } from '../lib/due'

export const TYPES: EmailType[] = ['Task', 'Info', 'Credentials', 'Meeting', 'Approval']
export const URGENCIES: Urgency[] = ['Critical', 'High', 'Medium', 'Low']
export const SENTIMENTS: Sentiment[] = ['Positive', 'Neutral', 'Negative', 'Frustrated']
/** `none` is the default for clean mail, so the Security group offers only the two flags. */
export const FLAGS: Exclude<SecurityFlag, 'none'>[] = ['suspicious', 'malicious']

// ── Sender ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The sender's role (FR-UI-011). PROPOSED wire field `from.role_category` (pending SRS v1.3, proposals §8.5), read
 * tolerantly: an API without it simply shows no role. Person itself is unchanged.
 */
export function senderRole(email: EmailListItem): RoleCategory | null {
  return (email.from as Partial<SenderPerson>).role_category ?? null
}

export const senderName = (email: EmailListItem) => email.from.name ?? email.from.address

// ── Time ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Today → 09:12, the last 6 days → Mon, older → 3 Nov (local time). */
export function cardTime(iso: string, now: Date, locale?: string): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days <= 0) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString(locale, { weekday: 'short' })
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

// ── Tags (item 4, FR-UI-013/014) ───────────────────────────────────────────────────────────────────────────────

export type TagKind = 'security' | 'due' | 'project' | 'action' | 'sentiment' | 'attachments' | 'notes' | 'replies' | 'duplicates' | 'masked'

export interface CardTag {
  kind: TagKind
  /** Short visible text next to the icon (may be empty: the icon alone, with `label` for tooltip and screen reader). */
  text: string
  /** Full description: tooltip, aria-label and the all-tags popover. */
  label: string
  tone: 'danger' | 'warn' | 'ok' | 'muted'
  /** Clicking the tag applies this filter to the column. Only tags with a §6.5 query parameter have one. */
  filter: FilterPatch | null
  /** project only: the projects' colours, primary first, for the split dot (FR-UI-017). */
  colours?: string[]
}

export type FilterPatch =
  | { group: 'view'; value: EmailView }
  | { group: 'type'; value: EmailType }
  | { group: 'urgency'; value: Urgency }
  | { group: 'sentiment'; value: Sentiment }
  | { group: 'flag'; value: SecurityFlag }
  | { group: 'due'; value: DueBucket }

export const MAX_VISIBLE_TAGS = 5

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * All tags in display priority: security → due → project → action status → the rest (item 4).
 * Sentiment shows only when Negative or Frustrated. Clean mail shows no shield.
 */
export function cardTags(email: EmailListItem, now: Date): CardTag[] {
  const tags: CardTag[] = []
  if (email.security_flag !== 'none') {
    const malicious = email.security_flag === 'malicious'
    tags.push({
      kind: 'security',
      text: malicious ? 'Malicious' : 'Suspicious',
      label: malicious ? 'Malicious links: blocked' : 'Suspicious links: check before opening',
      tone: 'danger',
      filter: { group: 'flag', value: email.security_flag },
    })
  }
  const due = dueTag(email.due_date, now)
  if (due) tags.push(due)
  const project = projectTag(email.projects)
  if (project) tags.push(project)
  if (email.jira_key) {
    tags.push({ kind: 'action', text: email.jira_key, label: `Jira issue ${email.jira_key}`, tone: 'ok', filter: null })
  } else if (email.proposed_action_count > 0) {
    const n = email.proposed_action_count
    tags.push({ kind: 'action', text: String(n), label: `${plural(n, 'proposed action')}`, tone: 'warn', filter: null })
  }
  const sentiment = email.triage?.sentiment.label
  if (sentiment === 'Negative' || sentiment === 'Frustrated') {
    tags.push({ kind: 'sentiment', text: '', label: `Sentiment: ${sentiment}`, tone: 'warn', filter: { group: 'sentiment', value: sentiment } })
  }
  if (email.attachment_count > 0) {
    tags.push({ kind: 'attachments', text: String(email.attachment_count), label: plural(email.attachment_count, 'attachment'), tone: 'muted', filter: null })
  }
  if (email.note_count > 0) {
    tags.push({ kind: 'notes', text: email.note_count > 1 ? String(email.note_count) : '', label: plural(email.note_count, 'note'), tone: 'muted', filter: null })
  }
  if (email.reply_count > 0) {
    tags.push({ kind: 'replies', text: String(email.reply_count), label: plural(email.reply_count, 'reply', 'replies'), tone: 'muted', filter: null })
  }
  if (email.duplicate_count > 0) {
    tags.push({ kind: 'duplicates', text: `×${email.duplicate_count}`, label: `${plural(email.duplicate_count, 'duplicate')} merged`, tone: 'muted', filter: null })
  }
  if (email.has_masked_secret) {
    tags.push({ kind: 'masked', text: '', label: 'Contains a masked secret', tone: 'muted', filter: null })
  }
  return tags
}

/**
 * Projects (FR-UI-017, item 5): one split dot (a slice per project, at most 4; 5 or more show a numbered ring) and
 * the chip "Name +n", named after the primary project. The label lists them all, so colour never carries it alone.
 */
export function projectTag(projects: EmailListItem['projects']): CardTag | null {
  if (!projects.length) return null
  const [first, ...rest] = projects
  const names = projects.map((p) => (p.is_primary && projects.length > 1 ? `${p.name} (primary)` : p.name))
  return {
    kind: 'project',
    text: rest.length ? `${first.name} +${rest.length}` : first.name,
    label: `${projects.length === 1 ? 'Project' : 'Projects'}: ${names.join(', ')}`,
    tone: 'muted',
    filter: null,
    colours: projects.map((p) => p.colour),
  }
}

/** The split dot's background: equal conic slices, primary first (left), at most 4. */
export function splitDot(colours: readonly string[]): string {
  if (colours.length <= 1) return colours[0] ?? 'transparent'
  const slices = colours.slice(0, 4)
  const step = 100 / slices.length
  return `conic-gradient(${slices.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`
}

// ── Due dates (FR-UI-013; PROPOSED due_date, proposals §10.2) ──────────────────────────────────────────────

/** Local YYYY-MM-DD for a Date. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Whole days from today to a YYYY-MM-DD date (negative = past), in local time. */
export function daysUntil(date: string, now: Date): number {
  const [y, m, d] = date.split('-').map(Number)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((new Date(y, m - 1, d).getTime() - today) / 86_400_000)
}

/**
 * One word of context, no icon (item 4): "Overdue", "Due today", "Due tomorrow", "Due Fri", "Due 12 Nov". Coloured by
 * proximity, and the word always says it too: red under 24 h (overdue or today), orange within 3 days, grey later.
 * Overdue and today are clickable: they apply the matching quick view.
 */
export function dueTag(dueDate: string | null, now: Date, locale?: string): CardTag | null {
  if (!dueDate) return null
  const days = daysUntil(dueDate, now)
  const [y, m, d] = dueDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const long = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  if (days < 0) return { kind: 'due', text: 'Overdue', label: `Overdue: was due ${long}`, tone: 'danger', filter: { group: 'view', value: 'overdue' } }
  if (days === 0) return { kind: 'due', text: 'Due today', label: 'Due today', tone: 'danger', filter: { group: 'view', value: 'due_today' } }
  const text =
    days === 1 ? 'Due tomorrow' : days < 7 ? `Due ${date.toLocaleDateString(locale, { weekday: 'short' })}` : `Due ${date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`
  return { kind: 'due', text, label: `Due ${long}`, tone: days <= 3 ? 'warn' : 'muted', filter: null }
}

/** The first five tags, then a `+N` for the rest (which the popover lists). */
export function visibleTags(tags: CardTag[]): { shown: CardTag[]; hidden: number } {
  if (tags.length <= MAX_VISIBLE_TAGS) return { shown: tags, hidden: 0 }
  // Keep the strip at five items in total: four tags plus the +N.
  return { shown: tags.slice(0, MAX_VISIBLE_TAGS - 1), hidden: tags.length - (MAX_VISIBLE_TAGS - 1) }
}

// ── Column filters and sort (item 6, FR-UI-021/023) ────────────────────────────────────────────────────────────

/** Only groups with a §6.4.1 GET /emails query parameter. */
export interface ColumnFilters {
  /** Quick chips (FR-UI-021; PROPOSED `view`, proposals §10.1), AND-combined. */
  view: EmailView[]
  type: EmailType[]
  urgency: Urgency[]
  sentiment: Sentiment[]
  flag: SecurityFlag[]
  /** Due buckets (PROPOSED `due`, proposals §15.1), OR within the group. */
  due: DueBucket[]
  /** Only emails the classifier flagged for review (PROPOSED `needs_review=true`, proposals §15.2). */
  needs_review: boolean
  /** Address or domain. */
  sender: string | null
  received_after: string | null
  received_before: string | null
}

export const NO_FILTERS: ColumnFilters = {
  view: [], type: [], urgency: [], sentiment: [], flag: [], due: [], needs_review: false, sender: null, received_after: null, received_before: null,
}

/** What a column remembers: a saved filter, sort and density (FR-UI-006). A dashboard widget stores it. */
export interface ColumnState {
  filters: ColumnFilters
  sort: SortKey
  density: Density
}
export const DEFAULT_COLUMN_STATE: ColumnState = { filters: NO_FILTERS, sort: 'newest', density: 'comfortable' }

/** `smart` and `due` are not offered yet (proposals §9). */
export type SortKey = 'newest' | 'oldest' | 'urgency' | 'sender' | 'confidence'
export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'urgency', label: 'Urgency' },
  { key: 'sender', label: 'Sender' },
  { key: 'confidence', label: 'Least confident first' },
]

export const FOCUS_URGENCIES: Urgency[] = ['Critical', 'High']

/** The urgency set actually requested: in Focus mode, only Critical and High (FR-UI-004). Empty = none can match. */
export function effectiveUrgency(filters: ColumnFilters, focused: boolean): Urgency[] | null {
  if (!focused) return filters.urgency.length ? filters.urgency : null
  return filters.urgency.length ? filters.urgency.filter((u) => FOCUS_URGENCIES.includes(u)) : FOCUS_URGENCIES
}

/**
 * GET /emails query string (§6.4.1): comma-separated values, OR within a parameter, AND across. Keys in a fixed
 * order so the same column always maps to the same cache key. null = the column can't match anything (Focus mode
 * with only Medium/Low selected): don't fetch.
 */
export function columnQuery(filters: ColumnFilters, sort: SortKey, focused: boolean): string | null {
  const urgency = effectiveUrgency(filters, focused)
  if (urgency && urgency.length === 0) return null
  const q = new URLSearchParams()
  if (filters.view.length) q.set('view', filters.view.join(','))
  if (filters.type.length) q.set('type', filters.type.join(','))
  if (urgency) q.set('urgency', urgency.join(','))
  if (filters.sentiment.length) q.set('sentiment', filters.sentiment.join(','))
  if (filters.flag.length) q.set('flag', filters.flag.join(','))
  if (filters.due.length) q.set('due', filters.due.join(','))
  if (filters.needs_review) q.set('needs_review', 'true')
  if (filters.sender?.trim()) q.set('sender', filters.sender.trim())
  if (filters.received_after) q.set('received_after', filters.received_after)
  if (filters.received_before) q.set('received_before', filters.received_before)
  if (sort !== 'newest') q.set('sort', sort)
  return q.toString()
}

/**
 * A column's saved filter (proposals §13): the GET /emails filter parameters as a query string, no sort. The SAME
 * vocabulary as columnQuery, written with plain commas so stored layouts stay readable (e.g. "urgency=Critical,High").
 */
export function filterQuery(filters: ColumnFilters): string {
  const parts: string[] = []
  const add = (k: string, values: readonly string[]) => values.length && parts.push(`${k}=${values.map(encodeURIComponent).join(',')}`)
  add('view', filters.view)
  add('type', filters.type)
  add('urgency', filters.urgency)
  add('sentiment', filters.sentiment)
  add('flag', filters.flag)
  add('due', filters.due)
  if (filters.needs_review) add('needs_review', ['true'])
  if (filters.sender?.trim()) add('sender', [filters.sender.trim()])
  if (filters.received_after) add('received_after', [filters.received_after])
  if (filters.received_before) add('received_before', [filters.received_before])
  return parts.join('&')
}

const SORT_KEYS = new Set<string>(['newest', 'oldest', 'urgency', 'sender', 'confidence'])
/** A stored or linked sort the UI offers, else newest (smart and due aren't offered yet). */
export const sortKeyOf = (sort: string | null | undefined): SortKey => (sort && SORT_KEYS.has(sort) ? (sort as SortKey) : 'newest')

/**
 * Reads GET /emails parameters back into column filters: a widget's saved filter, or an /inbox?… link (⤢ full view).
 * Values outside the known sets are dropped, so a bad link can't break the column.
 */
export function parseColumnQuery(query: string): { filters: ColumnFilters; sort: SortKey } {
  const p = new URLSearchParams(query)
  const list = <T extends string>(k: string, allowed: readonly T[]) =>
    (p.get(k) ?? '').split(',').map((v) => v.trim()).filter((v): v is T => (allowed as readonly string[]).includes(v))
  const text = (k: string) => p.get(k)?.trim() || null
  return {
    filters: {
      view: list('view', QUICK_VIEWS.map((v) => v.key)),
      type: list('type', TYPES),
      urgency: list('urgency', URGENCIES),
      sentiment: list('sentiment', SENTIMENTS),
      flag: list('flag', ['none', ...FLAGS] as SecurityFlag[]),
      due: list('due', DUE_BUCKETS.map((b) => b.key)),
      needs_review: p.get('needs_review') === 'true',
      sender: text('sender'),
      received_after: text('received_after'),
      received_before: text('received_before'),
    },
    sort: sortKeyOf(p.get('sort')),
  }
}

/**
 * Client-side mirror of the server's filter semantics, used ONLY to decide whether an arrival counts towards this
 * column's "↑ n new" pill. The list itself always comes from the server. Received dates compare in UTC, as the API's
 * `received_after` / `received_before` do.
 */
export function matchesColumn(e: EmailListItem, filters: ColumnFilters, focused: boolean, now = new Date()): boolean {
  const urgency = effectiveUrgency(filters, focused)
  if (e.handled !== filters.view.includes('handled')) return false
  const today = isoDay(now)
  for (const v of filters.view) {
    // An arrival is new: unread, and its thread's latest message is the inbound one, with nothing accepted yet. So
    // for needs_reply only the type part of the rule can fail.
    if (v === 'unread' && e.read) return false
    if (v === 'due_today' && e.due_date !== today) return false
    if (v === 'overdue' && !(e.due_date !== null && e.due_date < today)) return false
    if (v === 'needs_reply' && !(e.triage && ['Task', 'Approval', 'Meeting'].includes(e.triage.email_type.label))) return false
  }
  if (filters.type.length && !(e.triage && filters.type.includes(e.triage.email_type.label))) return false
  if (urgency && !(e.triage && urgency.includes(e.triage.urgency.label))) return false
  if (filters.sentiment.length && !(e.triage && filters.sentiment.includes(e.triage.sentiment.label))) return false
  if (filters.flag.length && !filters.flag.includes(e.security_flag)) return false
  if (!matchesDue(e.due_date, filters.due, today)) return false
  if (filters.needs_review && !e.triage?.needs_review) return false
  const sender = filters.sender?.trim().toLowerCase()
  if (sender) {
    const addr = e.from.address.toLowerCase()
    if (addr !== sender && !addr.endsWith(`@${sender.replace(/^@/, '')}`)) return false
  }
  const day = e.received_at.slice(0, 10)
  if (filters.received_after && day < filters.received_after) return false
  if (filters.received_before && day > filters.received_before) return false
  return true
}

export function toggleFilter(filters: ColumnFilters, patch: FilterPatch): ColumnFilters {
  const list = filters[patch.group] as string[]
  const next = list.includes(patch.value) ? list.filter((v) => v !== patch.value) : [...list, patch.value]
  return { ...filters, [patch.group]: next }
}

/** Adds (never removes) a filter: a click on a tag narrows the column to it. */
export function addFilter(filters: ColumnFilters, patch: FilterPatch): ColumnFilters {
  return (filters[patch.group] as string[]).includes(patch.value) ? filters : toggleFilter(filters, patch)
}

export interface FilterChip {
  key: string
  label: string
  remove: (f: ColumnFilters) => ColumnFilters
}

const GROUP_LABEL = { type: 'Type', urgency: 'Urgency', sentiment: 'Sentiment', flag: 'Security', due: 'Due' } as const
const DUE_LABEL = Object.fromEntries(DUE_BUCKETS.map((b) => [b.key, b.label])) as Record<DueBucket, string>
const FLAG_LABEL: Record<SecurityFlag, string> = { none: 'Clean', suspicious: 'Suspicious', malicious: 'Malicious' }

/** Quick chips (FR-UI-021) plus Handled (proposals §10.3), shown as toggles above the list. */
export const QUICK_VIEWS: { key: EmailView; label: string; title: string }[] = [
  { key: 'unread', label: 'Unread', title: 'Only emails you haven\'t read' },
  { key: 'due_today', label: 'Due today', title: 'Due date is today' },
  { key: 'needs_reply', label: 'Needs my reply', title: 'Latest message is to you, a Task, Approval or Meeting, nothing accepted yet (demo rule, pending team sign-off)' },
  { key: 'overdue', label: 'Overdue', title: 'Due date has passed and not handled' },
  { key: 'handled', label: 'Handled', title: 'Emails you marked as handled (hidden from the inbox otherwise)' },
]

/** One removable chip per active popover value (item 6). Quick views are toggles of their own, not chips. */
export function filterChips(filters: ColumnFilters): FilterChip[] {
  const chips: FilterChip[] = []
  for (const group of ['type', 'urgency', 'due', 'sentiment', 'flag'] as const) {
    for (const value of filters[group] as string[]) {
      const shown = group === 'flag' ? FLAG_LABEL[value as SecurityFlag] : group === 'due' ? DUE_LABEL[value as DueBucket] : value
      chips.push({
        key: `${group}:${value}`,
        label: `${GROUP_LABEL[group]}: ${shown}`,
        remove: (f) => ({ ...f, [group]: (f[group] as string[]).filter((v) => v !== value) }),
      })
    }
  }
  if (filters.needs_review) chips.push({ key: 'needs_review', label: 'Needs review', remove: (f) => ({ ...f, needs_review: false }) })
  if (filters.sender?.trim()) chips.push({ key: 'sender', label: `From: ${filters.sender.trim()}`, remove: (f) => ({ ...f, sender: null }) })
  if (filters.received_after) chips.push({ key: 'after', label: `After ${filters.received_after}`, remove: (f) => ({ ...f, received_after: null }) })
  if (filters.received_before) chips.push({ key: 'before', label: `Before ${filters.received_before}`, remove: (f) => ({ ...f, received_before: null }) })
  return chips
}

export const activeFilterCount = (filters: ColumnFilters) => filterChips(filters).length

/**
 * Everything a saved filter selects, quick views included, in words: a tile's filter badge counts these and shows
 * them in its tooltip (QA pass 3), since a tile has no chip rows.
 */
export const filterSummary = (filters: ColumnFilters): string[] => [
  ...QUICK_VIEWS.filter((v) => filters.view.includes(v.key)).map((v) => v.label),
  ...filterChips(filters).map((c) => c.label),
]

/** Any filter or quick view at all: decides between the "All clear" and "Nothing matches" empty states. */
export const isFiltered = (filters: ColumnFilters) => filters.view.length > 0 || activeFilterCount(filters) > 0

// ── Header urgency bar (item 3 "smart widget headers") ─────────────────────────────────────────────────────────

/** Urgency split of the LOADED cards (the list API has no totals; proposals §9). Untriaged cards are not counted. */
export function urgencySplit(items: EmailListItem[]): { urgency: Urgency; count: number }[] {
  return URGENCIES.map((urgency) => ({ urgency, count: items.filter((e) => e.triage?.urgency.label === urgency).length })).filter((s) => s.count > 0)
}

// ── Density (FR-UI-015) ─────────────────────────────────────────────────────────────────────────────────────────

export type Density = 'compact' | 'comfortable' | 'spacious'
export const DENSITIES: { key: Density; label: string }[] = [
  { key: 'compact', label: 'Compact' },
  { key: 'comfortable', label: 'Comfortable' },
  { key: 'spacious', label: 'Spacious' },
]

/**
 * Row pitch in px (card height + 8 px gap). Fixed per density, so a card never changes height on hover or on a live
 * update (NFR-PERF-011), and the virtual list knows every row's size up front. Must match inbox.css.
 */
export const ROW_PITCH: Record<Density, number> = { compact: 84, comfortable: 112, spacious: 132 }
