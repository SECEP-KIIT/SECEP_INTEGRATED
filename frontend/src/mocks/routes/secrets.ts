// Click-time link checks (FR-SEC-004, v1.2 JSON response). There is no Reveal: SECEP never holds a credential's
// value (QA pass 5, proposals §18.4).
import { Fail, own, route } from '../http/route'
import { db } from '../store/db'

export const secretRoutes = [
  route<{ checkId: string }>('get', '/links/:checkId/go', 'user', async ({ user, params }) => {
    const check = db.urlChecks.find((c) => c.id === params.checkId)
    const email = check && db.emails.get(check.email_id)
    own(email, user, 'Link')
    if (check!.verdict === 'pending') throw new Fail(409, 'conflict', 'Link not checked yet')
    if (check!.click_delay_ms) await new Promise((r) => setTimeout(r, check!.click_delay_ms))
    // The resolver re-scores the final URL at click time. The mock reuses the stored verdict and chain, or the worse
    // verdict a seeded redirect now leads to (click_verdict).
    const verdict = check!.click_verdict ?? check!.verdict
    if (verdict === 'clean') return { action: 'open', url: check!.final_url }
    if (verdict === 'suspicious') {
      return { action: 'interstitial', verdict: 'suspicious', final_url: check!.final_url, chain: [...check!.chain], signals: [...check!.signals] }
    }
    return { action: 'blocked', verdict: 'malicious', chain: [...check!.chain], signals: [...check!.signals] }
  }),
]
