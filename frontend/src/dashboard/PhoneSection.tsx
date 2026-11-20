import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowUp } from 'lucide-react'
import { useCallback, useId, useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { emailListOptions } from '../api/queries'
import type { Widget } from '../api/types'
import { addFilter, columnQuery, filterQuery, parseColumnQuery, sortKeyOf, type FilterPatch } from '../inbox/cardModel'
import { EmailCard } from '../inbox/EmailCard'
import { useNewPill } from '../inbox/useNewPill'
import { useFocused } from '../shell/focusMode'
import { useMinuteClock } from '../shell/useMinuteClock'
import { fullViewHref } from './layoutModel'

/** Cards a phone section shows; the rest are one tap away in the full column. */
export const SECTION_CARDS = 3

/**
 * A widget on the phone (FR-UI-009 as changed in proposals §16.4, option A): a section in the page's one vertical
 * scroll. Title and count, the top three cards, and "See all n →", which opens the full column (/inbox with the
 * widget's filter and sort). Nothing scrolls inside it. New mail shows as "↑ n new" (FR-UI-024), never inserted.
 */
export function PhoneSection({ widget, heading, tools }: { widget: Widget; heading: (titleId: string) => ReactNode; tools: ReactNode }) {
  const titleId = useId()
  const focused = useFocused()
  const now = useMinuteClock()
  const navigate = useNavigate()
  const { filters, sort } = useMemo(() => ({ filters: parseColumnQuery(widget.filter ?? '').filters, sort: sortKeyOf(widget.sort) }), [widget.filter, widget.sort])
  const query = columnQuery(filters, sort, focused)
  const list = useInfiniteQuery({ ...emailListOptions(query ?? ''), enabled: query !== null })
  const items = useMemo(() => (query === null ? [] : (list.data?.pages.flatMap((p) => p.items) ?? [])), [query, list.data])
  const count = `${items.length}${list.hasNextPage ? '+' : ''}`
  const { pending, fresh, showNew } = useNewPill(query, items, filters, focused)
  // A tag or type tapped on a card opens the full column with that filter added.
  const onFilter = useCallback(
    (patch: FilterPatch) => void navigate(fullViewHref({ filter: filterQuery(addFilter(filters, patch)), sort: widget.sort })),
    [navigate, filters, widget.sort],
  )
  const density = widget.density ?? 'comfortable'

  return (
    <section className="column phone-section" aria-labelledby={titleId} data-density={density}>
      <header className="col-head">
        <div className="col-title-row">
          {heading(titleId)}
          <span className="col-count">
            {count}
            <span className="sr-only"> emails</span>
          </span>
          {pending.length > 0 && (
            <button type="button" className="new-pill section-pill" onClick={showNew}>
              <ArrowUp size={14} aria-hidden="true" />
              {pending.length} new
            </button>
          )}
          {tools}
        </div>
      </header>
      <p className="sr-only" aria-live="polite">
        {pending.length > 0 ? `${pending.length} new ${pending.length === 1 ? 'email' : 'emails'}` : ''}
      </p>
      <div className="section-cards" role="list">
        {list.isPending && query !== null ? (
          Array.from({ length: SECTION_CARDS }, (_, i) => <div key={i} className="card card-skeleton" data-density={density} aria-hidden="true" />)
        ) : list.isError ? (
          <p className="col-state" role="alert">
            Couldn't load this section.{' '}
            <button type="button" className="text-button" onClick={() => void list.refetch()}>
              Try again
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="col-state section-empty">Nothing here right now.</p>
        ) : (
          items.slice(0, SECTION_CARDS).map((email) => (
            <div key={email.id} role="listitem">
              <EmailCard email={email} now={now} density={density} fresh={fresh.has(email.id)} onFilter={onFilter} />
            </div>
          ))
        )}
      </div>
      {items.length > 0 && (
        <Link className="section-all" to={fullViewHref(widget)}>
          See all {count} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      )}
    </section>
  )
}
