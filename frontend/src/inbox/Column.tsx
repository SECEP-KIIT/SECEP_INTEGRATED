import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownUp, ArrowUp, CircleHelp, Rows3, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { emailDetailOptions, emailListOptions } from '../api/queries'
import type { EmailListItem } from '../api/types'
import { useFocused } from '../shell/focusMode'
import { useMinuteClock } from '../shell/useMinuteClock'
import {
  addFilter,
  columnQuery,
  DENSITIES,
  filterChips,
  filterSummary,
  isFiltered,
  QUICK_VIEWS,
  toggleFilter,
  NO_FILTERS,
  ROW_PITCH,
  SORTS,
  urgencySplit,
  DEFAULT_COLUMN_STATE,
  type ColumnFilters,
  type ColumnState,
  type Density,
  type FilterPatch,
  type SortKey,
} from './cardModel'
import { EmailCard } from './EmailCard'
import { useMarquee } from './useMarquee'
import { useNewPill } from './useNewPill'
import { FilterPopover } from './FilterPopover'
import { useInbox } from './inboxContext'
import { SELECT_ALL, useSelection } from './selection'
import './inbox.css'

/** Start loading the next page this many rows before the end. */
const PREFETCH_ROWS = 8
const SKELETON_ROWS = 6


interface Props {
  title: string
  /** Controlled by a dashboard widget, which saves every change. Absent: the column keeps its own state. */
  state?: ColumnState
  onStateChange?: (state: ColumnState) => void
  /** Starting state when uncontrolled (the /inbox full view opened from a tile's ⤢). */
  initial?: ColumnState
  /**
   * Show this one email only (opened from search, 19 Nov 2026), from GET /emails/:id, which live events keep fresh.
   * The filter and sort controls are hidden; `badge` (the search pill) sits beside the title.
   */
  only?: string
  badge?: ReactNode
  /** Replaces the plain title (a widget's title bar: icon, rename). Gets the id the section is labelled by. */
  heading?: (titleId: string) => ReactNode
  /** Extra controls at the end of the title row (a widget's ⋯ menu, ⤢). */
  tools?: ReactNode
  /**
   * `tile`: a dashboard tile, a saved filter (QA pass 3). No quick chips or active-filter chips; the filter button is
   * a badge counting the whole filter, with it in words in the tooltip. The chip rows stay in the ⤢ full view.
   * (Phones show widgets as sections instead: dashboard/PhoneSection.)
   */
  variant?: 'full' | 'tile'
  /** Always added to the query: the column only ever shows these (a project's emails: `project=<id>`). */
  scope?: string
  /** Dashboard edit mode: the column is inert (no hover, clicks or keys) while tiles are rearranged. */
  locked?: boolean
}

/**
 * An inbox column widget (FR-UI-006 "a saved filter and sort"; item 6). Rendered here as the Inbox full view; the
 * tiling dashboard (task 8) places several side by side and persists their filters, sort and density.
 *
 * No layout shift (NFR-PERF-011): every row has the same fixed pitch for its density, rows are virtualised
 * (TanStack Virtual) and live updates patch cards in place. New mail is never inserted: it shows as "↑ n new"
 * (FR-UI-024), and only a click on the pill brings it in, at the top, after scrolling there.
 */
export function Column({ title, state, onStateChange, initial, heading, tools, variant = 'full', scope, locked, only, badge }: Props) {
  const focused = useFocused()
  const now = useMinuteClock()
  const { showLegend } = useInbox()
  const selection = useSelection()
  const titleId = useId()
  const [own, setOwn] = useState<ColumnState>(initial ?? DEFAULT_COLUMN_STATE)
  const current = state ?? own
  const { filters, sort } = current
  const tile = variant === 'tile'
  const density: Density = current.density
  // Setters read the latest state through a ref, so functional updates compose like useState's.
  const latest = useRef(current)
  latest.current = current
  const change = useCallback(
    (patch: Partial<ColumnState>) => {
      const next = { ...latest.current, ...patch }
      latest.current = next
      if (onStateChange) onStateChange(next)
      else setOwn(next)
    },
    [onStateChange],
  )
  const setFilters = useCallback(
    (f: ColumnFilters | ((f: ColumnFilters) => ColumnFilters)) => change({ filters: typeof f === 'function' ? f(latest.current.filters) : f }),
    [change],
  )
  const setSort = (s: SortKey) => change({ sort: s })
  const setDensity = (d: Density) => change({ density: d })
  const base = columnQuery(filters, sort, focused)
  const query = only ? null : base === null || !scope ? base : [scope, base].filter(Boolean).join('&')
  const list = useInfiniteQuery({ ...emailListOptions(query ?? ''), enabled: query !== null })
  const single = useQuery({ ...emailDetailOptions(only ?? ''), enabled: !!only })
  const singleItem: EmailListItem | undefined = single.data
  const loaded = useMemo(
    () => (only ? (singleItem ? [singleItem] : []) : query === null ? [] : (list.data?.pages.flatMap((p) => p.items) ?? [])),
    [only, singleItem, query, list.data],
  )
  const items = loaded
  const view = items
  const more = query !== null && list.hasNextPage

  // "↑ n new" (FR-UI-024): scroll to the top first, then reload page 1 only.
  const scrollRef = useRef<HTMLDivElement>(null)
  const { pending, fresh, showNew } = useNewPill(query, loaded, filters, focused, () => scrollRef.current?.scrollTo({ top: 0 }), scope)
  const pitch = ROW_PITCH[density]
  const showSkeleton = only ? single.isPending : query !== null && list.isPending
  const rowCount = showSkeleton ? SKELETON_ROWS : view.length + (more ? 1 : 0)
  // The virtualizer's functions are used only in this component's render, never passed to memoised children.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => pitch,
    overscan: 6,
  })
  // Every row's size changes together with the density; re-measure once rather than per row.
  useEffect(() => virtualizer.measure(), [virtualizer, pitch])
  // FR-UI-027: drag a box over empty space to select cards (not for a single search result or while tiles are edited).
  const marquee = useMarquee(view.map((e) => e.id), pitch, !showSkeleton && !locked && !only)

  const rows = virtualizer.getVirtualItems()
  const lastIndex = rows.at(-1)?.index ?? -1
  const { fetchNextPage, isFetchingNextPage } = list
  useEffect(() => {
    if (more && !isFetchingNextPage && lastIndex >= view.length - PREFETCH_ROWS) void fetchNextPage()
  }, [more, isFetchingNextPage, lastIndex, view.length, fetchNextPage])

  const onFilter = useCallback((patch: FilterPatch) => setFilters((f) => addFilter(f, patch)), [setFilters])

  // Ctrl/⌘+A (FR-UI-027): InboxHost picks the column (focus, else pointer) and asks it to select its loaded cards.
  const sectionRef = useRef<HTMLElement>(null)
  const selectAll = useRef(() => {})
  selectAll.current = () => items.length && selection.set(items.map((i) => i.id))
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const on = () => selectAll.current()
    el.addEventListener(SELECT_ALL, on)
    return () => el.removeEventListener(SELECT_ALL, on)
  }, [])
  // Edit mode (QA pass 5): while tiles are rearranged, nothing in the column reacts to the pointer or keyboard.
  const bodyRef = useRef<HTMLDivElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.inert = !!locked
    if (toolsRef.current) toolsRef.current.inert = !!locked
  }, [locked])

  const chips = filterChips(filters)
  const split = urgencySplit(items)
  const loadedCount = `${items.length}${more ? '+' : ''}`

  return (
    <section
      ref={sectionRef}
      className="column"
      aria-labelledby={titleId}
      data-density={density}
      data-variant={variant}
      data-selectable=""
    >
      <header className="col-head">
        <div className="col-title-row">
          {heading ? (
            heading(titleId)
          ) : (
            <h2 className="col-title" id={titleId} tabIndex={-1}>
              {title}
            </h2>
          )}
          <span className="col-count" title={more ? `${items.length} loaded, more below` : `${items.length} emails`}>
            {loadedCount}
            <span className="sr-only">{more ? ' emails loaded, more below' : ' emails'}</span>
          </span>
          {badge}
          {tools && <span className="col-title-end">{tools}</span>}
        </div>
        {/* F15: the filter, sort and density controls get their own line, so neither line is squeezed. */}
        <div className="col-tools" ref={toolsRef} hidden={!!only}>
          <FilterPopover filters={filters} onChange={setFilters} summary={tile ? filterSummary(filters) : undefined} />
          <label className="col-select" title="Sort" data-set={sort !== 'newest' || undefined}>
            <ArrowDownUp size={16} aria-hidden="true" />
            <span className="col-tool-dot" aria-hidden="true" />
            <span className="sr-only">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="col-select" title="Density" data-set={density !== 'comfortable' || undefined}>
            <Rows3 size={16} aria-hidden="true" />
            <span className="col-tool-dot" aria-hidden="true" />
            <span className="sr-only">Density</span>
            <select value={density} onChange={(e) => setDensity(e.target.value as Density)}>
              {DENSITIES.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="col-tool" onClick={showLegend} title="Card symbols (?)" aria-keyshortcuts="?">
            <CircleHelp size={16} aria-hidden="true" />
            <span className="sr-only">Card symbols</span>
          </button>
        </div>
        <UrgencyBar split={split} total={items.length} />
        {focused && <p className="col-note">Focus mode: Critical and High only</p>}
        {!tile && !only && (
        <div className="quick-chips" role="group" aria-label="Quick filters">
          {QUICK_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className="quick-chip"
              aria-pressed={filters.view.includes(v.key)}
              title={v.title}
              onClick={() => setFilters((f) => toggleFilter(f, { group: 'view', value: v.key }))}
            >
              {v.label}
            </button>
          ))}
        </div>
        )}
        {!tile && chips.length > 0 && (
          <ul className="chips" aria-label="Active filters">
            {chips.map((c) => (
              <li key={c.key}>
                <button type="button" className="chip" onClick={() => setFilters(c.remove)} aria-label={`Remove filter ${c.label}`}>
                  {c.label}
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="col-body" ref={bodyRef}>
        {pending.length > 0 && (
          <button type="button" className="new-pill" onClick={showNew}>
            <ArrowUp size={14} aria-hidden="true" />
            {pending.length} new
          </button>
        )}
        <p className="sr-only" aria-live="polite">
          {pending.length > 0 ? `${pending.length} new ${pending.length === 1 ? 'email' : 'emails'}` : ''}
        </p>

        <div className="col-scroll" ref={scrollRef} {...marquee.handlers}>
          {only && single.isError ? (
            <div className="col-state" role="alert">
              <p>Couldn't open this email. It may have been deleted.</p>
            </div>
          ) : list.isError && query !== null ? (
            <div className="col-state" role="alert">
              <p>Couldn't load this column.</p>
              <button type="button" className="text-button" onClick={() => void list.refetch()}>
                Try again
              </button>
            </div>
          ) : !showSkeleton && view.length === 0 ? (
            <EmptyState filtered={isFiltered(filters) || focused} onClear={() => setFilters(NO_FILTERS)} canClear={isFiltered(filters)} />
          ) : (
            <div
              className="col-rows"
              role={showSkeleton ? undefined : 'list'}
              aria-busy={showSkeleton || list.isFetching || undefined}
              style={{ height: virtualizer.getTotalSize() }}
            >
              {rows.map((row) => {
                const email = view[row.index] as EmailListItem | undefined
                return (
                  <div
                    key={showSkeleton ? `skel-${row.index}` : (email?.id ?? 'more')}
                    className="col-row"
                    role={showSkeleton ? undefined : 'listitem'}
                    aria-setsize={showSkeleton || !email ? undefined : more ? -1 : view.length}
                    aria-posinset={showSkeleton || !email ? undefined : row.index + 1}
                    data-email-id={showSkeleton ? undefined : email?.id}
                    data-pos={row.index}
                    style={{ transform: `translateY(${row.start}px)`, height: pitch }}
                  >
                    {email && !showSkeleton ? (
                      <EmailCard email={email} now={now} density={density} fresh={fresh.has(email.id)} onFilter={onFilter} />
                    ) : (
                      <SkeletonCard density={density} />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {marquee.overlay}
      </div>
    </section>
  )
}

/** Count plus a thin bar split by urgency (item 3). Covers the loaded cards; the list API has no totals. */
function UrgencyBar({ split, total }: { split: { urgency: string; count: number }[]; total: number }) {
  if (total === 0) return <div className="urgency-bar" aria-hidden="true" />
  const text = split.map((s) => `${s.count} ${s.urgency}`).join(', ')
  return (
    <div className="urgency-bar" role="img" aria-label={`Urgency of loaded emails: ${text}`} title={text}>
      {split.map((s) => (
        <span key={s.urgency} data-urgency={s.urgency} style={{ flexGrow: s.count }} />
      ))}
    </div>
  )
}

function SkeletonCard({ density }: { density: Density }) {
  return (
    <div className="card card-skeleton" data-density={density} aria-hidden="true">
      <div className="card-meta">
        <span className="skel skel-chip" />
        <span className="skel skel-word" />
      </div>
      <span className="skel skel-line skel-line-bold" />
      <span className="skel skel-line" />
    </div>
  )
}

/** Empty states with character (item 3). */
function EmptyState({ filtered, canClear, onClear }: { filtered: boolean; canClear: boolean; onClear: () => void }) {
  return (
    <div className="col-state">
      {filtered ? (
        <>
          <p className="col-state-title">Nothing matches</p>
          <p>No emails fit these filters right now.</p>
          {canClear && (
            <button type="button" className="text-button" onClick={onClear}>
              Clear filters
            </button>
          )}
        </>
      ) : (
        <>
          <p className="col-state-title">All clear</p>
          <p>Enjoy the view.</p>
        </>
      )}
    </div>
  )
}

