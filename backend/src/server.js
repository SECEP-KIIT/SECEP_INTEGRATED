import { createServer } from 'node:http';
import app from './app.js';
import { config } from './config.js';
import { fireDueReminders } from './api/reminders.js';
import { attachSocket } from './services/events.js';
import { startStreams } from './services/streams.js';

// Fail fast on a missing secret, rather than at the first sign-in.
void config.jwtSecret;
void config.masterKey;

const server = createServer(app);
attachSocket(server);
server.listen(config.port, () => {
  console.log(`SECEP API listening on port ${config.port}`);
});
// M2–M5 pipeline events from Redis Streams; the API keeps serving if Redis is down.
startStreams();

// FR-REM-003: every 15 s, fire what is due. A failed pass is retried on the next tick.
setInterval(() => fireDueReminders().catch((err) => console.error('reminder tick failed:', err.code ?? err.name)), 15_000).unref();
