// Click-time link checks (FR-SEC-004). There is no Reveal: SECEP never shows a credential's value; the drawer links
// to the message in Gmail instead (QA pass 5, proposals §18.4).
import { Router } from 'express';
import { idParam, own, route } from '../http.js';
import { query } from '../services/db.js';

export const secrets = Router();

/**
 * GET /links/:checkId/go (v1.2 JSON): the M5 resolver re-scores at click time. Until M5 runs, the stored verdict and
 * chain are used. Clean opens, Suspicious needs an interstitial, Malicious never opens.
 */
route(secrets, 'get', '/links/:id/go', 'user', async (req, user) => {
  const id = idParam(req, 'Link');
  const c = own((await query(
    `SELECT u.* FROM url_checks u JOIN emails e ON e.id = u.email_id JOIN mailboxes m ON m.id = e.mailbox_id AND m.user_id = $2 WHERE u.id = $1`,
    [id, user.id],
  )).rows[0], 'Link');
  const chain = c.redirect_chain ?? [c.url];
  const signals = Object.entries(c.signals ?? {}).filter(([, v]) => v === true).map(([k]) => k);
  const finalUrl = c.final_url ?? c.url;
  if (c.verdict === 'clean') return { action: 'open', url: finalUrl };
  if (c.verdict === 'suspicious') return { action: 'interstitial', verdict: 'suspicious', final_url: finalUrl, chain, signals };
  return { action: 'blocked', verdict: 'malicious', chain, signals };
});
