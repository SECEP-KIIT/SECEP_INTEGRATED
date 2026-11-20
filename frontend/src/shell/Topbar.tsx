import { useQueryClient, type QueryCache } from '@tanstack/react-query'
import { Lock, Plus, Search } from 'lucide-react'
import { lock } from '../boot/lock'
import { Bell } from './Bell'
import { lazy, Suspense, useEffect, useState } from 'react'
import { anyLayerOpen, isTypingTarget } from './focusKeys'
import { onOpenSearch } from '../search/searchBus'
import { useMatch, useMatches } from 'react-router'
import { openQuickAdd } from '../cards/cardBus'
import { useMinuteClock } from './useMinuteClock'
import { display, hasModifier, matches, useBindings, type KeyActionId } from '../lib/keybinds'

// Search loads on first use (NFR-PERF-010: the palette is not in the initial bundle).
const SearchPalette = lazy(() => import('../search/SearchPalette').then((m) => ({ default: m.SearchPalette })))

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

const latestUpdate = (cache: QueryCache) => Math.max(0, ...cache.getAll().map((q) => q.state.dataUpdatedAt))

/** Latest successful fetch across all queries. Task 5 switches this to socket events. */
function useLastSync() {
  const cache = useQueryClient().getQueryCache()
  const [last, setLast] = useState(() => latestUpdate(cache))
  // Deferred: the cache also reports queries added while another component renders (a new column or section), and
  // React forbids updating this component in the middle of that render.
  useEffect(() => cache.subscribe(() => queueMicrotask(() => setLast(latestUpdate(cache)))), [cache])
  return last
}

function syncedAgo(last: number, now: number) {
  const s = Math.max(0, Math.round((now - last) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return `at ${timeFmt.format(last)}`
}

/** "● synced 12 s ago", with a single pulse per sync and no loop (item 9). */
function SyncIndicator() {
  const last = useLastSync()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])
  if (!last) return null
  return (
    <span className="sync">
      {/* A new key remounts the dot, which replays its one-shot pulse. */}
      <span className="sync-dot" key={last} aria-hidden="true" />
      synced {syncedAgo(last, Math.max(now, last))}
    </span>
  )
}

// FR-UI-001 topbar: title + clock | search pill | sync, bell, quick-add. The weather chip comes with FR-WP-009
// (task 16). The pill and bell are laid out now so nothing shifts later; the bell arrives with task 13.
// Quick-add (task 12) opens the quick-add dialog, filed into the open project.
export function Topbar() {
  // null: closed; a string: open, starting with these words (the Inbox's search pill reopens it).
  const [search, setSearch] = useState<string | null>(null)
  useEffect(() => onOpenSearch((q) => setSearch(q)), [])
  // Keys from Settings (proposals §28.3); by default Alt+L locks, Ctrl/⌘+K and / open search. A key without Ctrl/⌘
  // or Alt never fires while typing or with a dialog open.
  useEffect(() => {
    const free = (e: KeyboardEvent, id: KeyActionId) => matches(e, id) && (hasModifier(id) || (!isTypingTarget(e.target) && !anyLayerOpen()))
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (free(e, 'lock')) {
        e.preventDefault()
        lock.now()
      } else if (!lock.isOpen()) {
        return
      } else if (free(e, 'search') || free(e, 'search_alt')) {
        e.preventDefault()
        setSearch('')
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  const now = useMinuteClock()
  const bindings = useBindings()
  const keys = { search: display(bindings.search), lock: display(bindings.lock), quick_add: display(bindings.quick_add) }
  const project = useMatch('/projects/:id')?.params.id
  const title = useMatches()
    .map((m) => (m.handle as { title?: string } | undefined)?.title)
    .findLast(Boolean)

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">{title}</h1>
        <time className="topbar-clock" dateTime={now.toISOString()}>
          {timeFmt.format(now)}
        </time>
      </div>
      <div className="topbar-centre">
        {/* Contextual mode (item 1): the inbox page renders its selection bar here, over the search pill. */}
        <div id="topbar-context" className="topbar-context" />
        <button type="button" className="search-pill" onClick={() => setSearch('')} aria-haspopup="dialog">
          <Search aria-hidden="true" size={16} />
          <span className="search-pill-label">Search</span>
          <kbd>{keys.search}</kbd>
        </button>
      </div>
      {search !== null && (
        <Suspense fallback={null}>
          <SearchPalette initialQuery={search} onClose={() => setSearch(null)} />
        </Suspense>
      )}
      <div className="topbar-right">
        <SyncIndicator />
        <Bell />
        {/* Lock now before stepping away, instead of waiting for the idle timer (desktop only; phones have no lock). */}
        <button type="button" className="icon-button lock-now" aria-label="Lock screen" title={`Lock screen (${keys.lock})`} onClick={() => lock.now()}>
          <Lock aria-hidden="true" size={17} />
        </button>
        <button type="button" className="icon-button" aria-label="Quick add a card" title={`Quick add (${keys.quick_add})`} onClick={() => openQuickAdd({ projectId: project })}>
          <Plus aria-hidden="true" size={18} />
        </button>
      </div>
    </header>
  )
}
