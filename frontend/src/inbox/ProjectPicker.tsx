import * as Popover from '@radix-ui/react-popover'
import { Check, FolderPlus, Minus } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { emailProjects, setEmailsInProject, useProjects } from '../api/queries'
import type { Project } from '../api/types'
import { errorText, useInbox } from './inboxContext'

export interface PickerAt {
  ids: readonly string[]
  x: number
  y: number
}

/**
 * Add to project (FR-UI-017, item 5 "right-click → Project ▸, bulk assign, p"): one picker for the page, opened from
 * a card's Project button, the card menu, the selection bar or `p`. Each project shows whether all, some or none of
 * the emails are in it; choosing it adds the rest, or removes all when every one is already in. Undo reverses it.
 */
export function ProjectPicker({ at, onClose, onCreate, container }: { at: PickerAt; onClose: () => void; onCreate?: (ids: readonly string[]) => void; container?: HTMLElement | null }) {
  const { toast } = useInbox()
  const projects = useProjects()
  const active = (projects.data?.items ?? []).filter((p) => !p.archived_at)
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const n = at.ids.length
  const inCount = (p: Project) => at.ids.filter((id) => emailProjects(id).some((r) => r.id === p.id)).length

  const choose = async (p: Project) => {
    const all = inCount(p) === n
    const changing = all ? [...at.ids] : at.ids.filter((id) => !emailProjects(id).some((r) => r.id === p.id))
    setBusy(true)
    try {
      await setEmailsInProject(p, changing, !all)
      onClose()
      const what = changing.length === 1 ? '' : `${changing.length} emails `
      const message = all ? `Removed ${what}from ${p.name}` : `Added ${what}to ${p.name}`
      toast(message, 'info', {
        label: 'Undo',
        run: () => void setEmailsInProject(p, changing, all).catch((err: unknown) => toast(errorText(err), 'error')),
      })
    } catch (err) {
      setBusy(false)
      toast(errorText(err), 'error')
    }
  }

  // Arrow keys move between items (menu keyboard pattern).
  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"], [role="menuitem"]') ?? [])]
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
          className="menu project-picker"
          role="menu"
          aria-label={n === 1 ? 'Add to project' : `Add ${n} emails to a project`}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
          }}
        >
          <p className="menu-title">{n === 1 ? 'Add to project' : `Add ${n} emails to project`}</p>
          {projects.isPending && <p className="menu-note">Loading projects…</p>}
          {projects.isError && <p className="menu-error">Couldn't load your projects.</p>}
          {projects.isSuccess && active.length === 0 && <p className="menu-note">No projects yet.</p>}
          {active.map((p) => {
            const count = inCount(p)
            const state = count === n ? 'all' : count > 0 ? 'some' : 'none'
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                className="menu-item project-choice"
                disabled={busy}
                title={state === 'all' ? `Remove from ${p.name}` : `Add to ${p.name}`}
                onClick={() => void choose(p)}
              >
                <span className="project-dot" style={{ background: p.colour }} aria-hidden="true" />
                <span className="menu-label">
                  {p.icon && <span aria-hidden="true">{p.icon} </span>}
                  {p.name}
                </span>
                <span className="project-check" aria-hidden="true">
                  {state === 'all' ? <Check size={14} /> : state === 'some' ? <Minus size={14} /> : null}
                </span>
              </button>
            )
          })}
          {onCreate && (
            <>
              <hr className="menu-sep" />
              <button type="button" role="menuitem" className="menu-item" onClick={() => (onClose(), onCreate(at.ids))}>
                <FolderPlus size={14} aria-hidden="true" />
                <span className="menu-label">New project…</span>
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
