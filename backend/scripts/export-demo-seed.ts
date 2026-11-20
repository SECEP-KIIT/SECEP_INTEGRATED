// One-off: exports the frontend mock's demo mailbox (frontend/src/mocks/store) as JSON for the backend seeder, so
// the real API demos the same mail the mock did. Times are relative to EPOCH; the seeder shifts them to "now".
// Run from the repo root:  npx --yes tsx backend/scripts/export-demo-seed.ts
import { writeFileSync } from 'node:fs'
import { createDb } from '../../frontend/src/mocks/store/generate'
import { toAction } from '../../frontend/src/mocks/store/serialize'
import { SENDERS } from '../../frontend/src/mocks/store/templates'

const EPOCH = Date.parse('2026-11-18T00:00:00.000Z')
const db = createDb(EPOCH)
const out = {
  epoch: new Date(EPOCH).toISOString(),
  users: db.users.map(({ mailbox, last_login_at: _l, ...u }) => ({ ...u, mailbox_address: mailbox?.address ?? null })),
  threads: [...db.threads.values()],
  emails: [...db.emails.values()],
  actions: [...db.actions.values()].map((a) => ({ ...toAction(a), user_id: a.user_id })),
  url_checks: db.urlChecks.map(({ click_delay_ms: _d, ...c }) => c),
  secrets: db.secrets,
  projects: db.projects,
  reads: Object.fromEntries([...db.reads].map(([u, s]) => [u, [...s]])),
  handled: Object.fromEntries([...db.handled].map(([u, m]) => [u, [...m]])),
  models: db.models,
  // Internal senders with a role become directory users (no mailbox), so cards show their role (FR-UI-011).
  senders: SENDERS.filter((x) => x.role && x.address.endsWith('@northwind.example')),
}
writeFileSync(new URL('../seed/demo-mailbox.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(`exported ${out.emails.length} emails, ${out.actions.length} actions, ${out.threads.length} threads`)
