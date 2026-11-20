import { ExternalLink, Lock } from 'lucide-react'
import { secretLabel } from '../lib/masked'

/**
 * Credentials in this email (FR-SEC-007, as changed in QA pass 5, proposals §18.4). SECEP never stores or shows a
 * credential: the pipeline replaces it with its type, and this list only says what kind it was. To see it, the user
 * opens the message in their own mail app (Gmail), where it has always been.
 */
export function SecretList({ secrets, openUrl }: { secrets: { id: string; secret_type: string }[]; openUrl: string | null }) {
  return (
    <div className="secrets-block">
      <ul className="secrets" aria-label="Credentials in this email">
        {secrets.map((s) => (
          <li key={s.id} className="secret">
            <Lock size={14} aria-hidden="true" />
            <span className="secret-type">{secretLabel(s.secret_type)}</span>
            <span className="secret-mask" aria-hidden="true">
              ••••••••
            </span>
          </li>
        ))}
      </ul>
      {openUrl ? (
        <a className="text-button secret-open" href={openUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} aria-hidden="true" /> Open in Gmail to view
        </a>
      ) : (
        <p className="secret-note">Open this email in Gmail to view it.</p>
      )}
    </div>
  )
}
