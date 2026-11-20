import { Archive, ArchiveRestore } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import { createProject, patchProject, setEmailsInProject } from '../api/queries'
import type { Project, ProjectInput } from '../api/types'
import { goTo } from '../lib/navigate'
import { dayFromDeadline, deadlineFromDay, PROJECT_COLOURS } from './projectModel'
import { onProjectDialog, takeRequest, type ProjectDialogRequest } from './dialogBus'
import '../inbox/inbox.css'
import './projects.css'

interface Form {
  name: string
  colour: string
  icon: string
  description: string
  day: string
  jira_project_key: string
  jira_epic: string
}

const empty = (): Form => ({ name: '', colour: PROJECT_COLOURS[0], icon: '', description: '', day: '', jira_project_key: '', jira_epic: '' })
const fromProject = (p: Project): Form => ({
  name: p.name,
  colour: p.colour,
  icon: p.icon ?? '',
  description: p.description ?? '',
  day: dayFromDeadline(p.deadline),
  jira_project_key: p.jira_project_key ?? '',
  jira_epic: p.jira_epic ?? '',
})
const fieldErrors = (err: unknown): Record<string, string> =>
  err instanceof ApiError && err.code === 'validation_failed' ? ((err.details as { fields?: Record<string, string> } | null)?.fields ?? {}) : {}

/**
 * New project / Edit project (FR-UI-016): name, colour, emoji, description, optional deadline, optional Jira project
 * and epic. Editing also archives (archiving replaces deletion; archived projects stay searchable) or restores.
 * Mounted once in the shell; opened through openProjectDialog.
 */
export function ProjectDialogHost({ onToast }: { onToast: (message: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [req, setReq] = useState<ProjectDialogRequest | null>(null)
  const [form, setForm] = useState<Form>(empty)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const id = useId()

  useEffect(
    () =>
      onProjectDialog((r) => {
        setReq(r)
        setForm(r.project ? fromProject(r.project) : empty())
        setErrors({})
        setFailure(null)
        setBusy(false)
      }),
    [],
  )
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (req && !d.open) d.showModal()
    if (!req && d.open) d.close()
  }, [req])

  const editing = req?.project
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const close = () => {
    takeRequest()
    setReq(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!req) return
    const body: ProjectInput = {
      name: form.name.trim(),
      colour: form.colour,
      icon: form.icon.trim() || null,
      description: form.description.trim() || null,
      deadline: deadlineFromDay(form.day),
      jira_project_key: form.jira_project_key.trim().toUpperCase() || null,
      jira_epic: form.jira_epic.trim().toUpperCase() || null,
    }
    setBusy(true)
    setErrors({})
    setFailure(null)
    try {
      if (editing) {
        await patchProject(editing.id, body)
        onToast(`Saved ${body.name}`)
      } else {
        const p = await createProject(body)
        if (req.addEmails?.length) await setEmailsInProject(p, req.addEmails, true)
        // From the picker the user stays where they were, so a toast confirms; otherwise the new project opens.
        if (req.addEmails?.length) onToast(`Created ${p.name} and added ${req.addEmails.length === 1 ? 'the email' : `${req.addEmails.length} emails`}`)
        else goTo(`/projects/${p.id}`)
      }
      close()
    } catch (err) {
      const fields = fieldErrors(err)
      setErrors(fields)
      if (!Object.keys(fields).length) setFailure(err instanceof Error ? err.message : "Couldn't save the project")
      setBusy(false)
    }
  }

  const archive = async () => {
    if (!editing) return
    setBusy(true)
    try {
      const archived = !editing.archived_at
      await patchProject(editing.id, { archived })
      onToast(archived ? `Archived ${editing.name}. It stays searchable.` : `Restored ${editing.name}`)
      close()
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Couldn't archive the project")
      setBusy(false)
    }
  }

  const field = (key: keyof Form & string, wire: string, label: string, input: ReactNode, hint?: string) => (
    <div className="pd-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {input}
      {errors[wire] ? (
        <span className="pd-error" id={`${id}-${key}-err`}>
          {errors[wire]}
        </span>
      ) : hint ? (
        <span className="pd-hint">{hint}</span>
      ) : null}
    </div>
  )
  const inputProps = (key: keyof Form & string, wire: string = key) => ({
    id: `${id}-${key}`,
    value: form[key],
    onChange: (e: { target: { value: string } }) => set(key)(e.target.value),
    'aria-invalid': errors[wire] ? true : undefined,
    'aria-describedby': errors[wire] ? `${id}-${key}-err` : undefined,
  })

  return (
    <dialog ref={ref} className="project-dialog" aria-labelledby={`${id}-title`} onClose={close} onClick={(e) => e.target === ref.current && close()}>
      {req && (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <h2 id={`${id}-title`}>{editing ? 'Edit project' : 'New project'}</h2>
          <div className="pd-row">
            {field('icon', 'icon', 'Emoji', <input {...inputProps('icon')} className="pd-emoji" maxLength={8} placeholder="📁" autoComplete="off" />)}
            {field('name', 'name', 'Name', <input {...inputProps('name')} required maxLength={60} autoComplete="off" />)}
          </div>
          <fieldset className="pd-field pd-colours">
            <legend>Colour</legend>
            <div className="pd-swatches">
              {PROJECT_COLOURS.map((c) => (
                <label key={c} className="pd-swatch" style={{ background: c }} title={c}>
                  <input type="radio" name={`${id}-colour`} value={c} checked={form.colour === c} onChange={() => set('colour')(c)} />
                  <span className="sr-only">{c}</span>
                </label>
              ))}
            </div>
            {errors.colour && <span className="pd-error">{errors.colour}</span>}
          </fieldset>
          {field('description', 'description', 'Description', <textarea {...inputProps('description')} rows={2} maxLength={500} />)}
          <div className="pd-row">
            {field('day', 'deadline', 'Deadline (optional)', <input {...inputProps('day', 'deadline')} type="date" />)}
            {field('jira_project_key', 'jira_project_key', 'Jira project', <input {...inputProps('jira_project_key')} placeholder="ATL" autoComplete="off" />)}
            {field('jira_epic', 'jira_epic', 'Jira epic', <input {...inputProps('jira_epic')} placeholder="ATL-100" autoComplete="off" />)}
          </div>
          {req.addEmails?.length ? (
            <p className="pd-hint">
              {req.addEmails.length === 1 ? 'The email you chose is added to it.' : `The ${req.addEmails.length} emails you chose are added to it.`}
            </p>
          ) : null}
          {failure && (
            <p className="pd-error" role="alert">
              {failure}
            </p>
          )}
          <div className="pd-foot">
            {editing && (
              <button type="button" className="ghost-button pd-archive" disabled={busy} onClick={() => void archive()}>
                {editing.archived_at ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
                {editing.archived_at ? 'Restore' : 'Archive'}
              </button>
            )}
            <button type="button" className="ghost-button" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy || !form.name.trim()}>
              {busy ? 'Saving…' : editing ? 'Save' : 'Create project'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
