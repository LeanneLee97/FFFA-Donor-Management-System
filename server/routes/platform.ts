import { Router } from 'express';
import type { Db } from '../db.ts';
import { asyncRoute } from '../lib/asyncRoute.ts';
import { requireAdmin } from '../middleware/auth.ts';
import { getDonorProfile, listFollowUps } from '../services/reads.ts';
import { getSettings, updateSettings } from '../services/settings.ts';

/** Settings (admin) and the read-only views the drafting screen needs. Mounted under /api behind requireStaff. */
export function platformRouter(db: Db): Router {
  const router = Router();

  router.get(
    '/settings',
    requireAdmin,
    asyncRoute(async (_req, res) => {
      res.json(await getSettings(db));
    }),
  );

  router.patch(
    '/settings',
    requireAdmin,
    asyncRoute(async (req, res) => {
      res.json(await updateSettings(db, req.staff!, req.body));
    }),
  );

  router.get(
    '/follow-ups',
    asyncRoute(async (req, res) => {
      res.json(await listFollowUps(db, typeof req.query.status === 'string' ? req.query.status : undefined));
    }),
  );

  router.get(
    '/donors/:id',
    asyncRoute(async (req, res) => {
      res.json(await getDonorProfile(db, req.params.id));
    }),
  );

  return router;
}
