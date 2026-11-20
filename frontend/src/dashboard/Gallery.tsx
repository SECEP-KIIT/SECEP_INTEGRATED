import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { EmailListItem, Page } from '../api/types'
import { MaskedText } from '../components/MaskedText'
import { BOARD_PRESET, COLUMN_PRESETS, NOTES_PRESET, STATS_PRESET, type WidgetPreset } from './layoutModel'

/**
 * "+ Add widget" (FR-UI-008, item 2): the widget gallery, with a live preview of what each column would show (its
 * first three subjects, fetched only while the gallery is open). Lists only widget types that exist today: inbox
 * columns as saved filters; Board, Notes and Stats are built; the rest join later.
 */
export function Gallery({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (preset: WidgetPreset) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog ref={ref} className="gallery" aria-labelledby="gallery-title" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="gallery-head">
        <h2 id="gallery-title">Add a widget</h2>
        <button type="button" className="text-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="drawer-muted">Inbox columns are saved filters. More widgets join later.</p>
      <ul className="gallery-list">
        {open && (
          <li>
            <button type="button" className="gallery-item" onClick={() => onPick(BOARD_PRESET)}>
              <span className="gallery-item-head">
                <span aria-hidden="true">{BOARD_PRESET.icon}</span> {BOARD_PRESET.title}
              </span>
              <span className="gallery-preview drawer-muted">To do · In progress · Done. Drag cards between them.</span>
            </button>
          </li>
        )}
        {open && (
          <li>
            <button type="button" className="gallery-item" onClick={() => onPick(NOTES_PRESET)}>
              <span className="gallery-item-head">
                <span aria-hidden="true">{NOTES_PRESET.icon}</span> {NOTES_PRESET.title}
              </span>
              <span className="gallery-preview drawer-muted">Notes of your own, not tied to an email, card or project.</span>
            </button>
          </li>
        )}
        {open && (
          <li>
            <button type="button" className="gallery-item" onClick={() => onPick(STATS_PRESET)}>
              <span className="gallery-item-head">
                <span aria-hidden="true">{STATS_PRESET.icon}</span> {STATS_PRESET.title}
              </span>
              <span className="gallery-preview drawer-muted">Unread, Critical, due and overdue at a glance; for admins, how the classifier is doing.</span>
            </button>
          </li>
        )}
        {open &&
          COLUMN_PRESETS.map((p) => (
            <li key={p.key}>
              <button type="button" className="gallery-item" onClick={() => onPick(p)}>
                <span className="gallery-item-head">
                  <span aria-hidden="true">{p.icon}</span> {p.title}
                </span>
                <Preview preset={p} />
              </button>
            </li>
          ))}
      </ul>
    </dialog>
  )
}

function Preview({ preset }: { preset: WidgetPreset }) {
  const qs = [preset.filter, preset.sort && preset.sort !== 'newest' ? `sort=${preset.sort}` : '', 'limit=3'].filter(Boolean).join('&')
  const preview = useQuery({
    queryKey: ['emails', 'preview', qs],
    queryFn: ({ signal }) => api<Page<EmailListItem>>(`/emails?${qs}`, { signal }),
    staleTime: 30_000,
  })
  if (preview.isPending) return <span className="gallery-preview drawer-muted">Loading…</span>
  if (preview.isError) return <span className="gallery-preview drawer-muted">Preview unavailable</span>
  const items = preview.data.items
  return (
    <span className="gallery-preview">
      {items.length === 0 ? (
        <span className="drawer-muted">Nothing here right now</span>
      ) : (
        items.map((e) => (
          <span key={e.id} className="gallery-preview-line">
            {e.subject ? <MaskedText text={e.subject} /> : '(no subject)'}
          </span>
        ))
      )}
    </span>
  )
}
