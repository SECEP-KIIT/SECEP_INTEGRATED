// Visual channels from item 4 (FR-UI-013): type = icon shape, urgency = colour AND shape, security = shield.
// Every mark is decorative (aria-hidden); the element using it supplies the text alternative.
import {
  Angry,
  CalendarClock,
  CircleCheck,
  Copy,
  Frown,
  Info,
  KeyRound,
  Lock,
  NotebookPen,
  Paperclip,
  Reply,
  ShieldAlert,
  ShieldX,
  SquareCheck,
  Stamp,
  Zap,
} from 'lucide-react'
import type { EmailType, Urgency } from '../api/types'
import { splitDot, type CardTag } from './cardModel'

const TYPE_ICONS = { Task: SquareCheck, Info, Credentials: KeyRound, Meeting: CalendarClock, Approval: Stamp }

export function TypeIcon({ type, size = 16 }: { type: EmailType; size?: number }) {
  const Icon = TYPE_ICONS[type]
  return <Icon size={size} aria-hidden="true" focusable="false" />
}

/**
 * Critical = red filled double dot, High = orange dot, Medium = amber hollow dot, Low = small grey dot. The shapes
 * differ, so urgency never depends on colour alone.
 */
export function UrgencyMark({ urgency }: { urgency: Urgency }) {
  return (
    <svg className="urgency-mark" data-urgency={urgency} width="14" height="10" viewBox="0 0 14 10" aria-hidden="true" focusable="false">
      {urgency === 'Critical' && (
        <>
          <circle cx="3.5" cy="5" r="3" />
          <circle cx="10.5" cy="5" r="3" />
        </>
      )}
      {urgency === 'High' && <circle cx="7" cy="5" r="3.5" />}
      {urgency === 'Medium' && <circle cx="7" cy="5" r="3" fill="none" strokeWidth="1.6" />}
      {urgency === 'Low' && <circle cx="7" cy="5" r="2.25" />}
    </svg>
  )
}

export function TagIcon({ tag, size = 13 }: { tag: CardTag; size?: number }) {
  const props = { size, 'aria-hidden': true, focusable: false } as const
  switch (tag.kind) {
    case 'security':
      return tag.filter?.value === 'malicious' ? <ShieldX {...props} /> : <ShieldAlert {...props} />
    case 'due':
      return null // dates carry no icon: one word of context (item 4)
    case 'project': {
      const colours = tag.colours ?? []
      // 5 or more: a ring with the count instead of thin slices (item 5).
      if (colours.length >= 5) {
        return (
          <span className="project-ring" aria-hidden="true">
            {colours.length}
          </span>
        )
      }
      return <span className="project-split" data-split={colours.length > 1 || undefined} style={{ background: splitDot(colours) }} aria-hidden="true" />
    }
    case 'action':
      return tag.tone === 'ok' ? <CircleCheck {...props} /> : <Zap {...props} />
    case 'sentiment':
      return tag.filter?.value === 'Frustrated' ? <Angry {...props} /> : <Frown {...props} />
    case 'attachments':
      return <Paperclip {...props} />
    case 'notes':
      return <NotebookPen {...props} />
    case 'replies':
      return <Reply {...props} />
    case 'duplicates':
      return <Copy {...props} />
    case 'masked':
      return <Lock {...props} />
  }
}
