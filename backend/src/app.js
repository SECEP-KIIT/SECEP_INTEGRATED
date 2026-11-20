import cookieParser from 'cookie-parser';
import express from 'express';
import { actions } from './api/actions.js';
import { admin } from './api/admin.js';
import { auth } from './api/auth.js';
import { emails } from './api/emails.js';
import { layouts } from './api/layouts.js';
import { me } from './api/me.js';
import { reminders } from './api/reminders.js';
import { files } from './api/files.js';
import { notes } from './api/notes.js';
import { projects } from './api/projects.js';
import { secrets } from './api/secrets.js';
import { errorBody, errorHandler } from './http.js';
import routes from './routes/index.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // Caddy terminates TLS in front of the API (NFR-SEC-002)

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
// API responses are data for this app only: never cached by proxies, never sniffed as something else.
app.use('/api', (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  next();
});
app.use(routes);
app.use('/api/v1', auth, me, emails, actions, admin, layouts, projects, notes, files, reminders, secrets);

// Deny by default: any other /api/v1 path is a 404 in the §6.4.1 envelope.
app.use('/api', (req, res) => res.status(404).json(errorBody('not_found', 'No such route')));
app.use((req, res) => res.status(404).json(errorBody('not_found', 'Not found')));
app.use(errorHandler);

export default app;
