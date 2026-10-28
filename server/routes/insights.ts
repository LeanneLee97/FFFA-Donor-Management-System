import { Router } from 'express';
import type { Db } from '../db.ts';
import { asyncRoute } from '../lib/asyncRoute.ts';
import { HttpError } from '../lib/errors.ts';
import { requireAdmin } from '../middleware/auth.ts';
import { getDashboard, listActivity } from '../services/dashboard.ts';
import { commitImport, previewImport } from '../services/importer.ts';

/** Lynn's slice: dashboard (DM5), CSV import (DM6), activity log (DM7). Mounted under /api behind requireStaff. */
export function insightsRouter(db: Db): Router {
  const router = Router();

  router.get(
    '/dashboard',
    asyncRoute(async (_req, res) => {
      res.json(await getDashboard(db));
    }),
  );

  router.get(
    '/activity',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const entity = typeof req.query.entity === 'string' ? req.query.entity : undefined;
      res.json(await listActivity(db, entity, Number(req.query.limit) || 50));
    }),
  );

  const csvBody = (body: unknown) => {
    const { platform, csv } = (body ?? {}) as { platform?: string; csv?: string };
    if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'CSV_REQUIRED', 'Send the file contents as csv');
    return { platform: platform as 'giving_sg' | 'give_asia', csv };
  };

  router.post(
    '/import/preview',
    asyncRoute(async (req, res) => {
      const { platform, csv } = csvBody(req.body);
      res.json(await previewImport(db, platform, csv));
    }),
  );

  router.post(
    '/import/commit',
    asyncRoute(async (req, res) => {
      const { platform, csv } = csvBody(req.body);
      res.json(await commitImport(db, req.staff!, platform, csv));
    }),
  );

  return router;
}
