import * as Popover from '@radix-ui/react-popover'
import { AlarmClock, CalendarClock } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { createReminder, deleteReminder, emailSubject } from '../api/queries'
import { remindChoices, whenText } from '../reminders/remindChoices'
import { shellToast } from '../lib/toastBus'
import { errorText, useInbox } from './inboxContext'
import type { PickerAt } from './ProjectPicker'

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

/**
 * "Remind me" (FR-REM-002, decisions item 13): Later today, Tomorrow 9 am, Next week, Pick a time. The email stays
 * where it is and a reminder pops up at that time. Snooze was dropped (19 Nov 2026). Undo deletes the reminder.
 */
export function RemindPicker({
  at,
  onClose,
  container,
  target,
}: {
  at: PickerAt
  onClose: () => void
  container?: HTMLElement | null
  /** Board and card-sheet use (19 Nov 2026): `at.ids` are cards, or the board's email cards; title shown in the reminder. */
  target?: { type: 'email' | 'card'; title?: string }
}) {
  const inbox = useInbox()
  // Outside the inbox (the card sheet) the shell's toaster shows the undo.
  const toast = target ? shellToast : inbox.toast
  const kind = target?.type ?? 'email'
  const noun = kind === 'card' ? 'card' : 'email'
  const ref = useRef<HTMLDivElement>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now] = useState(() => new Date())
  const n = at.ids.length

  const apply = async (until: Date) => {
    setBusy(true)
    try {
      // The email stays where it is; a notification arrives at `until` (proposals §21).
      const made = await Promise.all(at.ids.map((id) => createReminder({ type: kind, id }, kind === 'card' || target?.title ? (target?.title ?? 'Card') : emailSubject(id), until)))
      onClose()
      toast(`Reminder${n === 1 ? '' : `s for ${n} ${noun}s`} set for ${whenText(until, now)}`, 'info', {
        label: 'Undo',
        run: () => void Promise.all(made.map((r) => deleteReminder(r.id))).catch((err: unknown) => toast(errorText(err), 'error')),
      })
    } catch (err) {
      setBusy(false)
      toast(errorText(err), 'error')
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (j: number) => (e.preventDefault(), items[(j + items.length) % items.length]?.focus())
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
  }

  return (
    <Popover.Root open onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor asChild>
        <div style={{ position: 'fixed', left: at.x, top: at.y, width: 0, height: 0 }} aria-hidden="true" />
      </Popover.Anchor>
      <Popover.Portal container={container ?? undefined}>
        <Popover.Content
          ref={ref}
          className="menu remind-picker"
          role="menu"
          aria-label={n === 1 ? 'Remind me' : `Remind me about ${n} ${noun}s`}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ref.current?.querySelector<HTMLElement>('[role="menuitem"], input')?.focus()
          }}
        >
          <p className="menu-title">{n === 1 ? 'Remind me' : `Remind me about ${n} ${noun}s`}</p>
          {!picking &&
            remindChoices(now).map((c) => (
              <button key={c.id} type="button" role="menuitem" className="menu-item" disabled={busy} onClick={() => void apply(c.at)}>
                <AlarmClock size={14} aria-hidden="true" />
                <span className="menu-label">{c.label}</span>
                <span className="menu-keys">{whenText(c.at, now)}</span>
              </button>
            ))}
          {!picking && (
            <button type="button" role="menuitem" className="menu-item" onClick={() => setPicking(true)}>
              <CalendarClock size={14} aria-hidden="true" />
              <span className="menu-label">Pick a time</span>
            </button>
          )}
          {picking && <PickTime min={localInput(new Date(now.getTime() + 60_000))} now={now} disabled={busy} onPick={(d) => void apply(d)} onBack={() => setPicking(false)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function PickTime({ min, now, disabled, onPick, onBack }: { min: string; now: Date; disabled: boolean; onPick: (d: Date) => void; onBack: () => void }) {
  const [value, setValue] = useState('')
  const date = value ? new Date(value) : null
  const ok = date !== null && !Number.isNaN(date.getTime()) && date.getTime() > now.getTime()
  return (
    <div className="remind-pick">
      <input type="datetime-local" aria-label="Remind me at" min={min} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <div className="remind-pick-row">
        <button type="button" className="text-button" onClick={onBack}>
          Back
        </button>
        <button type="button" className="ghost-button" disabled={disabled || !ok} onClick={() => ok && onPick(date)}>
          Remind me
        </button>
      </div>
    </div>
  )
}
