import { Hint, Key } from '../onboarding/Hint'
import { Search, X } from 'lucide-react'
import { useMemo } from 'react'
import { useLocation } from 'react-router'
import { Column } from '../inbox/Column'
import { DEFAULT_COLUMN_STATE, parseColumnQuery } from '../inbox/cardModel'
import { InboxHost } from '../inbox/InboxHost'
import { goTo } from '../lib/navigate'
import { openSearch } from '../search/searchBus'

/**
 * The Inbox full view: one column widget (FR-UI-006). Independent of the dashboard at `/`. A tile's ⤢ opens it with
 * the tile's filter and sort as GET /emails parameters (/inbox?view=due_today&sort=urgency). An email picked in
 * search (/inbox?found=<id>&sq=<words>) is shown alone, with a "search: …" pill; ✕ goes back to the whole inbox.
 */
export function Component() {
  const { search } = useLocation()
  const params = useMemo(() => new URLSearchParams(search), [search])
  const found = params.get('found')
  const words = params.get('sq') ?? ''
  const initial = useMemo(() => ({ ...DEFAULT_COLUMN_STATE, ...parseColumnQuery(search) }), [search])
  return (
    <InboxHost>
      <div className="inbox-page">
        <Column
          key={search}
          title="Inbox"
          initial={initial}
          only={found ?? undefined}
          badge={found ? <SearchPill words={words} /> : undefined}
        />
      </div>
      <Hint id="card_keys" target=".column .card">
        Tip: <Key id="next" />/<Key id="prev" /> move between cards, <Key id="done" /> marks one handled, right-click shows everything else. Keys can be changed in Settings.
      </Hint>
    </InboxHost>
  )
}

function SearchPill({ words }: { words: string }) {
  return (
    <span className="search-badge">
      <button type="button" className="search-badge-text" title="Search again" onClick={() => openSearch(words)}>
        <Search size={13} aria-hidden="true" />
        <span>search: {words || 'filters'}</span>
      </button>
      <button type="button" className="search-badge-clear" title="Show the whole inbox" onClick={() => goTo('/inbox')}>
        <X size={13} aria-hidden="true" />
        <span className="sr-only">Clear search, show the whole inbox</span>
      </button>
    </span>
  )
}
