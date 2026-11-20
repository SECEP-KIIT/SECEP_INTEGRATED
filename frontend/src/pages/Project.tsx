import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useParams } from 'react-router'
import { ApiError } from '../api/client'
import { boardOptions, dropEmailsOnBoard, useProject } from '../api/queries'
import { Board } from '../board/Board'
import { NotesAttach } from '../notes/NotesAttach'
import { Column } from '../inbox/Column'
import { DEFAULT_COLUMN_STATE } from '../inbox/cardModel'
import { errorText } from '../inbox/inboxContext'
import { InboxHost } from '../inbox/InboxHost'
import { openProjectDialog } from '../projects/dialogBus'
import { deadlineText, isOverdue, ringTone, toneColour, toneLabel } from '../projects/projectModel'
import '../projects/projects.css'
import { ProgressRing } from '../shell/ProgressRing'
import { useMinuteClock } from '../shell/useMinuteClock'
import { shellToast } from '../lib/toastBus'

/**
 * A project's view (FR-UI-020): header with the deadline countdown and the progress ring (amber when tasks are
 * overdue, red when the deadline is under 48 h with progress under 70 %), then its Emails and its Tasks (the board,
 * this project's cards only). Notes, Files and Timeline join with tasks 12 and 13.
 */
export function Component() {
  const { id = '' } = useParams()
  return (
    <InboxHost>
      <ProjectView key={id} id={id} />
    </InboxHost>
  )
}

function ProjectView({ id }: { id: string }) {
  const now = useMinuteClock()
  const project = useProject(id)
  const cards = useQuery(boardOptions(id))

  if (project.isPending) return <p className="col-state">Loading the project…</p>
  if (project.isError) {
    const missing = project.error instanceof ApiError && project.error.status === 404
    return (
      <p className="col-state" role="alert">
        {missing ? "This project doesn't exist, or isn't yours." : `Couldn't load the project. ${errorText(project.error)}`}
      </p>
    )
  }

  const p = project.data
  const overdue = cards.data?.items.filter((a) => isOverdue(a, now)).length
  const tone = ringTone(p, now, overdue)
  const warning = toneLabel(tone)
  const countdown = deadlineText(p.deadline, now)
  const pct = p.progress.total ? Math.round((p.progress.done / p.progress.total) * 100) : 0

  return (
    <div className="project-page">
      <header className="project-head">
        <span className="project-ring-big">
          <ProgressRing done={p.progress.done} total={p.progress.total} colour={p.colour} stroke={toneColour(tone, p.colour)} warning={warning} size={48} />
        </span>
        <div className="project-meta">
          <h2>
            {p.icon && <span aria-hidden="true">{p.icon}</span>}
            {p.name}
            {p.archived_at && <span className="project-archived">Archived</span>}
          </h2>
          <span>
            <strong>
              {p.progress.done} of {p.progress.total} tasks done
            </strong>{' '}
            ({pct} %){countdown && <> · {countdown}</>}
            {p.jira_project_key && (
              <>
                {' '}
                · Jira {p.jira_project_key}
                {p.jira_epic && `, epic ${p.jira_epic}`}
              </>
            )}
          </span>
          {warning && (
            <span className="project-warn" data-tone={tone}>
              {tone === 'amber' ? `${overdue} ${overdue === 1 ? 'task is' : 'tasks are'} overdue` : 'Deadline under 48 hours with less than 70 % done'}
            </span>
          )}
          {p.description && <span>{p.description}</span>}
        </div>
        <div className="project-head-tools">
          <button type="button" className="ghost-button" onClick={() => openProjectDialog({ project: p })}>
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
        </div>
      </header>
      <div className="project-sections">
        <section className="project-section" aria-label="Emails">
          <Column title="Emails" initial={DEFAULT_COLUMN_STATE} scope={`project=${p.id}`} />
        </section>
        <div className="project-side">
          <section className="project-section" aria-labelledby="project-tasks">
            <h3 id="project-tasks">Tasks</h3>
            <Board
              project={p.id}
              variant="tile"
              label={`${p.name} tasks`}
              onEmailDrop={(ids, column) =>
                void dropEmailsOnBoard(p, ids, column).then(
                  (n) => n > 0 && shellToast(`Moved ${n === 1 ? 'the email' : `${n} emails`} to ${column === 'todo' ? 'To do' : column === 'done' ? 'Done' : 'In progress'}`),
                  () => shellToast("Couldn't move that here", 'error'),
                )
              }
            />
          </section>
          <section className="project-section project-notes" aria-labelledby="project-notes">
            <h3 id="project-notes">Notes & attachments</h3>
            <NotesAttach target={{ type: 'project', id: p.id }} wide />
          </section>
        </div>
      </div>
    </div>
  )
}
