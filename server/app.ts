import express, { type ErrorRequestHandler } from 'express';
import type { Db } from './db.ts';
import { requireStaff, type StaffResolver } from './middleware/auth.ts';
import { draftsRouter } from './routes/drafts.ts';
import { platformRouter } from './routes/platform.ts';
import { donorsRouter } from './routes/donors.ts';
import type { AiClient } from './services/ai/client.ts';
import { HttpError } from './lib/errors.ts';

export interface AppDeps {
  db: Db;
  ai: AiClient | null;
  resolveStaff: StaffResolver;
}

/** Builds the API without starting a server, so tests can call it directly. */
export function createApp({ db, ai, resolveStaff }: AppDeps) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ai: ai ? ai.model : 'templates only' }));

  const api = express.Router();
  api.use(requireStaff(resolveStaff));
  api.get('/me', (req, res) => res.json(req.staff));
  api.use(draftsRouter(db, ai));
  api.use(platformRouter(db));
  api.use(donorsRouter(db));
  // Slices plug in here as they land: follow-up rules engine & queue writes (Swaraj), import + dashboard (Lynn).
  app.use('/api', api);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));
  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  // Postgres: invalid uuid text in a route param.
  if (err?.code === '22P02') return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL' });
};
