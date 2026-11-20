import { markDone, startTour } from '../onboarding/onboarding'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Archive, FolderOpen, Mail, Search, SlidersHorizontal, GraduationCap, Keyboard } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { useProjects } from '../api/queries'
import type { EmailListItem, Page, Project } from '../api/types'
import { goTo } from '../lib/navigate'
import { showSearchResult } from './searchBus'
import { filterCount, highlight, NO_FILTERS, searchPath, TYPES, URGENCIES, VIEWS, type Filters } from './searchQuery'
import './search.css'

const DEBOUNCE_MS = 150

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

type Row = { kind: 'help'; what: 'tour' | 'keys' } | { kind: 'project'; project: Project } | { kind: 'email'; email: EmailListItem } | { kind: 'deeper' }

/**
 * Search (FR-UI-025, lean, 19 Nov 2026): one box for emails and projects. Typing searches email subjects (handled
 * mail included) and project names; when no subject matches, "Go deeper" searches the email text. Filters (type,
 * urgency, unread, due today, overdue) narrow the emails. ↑↓ moves, Enter opens, Esc closes. Ctrl/⌘+K or / opens it.
 */
export function SearchPalette({ initialQuery = '', onClose }: { initialQuery?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [q, setQ] = useState(initialQuery)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [deepFor, setDeepFor] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const query = useDebounced(q.trim(), DEBOUNCE_MS)
  const deep = deepFor !== null && deepFor === query
  const searching = query.length > 0 || filterCount(filters) > 0

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    markDone('search')
  }, [])

  // One list, paged; stale requests are cancelled by TanStack Query's signal when the key changes.
  const emails = useInfiniteQuery({
    queryKey: ['search', query, filters, deep],
    enabled: searching,
    staleTime: 30_000,
    initialPageParam: null as string | null,
    getNextPageParam: (last: Page<EmailListItem>) => last.next_cursor,
    queryFn: ({ signal, pageParam }) => api<Page<EmailListItem>>(searchPath(query, filters, deep, pageParam), { signal }),
  })
  const more = () => {
    if (emails.hasNextPage && !emails.isFetchingNextPage) void emails.fetchNextPage()
  }
  const { data: projectPage } = useProjects()
  const projects = useMemo(() => {
    const t = query.toLowerCase()
    if (!t) return []
    return (projectPage?.items ?? []).filter((p) => p.name.toLowerCase().includes(t))
  }, [projectPage, query])

  const found = useMemo(() => emails.data?.pages.flatMap((p) => p.items) ?? [], [emails.data])
  const canGoDeeper = query.length > 0 && !deep && emails.isSuccess && found.length === 0
  // Help results (proposals §29.4): "tutorial", "tour", "help"… start the tour; "shortcuts", "keys"… open the key binds.
  const help = useMemo(() => {
    const out: Row[] = []
    if (/^(tut|tour|help|guid|onboard|getting|walk)/i.test(query)) out.push({ kind: 'help', what: 'tour' })
    if (/^(short|key|hotkey|keyboard)/i.test(query)) out.push({ kind: 'help', what: 'keys' })
    return out
  }, [query])
  const rows: Row[] = [
    ...help,
    ...projects.map((project) => ({ kind: 'project' as const, project })),
    ...found.map((email) => ({ kind: 'email' as const, email })),
    ...(canGoDeeper ? [{ kind: 'deeper' as const }] : []),
  ]
  const current = Math.min(active, Math.max(0, rows.length - 1))

  const close = () => {
    ref.current?.close()
    onClose()
  }
  const choose = (row: Row) => {
    if (row.kind === 'deeper') {
      setDeepFor(query)
      setActive(0)
      return
    }
    close()
    if (row.kind === 'help') {
      if (row.what === 'tour') startTour()
      else goTo('/settings#keyboard')
    } else if (row.kind === 'project') goTo(`/projects/${row.project.id}`)
    else showSearchResult(row.email, query)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length) {
        const next = (current + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length
        setActive(next)
        if (next >= rows.length - 3) more()
      }
    } else if (e.key === 'Enter' && rows[current]) {
      e.preventDefault()
      choose(rows[current])
    }
  }
  const toggle = <K extends 'type' | 'urgency' | 'view'>(k: K, v: Filters[K][number]) => {
    setActive(0)
    setFilters((f) => {
      const list = f[k] as string[]
      return { ...f, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] }
    })
  }
  const n = filterCount(filters)
  const rowId = (i: number) => `${id}-row-${i}`
  let i = -1

  return (
    <dialog ref={ref} className="search-palette" aria-label="Search" onClose={onClose} onClick={(e) => e.target === ref.current && close()}>
      <div className="sp-box" onKeyDown={onKeyDown}>
        <div className="sp-input-row">
          <Search size={18} aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={rows.length ? rowId(current) : undefined}
            aria-autocomplete="list"
            placeholder="Search email subjects and projects"
            value={q}
            maxLength={200}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
          />
          <button type="button" className="sp-filter-toggle" aria-pressed={showFilters} aria-controls={`${id}-filters`} onClick={() => setShowFilters((s) => !s)}>
            <SlidersHorizontal size={15} aria-hidden="true" /> Filters{n > 0 && <span className="sp-count">{n}</span>}
          </button>
        </div>

        {showFilters && (
          <div id={`${id}-filters`} className="sp-filters">
            <ChipGroup label="Type">
              {TYPES.map((t) => (
                <Chip key={t} on={filters.type.includes(t)} onClick={() => toggle('type', t)}>
                  {t}
                </Chip>
              ))}
            </ChipGroup>
            <ChipGroup label="Urgency">
              {URGENCIES.map((u) => (
                <Chip key={u} on={filters.urgency.includes(u)} onClick={() => toggle('urgency', u)}>
                  {u}
                </Chip>
              ))}
            </ChipGroup>
            <ChipGroup label="Status">
              {VIEWS.map((v) => (
                <Chip key={v.key} on={filters.view.includes(v.key)} onClick={() => toggle('view', v.key)}>
                  {v.label}
                </Chip>
              ))}
              <Chip on={filters.includeHandled} onClick={() => setFilters((f) => ({ ...f, includeHandled: !f.includeHandled }))}>
                Include handled
              </Chip>
            </ChipGroup>
            {n > 0 && (
              <button type="button" className="text-button sp-clear" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </button>
            )}
          </div>
        )}

        <div
          className="sp-results"
          id={`${id}-list`}
          role="listbox"
          aria-label="Results"
          aria-busy={emails.isFetchingNextPage || undefined}
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) more()
          }}
        >
          {!searching && <p className="sp-hint">Type to search email subjects and project names. Enter opens, Esc closes.</p>}
          {help.length > 0 && <p className="sp-group">Help</p>}
          {help.map((h) => {
            const at = ++i
            return (
              <Option key={h.kind === 'help' ? h.what : at} id={rowId(at)} active={at === current} onPick={() => choose(h)} onHover={() => setActive(at)}>
                <span className="sp-icon" aria-hidden="true">
                  {h.kind === 'help' && h.what === 'tour' ? <GraduationCap size={15} /> : <Keyboard size={15} />}
                </span>
                <span className="sp-main">{h.kind === 'help' && h.what === 'tour' ? 'Start the tutorial' : 'Keyboard shortcuts'}</span>
                <span className="sp-meta">{h.kind === 'help' && h.what === 'tour' ? 'A one-minute tour' : 'Settings'}</span>
              </Option>
            )
          })}
          {projects.length > 0 && <p className="sp-group">Projects</p>}
          {projects.map((p) => {
            const at = ++i
            return (
              <Option key={p.id} id={rowId(at)} active={at === current} onPick={() => choose({ kind: 'project', project: p })} onHover={() => setActive(at)}>
                <span className="sp-icon" aria-hidden="true">
                  {p.icon ?? <FolderOpen size={15} />}
                </span>
                <span className="sp-main">
                  <Marked text={p.name} q={query} />
                </span>
                <span className="sp-meta">{p.archived_at ? 'Archived project' : 'Open project'}</span>
              </Option>
            )
          })}
          {searching && found.length > 0 && <p className="sp-group">{deep ? 'Emails (subject or text)' : 'Emails'}</p>}
          {found.map((e) => {
            const at = ++i
            return (
              <Option key={e.id} id={rowId(at)} active={at === current} onPick={() => choose({ kind: 'email', email: e })} onHover={() => setActive(at)}>
                <span className="sp-icon" aria-hidden="true">
                  {e.handled ? <Archive size={15} /> : <Mail size={15} />}
                </span>
                <span className="sp-main">
                  <Marked text={e.subject ?? '(no subject)'} q={query} />
                  <span className="sp-sub">
                    {e.from.name ?? e.from.address}
                    {e.handled && ' · handled'}
                  </span>
                </span>
                <span className="sp-meta">
                  {e.triage && <span className="sp-tag">{e.triage.urgency.label}</span>}
                  {new Date(e.received_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </span>
              </Option>
            )
          })}
          {searching && emails.isFetching && found.length === 0 && <p className="sp-hint">Searching…</p>}
          {emails.isFetchingNextPage && <p className="sp-hint">Loading more…</p>}
          {emails.isError && <p className="sp-hint">Search failed. Check your connection and try again.</p>}
          {canGoDeeper &&
            (() => {
              const at = ++i
              return (
                <>
                  <p className="sp-hint">No email subjects match “{query}”.</p>
                  <Option id={rowId(at)} active={at === current} onPick={() => choose({ kind: 'deeper' })} onHover={() => setActive(at)}>
                    <span className="sp-icon" aria-hidden="true">
                      <Search size={15} />
                    </span>
                    <span className="sp-main">Go deeper: search the email text</span>
                  </Option>
                </>
              )
            })()}
          {deep && emails.isSuccess && found.length === 0 && projects.length === 0 && <p className="sp-hint">Nothing matches “{query}” in subjects or email text.</p>}
          {!query && searching && emails.isSuccess && found.length === 0 && <p className="sp-hint">No emails match these filters.</p>}
        </div>
      </div>
    </dialog>
  )
}

function Option({ id, active, onPick, onHover, children }: { id: string; active: boolean; onPick: () => void; onHover: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <div ref={ref} id={id} role="option" aria-selected={active} className="sp-option" data-active={active || undefined} onClick={onPick} onMouseMove={onHover}>
      {children}
    </div>
  )
}

function Marked({ text, q }: { text: string; q: string }) {
  return (
    <span className="sp-title">
      {highlight(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </span>
  )
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sp-chip-group" role="group" aria-label={label}>
      <span className="sp-chip-label">{label}</span>
      {children}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="sp-chip" aria-pressed={on} onClick={onClick}>
      {on && <span aria-hidden="true">✓ </span>}
      {children}
    </button>
  )
}
