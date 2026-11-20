// Sign-in (NFR-SEC-003, FR-ADM-001/004): Google OAuth for real tenants; DEV_LOGIN for the demo mailbox only.
// Access tokens live in the client's memory; the refresh token is an httpOnly cookie on /api/v1/auth.
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { Fail, route } from '../http.js';
import { audit } from '../services/audit.js';
import { encrypt } from '../services/crypto.js';
import { query, tx } from '../services/db.js';
import { ACCESS_TTL_S, REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie, signAccess, verifyRefresh } from '../services/tokens.js';

export const auth = Router();

// NFR-SEC-005: gmail.readonly only, never gmail.send; calendar.events comes later by incremental consent.
const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'];
const redirectUri = () => `${config.publicBaseUrl}/api/v1/auth/google/callback`;
const oauth = () => new OAuth2Client(config.google.clientId, config.google.clientSecret, redirectUri());

/** Only same-site relative paths, so `return` can't send the user to another site (open redirect). */
const safeReturn = (v) => (typeof v === 'string' && /^\/(?!\/)[^\s]*$/.test(v) ? v : '/');

async function signIn(res, user, tenantId) {
  const now = Math.floor(Date.now() / 1000);
  setRefreshCookie(res, user.id, now);
  await tx(async (c) => {
    await c.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await audit(c, { tenantId, actorId: user.id, event: 'login', target: user.id });
  });
}

route(auth, 'get', '/auth/google', 'public', (req, user, res) => {
  const back = safeReturn(req.query.return);
  if (!config.google.clientId) {
    if (!config.devLogin) throw new Fail(503, 'unavailable', 'Google sign-in is not configured');
    return res.redirect(`/api/v1/auth/dev?return=${encodeURIComponent(back)}`);
  }
  // `state` carries only the return path; reauth forces Google's own sign-in screen (FR-SEC-008).
  res.redirect(oauth().generateAuthUrl({
    access_type: 'offline',
    prompt: req.query.reauth ? 'login' : 'consent',
    scope: SCOPES,
    state: back,
    include_granted_scopes: true,
  }));
}, { raw: true });

route(auth, 'get', '/auth/google/callback', 'public', async (req, user, res) => {
  if (!config.google.clientId) throw new Fail(503, 'unavailable', 'Google sign-in is not configured');
  const client = oauth();
  const { tokens } = await client.getToken(String(req.query.code ?? ''));
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw new Fail(403, 'forbidden', 'Your Google account email is not verified');
  const email = p.email.toLowerCase();

  const signedIn = await tx(async (c) => {
    let u = (await c.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
    if (!u) {
      // FR-ADM-001: the very first sign-in creates the tenant and makes that user its admin. After that, only
      // allow-listed addresses (FR-ADM-004) get in.
      const any = (await c.query('SELECT 1 FROM tenants LIMIT 1')).rows[0];
      if (any) throw new Fail(403, 'forbidden', 'This account is not on the allow-list. Ask your administrator.');
      const t = (await c.query('INSERT INTO tenants (name, domains) VALUES ($1, $2) RETURNING id', [email.split('@')[1], [email.split('@')[1]]])).rows[0];
      u = (await c.query(`INSERT INTO users (tenant_id, email, display_name, is_admin, permissions) VALUES ($1,$2,$3,true,'{security.review}') RETURNING *`, [t.id, email, p.name ?? null])).rows[0];
    }
    // The Gmail refresh token, encrypted (NFR-SEC-001), for M2's polling. Only on consent does Google send one.
    if (tokens.refresh_token) {
      await c.query(
        `INSERT INTO mailboxes (tenant_id, user_id, address, refresh_token_enc) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET refresh_token_enc = EXCLUDED.refresh_token_enc, status = 'active'`,
        [u.tenant_id, u.id, email, encrypt(tokens.refresh_token)],
      );
    }
    return u;
  });
  await signIn(res, signedIn, signedIn.tenant_id);
  res.redirect(safeReturn(req.query.state));
}, { raw: true });

// Dev only: the demo has no Google project. Off unless DEV_LOGIN=1; signs in an existing user by email.
route(auth, 'get', '/auth/dev', 'public', async (req, user, res) => {
  if (!config.devLogin) throw new Fail(404, 'not_found', 'No such route');
  const email = String(req.query.email ?? 'demo@northwind.example').toLowerCase();
  const u = (await query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
  if (!u) throw new Fail(403, 'forbidden', 'No such demo user. Run npm run seed first.');
  await signIn(res, u, u.tenant_id);
  res.redirect(safeReturn(req.query.return));
}, { raw: true });

// The only cookie-authenticated call: it returns a token a cross-site page can't read (CSRF-safe).
route(auth, 'post', '/auth/refresh', 'public', async (req, user, res) => {
  const claims = verifyRefresh(req.cookies?.[REFRESH_COOKIE]);
  const known = claims && (await query('SELECT 1 FROM users WHERE id = $1', [claims.sub])).rows[0];
  if (!known) {
    clearRefreshCookie(res);
    throw new Fail(401, 'unauthenticated', 'Not signed in');
  }
  // Rolling session: each refresh renews the cookie, keeping the original sign-in time.
  setRefreshCookie(res, claims.sub, claims.auth_time);
  return { access_token: signAccess(claims.sub, claims.auth_time), expires_in: ACCESS_TTL_S };
});

route(auth, 'post', '/auth/logout', 'user', (req, user, res) => {
  clearRefreshCookie(res);
});
