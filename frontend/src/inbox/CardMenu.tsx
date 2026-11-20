import { display, useBindings } from '../lib/keybinds'
import * as Popover from '@radix-ui/react-popover'
import { BellRing, ChevronRight, CircleCheck, Copy, ExternalLink, FolderPlus, Mail, MailOpen, Pin, PinOff, SquareCheck, Undo2, X, Zap } from 'lucide-react'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { EmailListItem } from '../api/types'
import { copySummary } from './cardKeys'
import { useInbox } from './inboxContext'
import { useQuickActions } from './quickActions'
import { useSelection } from './selection'
import { useBulk } from './bulk'

/**
 * The card right-click menu (FR-UI-028, item 8): one for the page, opened at the pointer (or at the card for
 * Shift+F10 / the menu key). Shortcuts on the right; the destructive item would be last. Right-clicking a card that
 * is part of a multi-selection gives the bulk menu instead. Links and text fields keep the browser's own menu.
 */
export function CardMenu({ at, onClose }: { at: { email: EmailListItem; x: number; y: number }; onClose: () => void }) {
  const { selected } = useSelection()
  const bulk = selected.size > 1 && selected.has(at.email.id)
  const ref = useRef<HTMLDivElement>(null)

  // Arrow keys move between items, Home/End jump (menu keyboard pattern).
  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (j: number) => (e.preventDefault(), items[(j + items.length) % items.length]?.focus())
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
  }

  return (
    <Popover.Root open onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor asChild>
        <div style={{ position: 'fixed', left: at.x, top: at.y, width: 0, height: 0 }} aria-hidden="true" />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          ref={ref}
          className="menu card-menu"
          role="menu"
          aria-label={bulk ? `${selected.size} selected emails` : 'Email actions'}
          side="bottom"
          align="start"
          sideOffset={2}
          collisionPadding={8}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
          }}
        >
          {bulk ? <BulkItems at={at} onClose={onClose} /> : <SingleItems at={at} onClose={onClose} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function SingleItems({ at, onClose }: { at: { email: EmailListItem; x: number; y: number }; onClose: () => void }) {
  const email = at.email
  const { toast, pickProject, pickRemind } = useInbox()
  const { selected, toggle } = useSelection()
  const { send, toggleHandled, togglePin, toggleRead, open } = useQuickActions(email, () => {})
  const b = useBindings()
  const k = { jira: display(b.jira), project: display(b.project), remind: display(b.remind), done: display(b.done), select: display(b.select) }
  const run = (fn: () => unknown) => () => {
    onClose()
    void fn()
  }
  return (
    <>
      <Item icon={<ExternalLink size={14} />} label="Open details" keys="Enter" onSelect={run(() => open())} />
      <hr className="menu-sep" />
      {email.jira_key ? (
        <Item icon={<Zap size={14} />} label={`In Jira as ${email.jira_key}`} disabled />
      ) : (
        <Item icon={<Zap size={14} />} label="Send to Jira" keys={k.jira} onSelect={run(() => send('create_jira_issue'))} />
      )}
      <Item icon={<FolderPlus size={14} />} label="Add to project" keys={k.project} more onSelect={() => pickProject([email.id], at.x, at.y)} />
      <Item icon={<BellRing size={14} />} label="Remind me" keys={k.remind} more onSelect={() => pickRemind([email.id], at.x, at.y)} />
      <Item
        icon={email.handled ? <Undo2 size={14} /> : <CircleCheck size={14} />}
        label={email.handled ? 'Restore to inbox' : 'Mark as handled'}
        keys={k.done}
        onSelect={run(toggleHandled)}
      />
      <Item icon={email.pinned ? <PinOff size={14} /> : <Pin size={14} />} label={email.pinned ? 'Unpin' : 'Pin'} onSelect={run(togglePin)} />
      <Item icon={email.read ? <Mail size={14} /> : <MailOpen size={14} />} label={email.read ? 'Mark as unread' : 'Mark as read'} onSelect={run(toggleRead)} />
      <hr className="menu-sep" />
      <Item icon={<SquareCheck size={14} />} label={selected.has(email.id) ? 'Deselect' : 'Select'} keys={k.select} onSelect={run(() => toggle(email.id))} />
      <Item icon={<Copy size={14} />} label="Copy summary" keys="Ctrl C" onSelect={run(() => copySummary(email, toast))} />
    </>
  )
}

function BulkItems({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const { selected, clear } = useSelection()
  const { pickProject, pickRemind } = useInbox()
  const bulk = useBulk()
  const run = (fn: () => unknown) => () => {
    onClose()
    void fn()
  }
  return (
    <>
      <p className="menu-title">{selected.size} selected</p>
      <Item icon={<Zap size={14} />} label="Send each to Jira" onSelect={run(() => bulk.send('create_jira_issue'))} />
      <Item icon={<FolderPlus size={14} />} label="Add all to project" more onSelect={() => pickProject([...selected], at.x, at.y)} />
      <Item icon={<BellRing size={14} />} label="Remind me about all" more onSelect={() => pickRemind([...selected], at.x, at.y)} />
      <Item icon={<CircleCheck size={14} />} label="Mark all as handled" onSelect={run(() => bulk.done())} />
      <hr className="menu-sep" />
      <Item icon={<X size={14} />} label="Clear selection" keys="Esc" onSelect={run(clear)} />
    </>
  )
}

function Item({ icon, label, keys, disabled, more, onSelect }: { icon: ReactNode; label: string; keys?: string; disabled?: boolean; more?: boolean; onSelect?: () => void }) {
  return (
    <button type="button" role="menuitem" className="menu-item" disabled={disabled} onClick={onSelect} aria-haspopup={more ? 'menu' : undefined}>
      <span aria-hidden="true">{icon}</span>
      <span className="menu-label">{label}</span>
      {keys && <kbd className="menu-keys">{keys}</kbd>}
      {more && <ChevronRight size={14} aria-hidden="true" />}
    </button>
  )
}
