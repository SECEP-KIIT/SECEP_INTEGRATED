// PostgreSQL pool (M7 schema, db/migrations). One pool per process; `tx` runs a function in a transaction.
import pg from 'pg';
import { config } from '../config.js';

// dates as plain strings ('YYYY-MM-DD'), never shifted into a JS Date in the server's time zone
pg.types.setTypeParser(1082, (v) => v);
// numeric → number (confidences, scores); the values here are small, so no precision is lost
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
