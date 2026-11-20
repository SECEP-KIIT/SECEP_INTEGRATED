import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { emailListOptions, listRequestedAt } from '../api/queries'
import { arrivals } from '../api/realtime'
import type { EmailListItem, Page } from '../api/types'
import { matchesColumn, type ColumnFilters } from './cardModel'

/** How long cards brought in by the pill keep their accent tint (item 9). */
const FRESH_MS = 2_000

/**
 * "↑ n new" for one list (FR-UI-024): arrivals after the list's first page was requested that match its filters and
 * aren't loaded. New mail is never inserted; `showNew` (the pill) reloads page 1 only, keeping the old cards on
 * screen until it arrives, and the arrivals keep an accent tint for a moment. Shared by the column widget and the
 * phone sections.
 */
export function useNewPill(query: string | null, items: EmailListItem[], filters: ColumnFilters, focused: boolean, onShow?: () => void, scope?: string) {
  const qc = useQueryClient()
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const arrived = useSyncExternalStore(arrivals.subscribe, arrivals.get)
  const pending = useMemo(() => {
    if (query === null) return []
    const since = listRequestedAt.get(query) ?? Infinity
    const loaded = new Set(items.map((e) => e.id))
    const projects = scope ? new URLSearchParams(scope).get('project')?.split(',') : undefined
    return arrived
      .filter((a) => a.at > since && !loaded.has(a.email.id) && matchesColumn(a.email, filters, focused))
      .filter((a) => !projects || a.email.projects.some((p) => projects.includes(p.id)))
      .map((a) => a.email.id)
  }, [arrived, items, query, filters, focused, scope])

  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const showNew = () => {
    if (query === null) return
    const ids = new Set(pending)
    onShow?.()
    const key = emailListOptions(query).queryKey
    qc.setQueryData<InfiniteData<Page<EmailListItem>, string | null>>(key, (d) => d && { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) })
    void qc.refetchQueries({ queryKey: key, exact: true })
    setFresh(ids)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFresh(new Set()), FRESH_MS)
  }
  return { pending, fresh, showNew }
}
