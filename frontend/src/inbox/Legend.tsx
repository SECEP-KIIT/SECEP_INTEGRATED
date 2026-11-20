import { useEffect, useRef } from 'react'
import type { CardTag } from './cardModel'
import { TYPES, URGENCIES } from './cardModel'
import { TagIcon, TypeIcon, UrgencyMark } from './marks'

const sample = (kind: CardTag['kind'], label: string, extra: Partial<CardTag> = {}): CardTag => ({ kind, label, text: '', tone: 'muted', filter: null, ...extra })

const TAGS: CardTag[] = [
  sample('security', 'Suspicious links', { tone: 'danger', filter: { group: 'flag', value: 'suspicious' } }),
  sample('security', 'Malicious links (blocked)', { tone: 'danger', filter: { group: 'flag', value: 'malicious' } }),
  sample('due', 'Overdue, or due within 24 h (red)', { tone: 'danger', text: 'Due today' }),
  sample('due', 'Due within 3 days (orange)', { tone: 'warn', text: 'Due Fri' }),
  sample('due', 'Due later (grey)', { tone: 'muted', text: 'Due 12 Nov' }),
  sample('action', 'Proposed actions waiting', { tone: 'warn' }),
  sample('action', 'Sent to Jira (issue key)', { tone: 'ok' }),
  sample('sentiment', 'Negative sentiment', { tone: 'warn', filter: { group: 'sentiment', value: 'Negative' } }),
  sample('sentiment', 'Frustrated sentiment', { tone: 'warn', filter: { group: 'sentiment', value: 'Frustrated' } }),
  sample('attachments', 'Attachments'),
  sample('notes', 'Your notes'),
  sample('replies', 'Replies in the thread'),
  sample('duplicates', 'Duplicates merged'),
  sample('masked', 'Contains a masked secret'),
]

/** The `?` legend (FR-UI-014): every symbol a card can show. A native modal dialog: focus trap and Esc for free. */
export function Legend({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog ref={ref} className="legend" aria-labelledby="legend-title" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <h2 id="legend-title">Card symbols</h2>
      <div className="legend-cols">
        <section>
          <h3>Type</h3>
          <ul>
            {TYPES.map((t) => (
              <li key={t}>
                <TypeIcon type={t} /> {t}
              </li>
            ))}
            <li>
              <span className="type-chip type-chip-review" aria-hidden="true">
                <TypeIcon type="Task" size={14} /> Task?
              </span>{' '}
              Uncertain: click to correct
            </li>
          </ul>
        </section>
        <section>
          <h3>Urgency</h3>
          <ul>
            {URGENCIES.map((u) => (
              <li key={u}>
                <UrgencyMark urgency={u} /> {u}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Tags</h3>
          <ul>
            {TAGS.map((t) => (
              <li key={t.label}>
                <span className="tag" data-tone={t.tone}>
                  <TagIcon tag={t} />
                  {t.text}
                </span>{' '}
                {t.label}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="legend-hint">Click a type, urgency, security, sentiment or Overdue / Due today mark to filter the column by it.</p>
      <form method="dialog">
        <button type="submit" className="text-button">
          Close
        </button>
      </form>
    </dialog>
  )
}
