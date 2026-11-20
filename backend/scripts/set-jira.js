// Stores real Jira settings on the demo tenant (token encrypted with the master key) and tests the connection.
// Dev and demo only: the admin Settings route (PUT /admin/settings) does this in the product.
// Usage (backend folder), values come from environment variables so the token never sits in a file or in history:
//   $env:JIRA_SITE = 'https://yourname.atlassian.net'; $env:JIRA_EMAIL = 'you@example.com'
//   $env:JIRA_PROJECT = 'KAN'; $env:JIRA_TOKEN = '<api token>'
//   node scripts/set-jira.js
// To go back to the simulated Jira: node scripts/set-jira.js --simulate
import { encrypt } from '../src/services/crypto.js';
import { pool } from '../src/services/db.js';
import { testJira } from '../src/services/jira.js';

const TENANT = 'Northwind (demo)';
const { JIRA_SITE, JIRA_EMAIL, JIRA_PROJECT, JIRA_TOKEN } = process.env;

const { rows: [t] } = await pool.query('SELECT id, settings FROM tenants WHERE name = $1', [TENANT]);
if (!t) {
  console.log('The demo tenant is missing. Run npm run seed first.');
  process.exit(1);
}

if (process.argv.includes('--simulate')) {
  await pool.query(`UPDATE tenants SET settings = jsonb_set(settings, '{jira}', '{"project_key":"ATL"}'::jsonb) WHERE id = $1`, [t.id]);
  console.log('Jira is simulated again (project ATL, no token).');
  await pool.end();
  process.exit(0);
}

if (!JIRA_SITE || !JIRA_EMAIL || !JIRA_PROJECT || !JIRA_TOKEN) {
  console.log('Set JIRA_SITE, JIRA_EMAIL, JIRA_PROJECT and JIRA_TOKEN first (see the top of this file).');
  process.exit(1);
}

const jira = { site_url: JIRA_SITE.replace(/\/$/, ''), email: JIRA_EMAIL, token_enc: encrypt(JIRA_TOKEN), project_key: JIRA_PROJECT };
await pool.query(`UPDATE tenants SET settings = jsonb_set(settings, '{jira}', $2::jsonb) WHERE id = $1`, [t.id, JSON.stringify(jira)]);
// The seeded demo projects carry made-up Jira keys; point them at the real project so "Send to Jira" works from them.
const moved = await pool.query('UPDATE projects SET jira_project_key = $2 WHERE tenant_id = $1 AND jira_project_key IS NOT NULL', [t.id, JIRA_PROJECT]);
console.log(`Stored Jira settings for ${jira.site_url} (project ${JIRA_PROJECT}); ${moved.rowCount} demo project(s) now use that key.`);

const { rows: [after] } = await pool.query('SELECT settings FROM tenants WHERE id = $1', [t.id]);
console.log('Connection test:', await testJira(after.settings));
await pool.end();
