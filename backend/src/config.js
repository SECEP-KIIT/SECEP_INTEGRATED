// Configuration (SRS §6.8). Secrets come from *_FILE paths (backend/secrets/, git-ignored); the inline variants
// exist for tests and CI only.
import { readFileSync } from 'node:fs';

function secret(name, { required = true } = {}) {
  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      if (required) throw new Error(`${name}_FILE (${file}) can't be read`);
      return null;
    }
  }
  const inline = process.env[name];
  if (inline) return inline;
  if (required) throw new Error(`Missing ${name}_FILE (SRS §6.8)`);
  return null;
}

const flag = (name) => process.env[name] === '1' || process.env[name] === 'true';

export const config = {
  port: Number(process.env.PORT) || 4000,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL || 'postgres://secep:secep@localhost:5432/secep',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    clientSecret: secret('GOOGLE_CLIENT_SECRET', { required: false }),
  },
  // Lazy: only the code paths that need them read the files, so `npm test` with inline values works.
  get jwtSecret() {
    return secret('JWT_SECRET');
  },
  get masterKey() {
    return secret('MASTER_KEY');
  },
  /** Dev only: sign in by email without Google, for the demo mailbox. Never set in production. */
  devLogin: flag('DEV_LOGIN'),
  /** Simulate Jira and Calendar when the tenant has no Jira settings (demo). */
  simulateIntegrations: process.env.SIMULATE_INTEGRATIONS !== '0',
  secureCookies: process.env.NODE_ENV === 'production',
  /** Uploaded files (FR-CNT-006): the `files` volume in Docker (§6.8). */
  filesDir: process.env.FILES_DIR || './data/files',
};
