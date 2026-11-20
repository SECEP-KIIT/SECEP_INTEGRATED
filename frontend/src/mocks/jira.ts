// Simulated Jira Cloud (no network). Mirrors the behaviour M6 must handle: FR-ORC-003 create, FR-ORC-006 errors
// (400/401 → the action fails with Jira's message; 429/5xx → retried, honouring Retry-After, per FR-ING-013).
import { control, scaled } from './control'
import { nextJiraKey } from './store/generate'

export class JiraError extends Error {
  readonly status: number
  readonly retryable: boolean
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.retryable = status === 429 || status >= 500
  }
}

const MAX_ATTEMPTS = 3
const wait = (ms: number) => new Promise((r) => setTimeout(r, scaled(ms)))

let rateLimitedOnce = false

function attempt(key: string): string {
  switch (control.jiraMode) {
    case 'unauthorized':
      throw new JiraError(401, 'Client must be authenticated to access this resource.')
    case 'bad_request':
      throw new JiraError(400, 'Field "priority" is not valid for issue type Task.')
    case 'server_error':
      throw new JiraError(503, 'Service temporarily unavailable.')
    case 'rate_limited_once':
      if (!rateLimitedOnce) {
        rateLimitedOnce = true
        throw new JiraError(429, 'Rate limit exceeded.')
      }
      return nextJiraKey(key)
    case 'ok':
      rateLimitedOnce = false
      return nextJiraKey(key)
  }
}

/**
 * POST /rest/api/3/issue, with retries. Resolves to the new issue key. The issue is assigned to the caller (proposals
 * §12.2, FR-ORC-012): M6 sets the assignee to the caller's linked Jira account; nothing about it goes on the wire.
 */
export async function createIssue(issue: { assignee: string; project_key: string; epic: string | null }): Promise<string> {
  for (let n = 1; ; n++) {
    try {
      await wait(400) // round trip to Jira
      return attempt(issue.project_key)
    } catch (err) {
      if (!(err instanceof JiraError) || !err.retryable || n >= MAX_ATTEMPTS) throw err
      // Retry-After: 1 s on 429; exponential backoff on 5xx.
      await wait(err.status === 429 ? 1000 : 500 * 2 ** n)
    }
  }
}
