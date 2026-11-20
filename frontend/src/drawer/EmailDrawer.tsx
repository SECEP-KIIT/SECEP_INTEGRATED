import { markDone } from '../onboarding/onboarding'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, Mail, MailOpen, Paperclip, Pin, PinOff, ShieldAlert, ShieldX, Undo2, X, BellRing, FolderPlus } from 'lucide-react'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { emailDetailOptions, updateEmail } from '../api/queries'
import type { EmailDetail, LabelSource, Person } from '../api/types'
import { MaskedText } from '../components/MaskedText'
import { senderRole } from '../inbox/cardModel'
import { CorrectionMenu } from '../inbox/CorrectionMenu'
import { errorText, useInbox, type OpenOptions } from '../inbox/inboxContext'
import { setHandled } from '../inbox/quickActions'
import { TypeIcon, UrgencyMark } from '../inbox/marks'
import { PortalContainer } from '../inbox/portal'
import { RemindPicker } from '../inbox/RemindPicker'
import { AttachmentTools } from '../files/AttachmentTools'
import { EmailNotes } from '../notes/EmailNotes'
import { ActionList } from './ActionList'
import { LinkList } from './LinkList'
import { SecretList } from './SecretList'
import './drawer.css'
import { ProjectPicker } from '../inbox/ProjectPicker'
import { openProjectDialog } from '../projects/dialogBus'

const SOURCE: Record<LabelSource, string> = {
  encoder: 'Labelled by the classifier',
  llm: 'Labelled by the LLM adjudicator',
  user: 'Corrected by you',
  rule: 'ⓘ Labelled by your rule',
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const person = (p: Person) => (p.name ? `${p.name} <${p.address}>` : p.address)

/**
 * Card layer 3: the side drawer (FR-UI-011, item 3). A native modal <dialog>, so focus is trapped, Esc closes it and
 * the dashboard behind is inert; focus returns to the card on close. It slides in 24 px with a fade and the content
 * behind dims (item 9). Everything from the email is rendered as plain text: subject, summary and body go through
 * MaskedText (masked-secret chips, no HTML), and only LinkView entries are clickable (FR-SEC-004).
 */
export default function EmailDrawer({ id, compose, onClose }: { id: string; compose?: OpenOptions['compose']; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const detail = useQuery(emailDetailOptions(id))

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    setContainer(d)
    markDone('open_email')
  }, [])

  // Focus stays in the drawer (QA pass 3). An action button that is clicked and then disappears or is replaced
  // (Accept → "Creating…" → the issue key) would otherwise drop focus to <body>: the next key would then go to the
  // page behind instead of the drawer. When that happens, focus moves to the drawer's title.
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const keep = () =>
      requestAnimationFrame(() => {
        if (!d.open || d.contains(document.activeElement)) return
        // Only a drop to <body> is ours to fix; focus moved on purpose elsewhere (another dialog) stays there.
        if (document.activeElement !== document.body && document.activeElement !== null) return
        const title = d.querySelector<HTMLElement>('#drawer-title')
        ;(title ?? d).focus({ preventScroll: true })
      })
    const observer = new MutationObserver(keep)
    observer.observe(d, { childList: true, subtree: true })
    d.addEventListener('focusout', keep)
    return () => {
      observer.disconnect()
      d.removeEventListener('focusout', keep)
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className="drawer"
      data-email-id={id}
      aria-labelledby="drawer-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
    >
      <PortalContainer.Provider value={container}>
        <div className="drawer-inner">
          {detail.isPending ? (
            <DrawerSkeleton onClose={() => ref.current?.close()} />
          ) : detail.isError ? (
            <div className="drawer-state" role="alert">
              <h2 id="drawer-title">Couldn't open this email</h2>
              <p>{errorText(detail.error)}</p>
              <button type="button" className="text-button" onClick={() => ref.current?.close()}>
                Close
              </button>
            </div>
          ) : (
            <DrawerBody email={detail.data} compose={compose} onClose={() => ref.current?.close()} />
          )}
        </div>
      </PortalContainer.Provider>
    </dialog>
  )
}

function DrawerBody({ email, compose, onClose }: { email: EmailDetail; compose?: OpenOptions['compose']; onClose: () => void }) {
  const { toast } = useInbox()
  const portal = useContext(PortalContainer)
  const [remindAt, setRemindAt] = useState<{ ids: string[]; x: number; y: number } | null>(null)
  const [projectAt, setProjectAt] = useState<{ ids: string[]; x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const triage = email.triage
  const role = senderRole(email)

  // Opening an email marks it read for this user (proposals §12.3): one explicit PATCH per open, only if unread. A
  // failure is quiet: the email simply stays unread, and the manual toggle below still works.
  const marked = useRef(false)
  useEffect(() => {
    if (marked.current || email.read) return
    marked.current = true
    updateEmail(email.id, { read: true }).catch(() => {})
  }, [email.id, email.read])

  const toggle = async (patch: { pinned: boolean } | { handled: boolean } | { read: boolean }) => {
    marked.current = true // a manual choice wins over the automatic mark
    setBusy(true)
    try {
      // Handled goes through the shared helper, so the drawer's toast has Undo and See too (QA pass 5).
      if ('handled' in patch) await setHandled([email.id], patch.handled, toast)
      else await updateEmail(email.id, patch)
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {remindAt && <RemindPicker at={remindAt} container={portal} onClose={() => setRemindAt(null)} />}
      {projectAt && <ProjectPicker at={projectAt} container={portal} onClose={() => setProjectAt(null)} onCreate={(ids) => openProjectDialog({ addEmails: ids })} />}
      <header className="drawer-head">
        <div className="drawer-head-row">
          <p className="drawer-from">
            <span>{email.from.name ?? email.from.address}</span>
            {role && <span className="card-role">{role}</span>}
            <time dateTime={email.received_at}>{new Date(email.received_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </p>
          <button type="button" className="icon-button drawer-close" onClick={onClose} aria-label="Close details">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <h2 className="drawer-title" id="drawer-title" tabIndex={-1}>
          {email.subject ? <MaskedText text={email.subject} /> : '(no subject)'}
        </h2>
        <div className="drawer-tools">
          <button type="button" className="ghost-button" aria-pressed={email.pinned} disabled={busy} onClick={() => toggle({ pinned: !email.pinned })}>
            {email.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
            {email.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" className="ghost-button" aria-pressed={email.handled} disabled={busy} onClick={() => toggle({ handled: !email.handled })}>
            {email.handled ? <Undo2 size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
            {email.handled ? 'Mark not handled' : 'Mark handled'}
          </button>
          <button type="button" className="ghost-button" disabled={busy} onClick={() => toggle({ read: !email.read })}>
            {email.read ? <Mail size={14} aria-hidden="true" /> : <MailOpen size={14} aria-hidden="true" />}
            {email.read ? 'Mark unread' : 'Mark read'}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setRemindAt({ ids: [email.id], x: r.left, y: r.bottom })
            }}
          >
            <BellRing size={14} aria-hidden="true" />
            Remind me
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setProjectAt({ ids: [email.id], x: r.left, y: r.bottom })
            }}
          >
            <FolderPlus size={14} aria-hidden="true" />
            Add to project
          </button>
        </div>
      </header>

      {email.security_flag !== 'none' && (
        <p className="drawer-flag" data-flag={email.security_flag} role="note">
          {email.security_flag === 'malicious' ? <ShieldX size={16} aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}
          {email.security_flag === 'malicious'
            ? 'Malicious links found. They are blocked.'
            : 'Suspicious links found. Check them before opening.'}
        </p>
      )}

      <Section title="Summary">
        {email.summary_short ? (
          <p className="drawer-summary">
            <MaskedText text={email.summary_short} />
          </p>
        ) : (
          <p className="drawer-muted">{email.status === 'enrich_failed' ? 'No summary available.' : 'The summary is on its way.'}</p>
        )}
        {triage ? (
          <dl className="labels">
            <div>
              <dt>Type</dt>
              <dd>
                {triage.needs_review ? <CorrectionMenu email={{ ...email, triage }} /> : <TypeIcon type={triage.email_type.label} />}
                {!triage.needs_review && triage.email_type.label} <span className="drawer-muted">{pct(triage.email_type.confidence)}</span>
              </dd>
            </div>
            <div>
              <dt>Urgency</dt>
              <dd>
                <UrgencyMark urgency={triage.urgency.label} /> {triage.urgency.label} <span className="drawer-muted">{pct(triage.urgency.confidence)}</span>
              </dd>
            </div>
            <div>
              <dt>Sentiment</dt>
              <dd>
                {triage.sentiment.label} <span className="drawer-muted">{pct(triage.sentiment.confidence)}</span>
              </dd>
            </div>
            <p className="drawer-muted labels-source">{SOURCE[triage.email_type.source]}</p>
          </dl>
        ) : (
          <p className="drawer-muted">Not classified yet.</p>
        )}
        <details className="drawer-body">
          <summary>Full email</summary>
          {/* Plain text only: sanitized and masked by the pipeline, rendered as text. URLs in it are not linked. */}
          <p className="drawer-body-text">
            <MaskedText text={email.body_text} />
          </p>
        </details>
      </Section>

      <Section title="Proposed actions">
        <ActionList email={email} compose={compose} />
      </Section>

      <Section title="People & thread">
        <dl className="people">
          <div>
            <dt>From</dt>
            <dd>
              {person(email.from)}
              {role && ` · ${role}`}
            </dd>
          </div>
          {email.to.length > 0 && (
            <div>
              <dt>To</dt>
              <dd>{email.to.map(person).join(', ')}</dd>
            </div>
          )}
          {email.cc.length > 0 && (
            <div>
              <dt>Cc</dt>
              <dd>{email.cc.map(person).join(', ')}</dd>
            </div>
          )}
          <div>
            <dt>You</dt>
            <dd>{email.recipient_position === 'to' ? 'Addressed to you' : email.recipient_position === 'cc' ? 'In copy (Cc)' : 'Blind copy (Bcc)'}</dd>
          </div>
        </dl>
        {email.thread && email.thread.message_count > 1 && (
          <>
            <h4 className="drawer-sub">Thread · {email.thread.message_count} messages</h4>
            <ol className="thread">
              {email.thread.messages.map((m) => (
                <li key={m.id} aria-current={m.id === email.id || undefined}>
                  <span className="thread-from">{m.from.name ?? m.from.address}</span>
                  <span className="thread-subject">{m.subject ?? '(no subject)'}</span>
                  <time dateTime={m.received_at}>{new Date(m.received_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                </li>
              ))}
            </ol>
          </>
        )}
      </Section>

      <Section title="Links & security">
        {email.auth_results && (
          <p className="auth">
            {(['spf', 'dkim', 'dmarc'] as const).map((k) => (
              <span key={k} className="auth-item" data-pass={email.auth_results![k] === 'pass' || undefined}>
                {k.toUpperCase()}: {email.auth_results![k]}
              </span>
            ))}
          </p>
        )}
        <LinkList links={email.links} />
        {email.masked_secrets.length > 0 && <SecretList secrets={email.masked_secrets} openUrl={email.open_url} />}
      </Section>

      <Section title="Notes & attachments">
        {email.attachments.length > 0 ? (
          <ul className="attachments">
            {email.attachments.map((a) => (
              <li key={a.index}>
                <Paperclip size={14} aria-hidden="true" />
                <span className="attachment-name">{a.filename}</span>
                <span className="drawer-muted">
                  {a.mime} · {formatSize(a.size)}
                </span>
                <AttachmentTools emailId={email.id} attachment={a} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="drawer-muted">No attachments.</p>
        )}
        <EmailNotes email={email} />
      </Section>
    </>
  )
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** A collapsible section (native <details>: keyboard and screen-reader support for free). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="drawer-section" open>
      <summary>
        <h3>{title}</h3>
      </summary>
      <div className="drawer-section-body">{children}</div>
    </details>
  )
}

function DrawerSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div aria-busy="true">
      <div className="drawer-head-row">
        <span className="skel skel-word" />
        <button type="button" className="icon-button drawer-close" onClick={onClose} aria-label="Close details">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <h2 id="drawer-title" className="sr-only">
        Loading email
      </h2>
      <span className="skel skel-line skel-line-bold" />
      <span className="skel skel-line" />
      <span className="skel skel-line" />
    </div>
  )
}
