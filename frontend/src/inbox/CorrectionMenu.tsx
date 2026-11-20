import * as Popover from '@radix-ui/react-popover'
import { useContext, useState } from 'react'
import { useCorrectLabel } from '../api/queries'
import type { EmailListItem, EmailType } from '../api/types'
import { TYPES } from './cardModel'
import { TypeIcon } from './marks'
import { PortalContainer } from './portal'

/**
 * Honest AI labels (FR-UI-012): an uncertain type shows as a dotted "Task?" chip; clicking it opens the correction
 * menu. The correction goes to PATCH /emails/:id/labels. The scope is chosen in the menu itself: "This email only"
 * (the default, FR-ML-013) or "Always from this sender", which the server stores as a sender rule.
 */
export function CorrectionMenu({ email }: { email: EmailListItem & { triage: NonNullable<EmailListItem['triage']> } }) {
  const [open, setOpen] = useState(false)
  const [always, setAlways] = useState(false)
  const correct = useCorrectLabel(email.id)
  const current = email.triage.email_type.label
  const container = useContext(PortalContainer)

  const choose = (value: EmailType) =>
    correct.mutate({ field: 'email_type', value, scope: always ? 'sender' : 'email' }, { onSuccess: () => setOpen(false) })

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          correct.reset()
          setAlways(false)
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="type-chip type-chip-review"
          title={`${current}? The model isn't sure. Click to correct`}
          onClick={(e) => e.stopPropagation()}
        >
          <TypeIcon type={current} size={14} />
          <span aria-hidden="true">{current}?</span>
          <span className="sr-only">Type {current}, uncertain. Correct the type</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container ?? undefined}>
        <Popover.Content className="menu" side="bottom" align="start" sideOffset={4} onClick={(e) => e.stopPropagation()}>
          <p className="menu-title" id={`correct-${email.id}`}>
            What type is this email?
          </p>
          <div role="group" aria-label="Apply to" className="menu-list">
            <button type="button" className="menu-item" aria-pressed={!always} onClick={() => setAlways(false)}>
              This email only
            </button>
            <button type="button" className="menu-item" aria-pressed={always} onClick={() => setAlways(true)}>
              Always from this sender
            </button>
          </div>
          <div role="group" aria-labelledby={`correct-${email.id}`} className="menu-list">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className="menu-item"
                aria-pressed={t === current}
                disabled={correct.isPending}
                onClick={() => choose(t)}
              >
                <TypeIcon type={t} size={14} />
                {t}
              </button>
            ))}
          </div>
          {correct.isError && (
            <p className="menu-error" role="alert">
              Couldn't save the correction. Try again.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
