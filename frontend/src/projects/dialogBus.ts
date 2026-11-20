// Opening the project dialog from anywhere (the sidebar's +, the project picker's "New project…", a project's Edit):
// one dialog, mounted once in the shell, listens for this event.
import type { Project } from '../api/types'

export interface ProjectDialogRequest {
  /** Edit this project; omitted: create a new one. */
  project?: Project
  /** Emails to add to the new project once it's created (from the picker). */
  addEmails?: readonly string[]
}

const EVENT = 'secep:project-dialog'

/** The latest request, for the dialog's chunk when it loads after the first one was sent. */
let pending: ProjectDialogRequest | null = null

export function openProjectDialog(req: ProjectDialogRequest = {}) {
  pending = req
  dispatchEvent(new CustomEvent<ProjectDialogRequest>(EVENT, { detail: req }))
}

/** Calls `fn` for every request, starting with one sent before it subscribed (the lazy chunk's first open). */
export function onProjectDialog(fn: (req: ProjectDialogRequest) => void) {
  if (pending) fn(pending)
  const handler = (e: Event) => fn((e as CustomEvent<ProjectDialogRequest>).detail)
  addEventListener(EVENT, handler)
  return () => removeEventListener(EVENT, handler)
}

/** The dialog closed: nothing is pending any more. */
export const takeRequest = () => void (pending = null)

