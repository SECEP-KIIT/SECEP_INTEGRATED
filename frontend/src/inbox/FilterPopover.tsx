import * as Popover from '@radix-ui/react-popover'
import { ListFilter } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { SecurityFlag } from '../api/types'
import { DUE_BUCKETS } from '../lib/due'
import { activeFilterCount, FLAGS, NO_FILTERS, SENTIMENTS, TYPES, URGENCIES, toggleFilter, type ColumnFilters, type FilterPatch } from './cardModel'
import { TypeIcon, UrgencyMark } from './marks'

const FLAG_LABEL: Record<SecurityFlag, string> = { none: 'Clean', suspicious: 'Suspicious', malicious: 'Malicious' }

/**
 * Column filter popover (FR-UI-021, item 6): OR within a group, AND across groups, applied as you click. Only the
 * groups with a GET /emails query parameter are offered: Due and Needs review are PROPOSED (proposals §15.1, §15.2).
 * Project, Status and Has attachments/notes and the live counts (FR-UI-022) wait for their wire shapes (proposals §9).
 */
/**
 * `summary`: a dashboard tile's whole saved filter in words (quick views too). The trigger then becomes the tile's
 * filter badge: its count covers everything, and the tooltip lists it, since tiles show no chip rows (QA pass 3).
 */
export function FilterPopover({ filters, onChange, summary }: { filters: ColumnFilters; onChange: (f: ColumnFilters) => void; summary?: string[] }) {
  const count = activeFilterCount(filters)
  const badge = summary?.length ?? count
  const title = summary ? (summary.length ? `Filter: ${summary.join(', ')}` : 'Filter: none') : 'Filter'
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="col-tool" aria-label={summary?.length ? title : count ? `Filter, ${count} active` : 'Filter'} title={title}>
          <ListFilter size={16} aria-hidden="true" />
          {badge > 0 && (
            <span className="col-tool-count" aria-hidden="true">
              {badge}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu filter-popover" side="bottom" align="end" sideOffset={6} collisionPadding={12} aria-label="Filters">
          {/* F8: Clear all sits at the top, reachable without scrolling the popover. */}
          <div className="filter-head">
            {/* F16: on a tile, say whose filter this is (it's saved with the tile). */}
            <span className="filter-head-title">{(summary ? "This tile's filter" : 'Filters') + (count > 0 ? ` · ${count} active` : '')}</span>
            <button type="button" className="text-button" disabled={count === 0} onClick={() => onChange(NO_FILTERS)}>
              Clear all
            </button>
          </div>
          <Group title="Type">
            {TYPES.map((t) => (
              <Check key={t} filters={filters} onChange={onChange} patch={{ group: 'type', value: t }}>
                <TypeIcon type={t} size={14} /> {t}
              </Check>
            ))}
          </Group>
          <Group title="Urgency">
            {URGENCIES.map((u) => (
              <Check key={u} filters={filters} onChange={onChange} patch={{ group: 'urgency', value: u }}>
                <UrgencyMark urgency={u} /> {u}
              </Check>
            ))}
          </Group>
          {/* FR-UI-021 Due group (PROPOSED `due`, proposals §15.1): OR within the group. */}
          <Group title="Due">
            {DUE_BUCKETS.map((b) => (
              <Check key={b.key} filters={filters} onChange={onChange} patch={{ group: 'due', value: b.key }}>
                {b.label}
              </Check>
            ))}
          </Group>
          <Group title="Review">
            <label className="filter-option">
              <input type="checkbox" checked={filters.needs_review} onChange={() => onChange({ ...filters, needs_review: !filters.needs_review })} />
              Needs review
            </label>
          </Group>
          <Group title="Security">
            {FLAGS.map((f) => (
              <Check key={f} filters={filters} onChange={onChange} patch={{ group: 'flag', value: f }}>
                {FLAG_LABEL[f]}
              </Check>
            ))}
          </Group>
          <Group title="Sentiment">
            {SENTIMENTS.map((s) => (
              <Check key={s} filters={filters} onChange={onChange} patch={{ group: 'sentiment', value: s }}>
                {s}
              </Check>
            ))}
          </Group>
          <SenderField value={filters.sender} onChange={(sender) => onChange({ ...filters, sender })} />
          <fieldset className="filter-group filter-dates">
            <legend>Date received</legend>
            <label>
              From
              <input
                type="date"
                value={filters.received_after ?? ''}
                max={filters.received_before ?? undefined}
                onChange={(e) => onChange({ ...filters, received_after: e.target.value || null })}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={filters.received_before ?? ''}
                min={filters.received_after ?? undefined}
                onChange={(e) => onChange({ ...filters, received_before: e.target.value || null })}
              />
            </label>
          </fieldset>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="filter-group">
      <legend>{title}</legend>
      <div className="filter-options">{children}</div>
    </fieldset>
  )
}

function Check({ filters, onChange, patch, children }: { filters: ColumnFilters; onChange: (f: ColumnFilters) => void; patch: FilterPatch; children: ReactNode }) {
  const checked = (filters[patch.group] as string[]).includes(patch.value)
  return (
    <label className="filter-option">
      <input type="checkbox" checked={checked} onChange={() => onChange(toggleFilter(filters, patch))} />
      {children}
    </label>
  )
}

/** Address or domain (§6.4.1 `sender`). Applied 300 ms after typing stops, so each keystroke isn't a request. */
function SenderField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '')
  // Follow outside changes (a chip removed, Clear all) without fighting the user's typing.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value ?? '')
  }
  useEffect(() => {
    if ((draft.trim() || null) === (value?.trim() || null)) return
    const t = setTimeout(() => onChange(draft.trim() || null), 300)
    return () => clearTimeout(t)
  }, [draft, value, onChange])

  return (
    <fieldset className="filter-group">
      <legend>Sender</legend>
      <input
        type="text"
        className="filter-text"
        placeholder="name@company.com or company.com"
        aria-label="Sender address or domain"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </fieldset>
  )
}
