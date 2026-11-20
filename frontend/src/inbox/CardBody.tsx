import { Pin } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { EmailListItem } from '../api/types'
import { MaskedText } from '../components/MaskedText'
import { cardTags, cardTime, senderName, senderRole, visibleTags, type CardTag, type FilterPatch } from './cardModel'
import { CorrectionMenu } from './CorrectionMenu'
import { TagIcon, TypeIcon, UrgencyMark } from './marks'

type Filter = (patch: FilterPatch) => (e: ReactMouseEvent) => void

/**
 * Card layer 1 content (FR-UI-011, item 3): type icon · sender · role · time · urgency, subject (the only bold line),
 * one-line summary, tag strip. Shared by the card in the list and its lifted copy (CardLift). Subject and summary
 * are plain text with masked-secret chips; no HTML is ever rendered from email content.
 */
export function CardBody({ email, now, subjectId, filter, tags = true }: { email: EmailListItem; now: Date; subjectId: string | undefined; filter: Filter; tags?: boolean }) {
  const triage = email.triage
  const role = senderRole(email)
  return (
    <>
      <div className="card-meta">
        {!triage ? (
          <span className="skel skel-chip" role="img" aria-label="Not classified yet" />
        ) : triage.needs_review ? (
          <CorrectionMenu email={{ ...email, triage }} />
        ) : (
          <button
            type="button"
            className="type-chip"
            title={`${triage.email_type.label}: click to show only this type`}
            onClick={filter({ group: 'type', value: triage.email_type.label })}
          >
            <TypeIcon type={triage.email_type.label} />
            <span className="sr-only">Type {triage.email_type.label}. Filter by this type</span>
          </button>
        )}
        {!email.read && (
          <span className="card-unread" title="Unread">
            <span className="sr-only">Unread</span>
          </span>
        )}
        <span className="card-sender" title={email.from.address} data-unread={!email.read || undefined}>
          {senderName(email)}
        </span>
        {role && <span className="card-role">{role}</span>}
        <span className="card-meta-end">
          {email.pinned && (
            <span className="card-pin" title="Pinned">
              <Pin size={12} aria-hidden="true" />
              <span className="sr-only">Pinned</span>
            </span>
          )}
          <time className="card-time" dateTime={email.received_at} title={new Date(email.received_at).toLocaleString()}>
            {cardTime(email.received_at, now)}
          </time>
          {triage && (
            <button
              type="button"
              className="urgency"
              title={`${triage.urgency.label} urgency: click to show only this urgency`}
              onClick={filter({ group: 'urgency', value: triage.urgency.label })}
            >
              <UrgencyMark urgency={triage.urgency.label} />
              <span className="sr-only">{triage.urgency.label} urgency. Filter by this urgency</span>
            </button>
          )}
        </span>
      </div>

      <h3 className="card-subject" id={subjectId}>
        {email.subject ? <MaskedText text={email.subject} /> : '(no subject)'}
      </h3>

      <p className="card-summary">
        {email.summary_one_line ? (
          <MaskedText text={email.summary_one_line} />
        ) : email.status === 'enrich_failed' ? (
          <span className="card-summary-missing">No summary available</span>
        ) : (
          <span className="skel skel-line" role="img" aria-label="Summary on its way" />
        )}
      </p>

      {tags && <TagStrip tags={cardTags(email, now)} onFilter={filter} />}
    </>
  )
}

/**
 * At most five tags, then +N (FR-UI-014). In the hover lift the same strip opens up to every tag, inside the card
 * (F13; it replaces the old tag popover). Tags with a §6.5 query parameter (security, sentiment) are filter buttons.
 */
function TagStrip({ tags, onFilter }: { tags: CardTag[]; onFilter: Filter }) {
  if (tags.length === 0) return <div className="card-tags" />
  const { shown, hidden } = visibleTags(tags)
  const rest = tags.slice(shown.length)

  return (
    <div className="card-tags">
      <ul className="tag-row" aria-label="Tags">
        {shown.map((t) => (
          <li key={t.kind}>
            <Tag tag={t} onFilter={onFilter} />
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <span className="tag tag-more" title={rest.map((t) => t.label).join(', ')} aria-label={`${hidden} more: ${rest.map((t) => t.label).join(', ')}`}>
              +{hidden}
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

/** One tag. `labelled`: with its label written out (the lift's full list), not only its icon and short text. */
export function Tag({ tag, onFilter, labelled = false }: { tag: CardTag; onFilter: Filter; labelled?: boolean }) {
  const body = (
    <>
      <TagIcon tag={tag} />
      {labelled ? <span aria-hidden="true">{tag.label}</span> : tag.text && <span aria-hidden="true">{tag.text}</span>}
    </>
  )
  if (tag.filter) {
    return (
      <button type="button" className="tag" data-tone={tag.tone} data-kind={tag.kind} title={`${tag.label}: click to filter`} onClick={onFilter(tag.filter)}>
        {body}
        <span className="sr-only">{tag.label}. Filter by this</span>
      </button>
    )
  }
  return (
    <span className="tag" data-tone={tag.tone} data-kind={tag.kind} title={tag.label}>
      {body}
      <span className="sr-only">{tag.label}</span>
    </span>
  )
}
