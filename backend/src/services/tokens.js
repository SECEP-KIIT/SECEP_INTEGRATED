// Tokens (NFR-SEC-003): 15-minute JWT access tokens in the Authorization header, and a 7-day refresh token in an
// httpOnly, Secure, SameSite=Strict cookie scoped to /api/v1/auth. `auth_time` is the last Google sign-in, for
// the 5-minute re-auth rule on Reveal (FR-SEC-008).
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const ACCESS_TTL_S = 900;
const REFRESH_TTL_S = 7 * 24 * 3600;
export const REFRESH_COOKIE = 'secep_refresh';

export const signAccess = (userId, authTime) =>
  jwt.sign({ sub: userId, auth_time: authTime, typ: 'access' }, config.jwtSecret, { expiresIn: ACCESS_TTL_S, algorithm: 'HS256' });

export function verifyAccess(token) {
  try {
    const c = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return c.typ === 'access' ? c : null;
  } catch {
    return null;
  }
}

export function setRefreshCookie(res, userId, authTime) {
  const token = jwt.sign({ sub: userId, auth_time: authTime, typ: 'refresh' }, config.jwtSecret, { expiresIn: REFRESH_TTL_S, algorithm: 'HS256' });
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: REFRESH_TTL_S * 1000,
  });
}

export function verifyRefresh(token) {
  try {
    const c = jwt.verify(token ?? '', config.jwtSecret, { algorithms: ['HS256'] });
    return c.typ === 'refresh' ? c : null;
  } catch {
    return null;
  }
}

export const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
