// Applies db/migrations/*.sql in order, like dbmate (same schema_migrations table, so either tool works).
// Usage: npm run migrate   (DATABASE_URL from .env)
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

const dir = new URL('../../db/migrations/', import.meta.url);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://secep:secep@localhost:5432/secep' });
await client.connect();
await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version varchar(128) PRIMARY KEY)');
const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
for (const file of readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
  const version = file.split('_')[0];
  if (done.has(version)) continue;
  const up = readFileSync(new URL(file, dir), 'utf8').split('-- migrate:down')[0];
  await client.query('BEGIN');
  try {
    await client.query(up);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    await client.query('COMMIT');
    console.log(`applied ${file}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`failed ${file}: ${err.message}`);
    process.exitCode = 1;
    break;
  }
}
await client.end();
