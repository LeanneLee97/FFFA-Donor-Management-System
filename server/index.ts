import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createApp } from './app.ts';
import { createDb, migrate } from './db.ts';
import { devStaffResolver, supabaseStaffResolver } from './middleware/auth.ts';
import { DEFAULT_GEMINI_MODEL, createGeminiClient } from './services/ai/client.ts';

dotenv.config();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.NODE_ENV === 'production';

async function main() {
  const authMode = process.env.AUTH_MODE ?? (isProd ? 'supabase' : 'dev');
  if (isProd && authMode === 'dev') throw new Error('AUTH_MODE=dev is not allowed in production');

  const db = await createDb({
    databaseUrl: process.env.DATABASE_URL,
    dataDir: process.env.PGLITE_DIR ?? path.join(ROOT, '.data/pglite'),
  });
  const ran = await migrate(db);
  if (ran.length) console.log(`Applied migrations: ${ran.join(', ')}`);

  const key = process.env.GEMINI_API_KEY;
  const ai = key ? createGeminiClient(key, process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL) : null;
  if (!ai) console.log('No GEMINI_API_KEY set: drafts will use templates only.');

  const app = createApp({
    db,
    ai,
    resolveStaff: authMode === 'dev' ? devStaffResolver(db) : supabaseStaffResolver(db),
  });

  if (isProd) {
    app.use(express.static(path.join(ROOT, 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'dist', 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () =>
    console.log(`FFFA Donor Management running on http://localhost:${port} (auth: ${authMode})`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
