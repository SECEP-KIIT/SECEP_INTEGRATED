import { useMe } from '../api/queries'
import { Column } from '../inbox/Column'
import { DEFAULT_COLUMN_STATE, parseColumnQuery } from '../inbox/cardModel'
import { InboxHost } from '../inbox/InboxHost'
import { canReviewSecurity } from '../shell/nav'

const column = (query: string) => ({ ...DEFAULT_COLUMN_STATE, ...parseColumnQuery(query) })
const MALICIOUS = column('flag=malicious')
const SUSPICIOUS = column('flag=suspicious')

/**
 * Security view (FR-SEC-003, security.review): flagged mail in two columns, Malicious first. Each card opens the
 * drawer, with its warning banner, link checks and masked secrets. Without the permission, the page says so (the
 * sidebar hides it too; the API denies by default).
 */
export function Component() {
  const { data: me } = useMe()
  if (me && !canReviewSecurity(me)) {
    return (
      <div className="col-state" role="alert">
        <p className="col-state-title">Not available</p>
        <p>The Security view needs the security.review permission. Ask your administrator.</p>
      </div>
    )
  }
  return (
    <InboxHost>
      <div className="security-page">
        <Column title="Malicious" initial={MALICIOUS} />
        <Column title="Suspicious" initial={SUSPICIOUS} />
      </div>
    </InboxHost>
  )
}
