import { Router } from 'express';
import type { Db } from '../db.ts';
import { asyncRoute } from '../lib/asyncRoute.ts';
import {
  completeFollowUp,
  dismissFollowUp,
  refreshQueue,
  snoozeFollowUp,
} from '../services/queue.ts';

/**
 * DM4 & DM9: Follow-up queue write and state transition routes.
 * Mounted under /api behind requireStaff.
 */
export function followupsRouter(db: Db): Router {
  const router = Router();

  router.post(
    '/follow-ups/refresh',
    asyncRoute(async (req, res) => {
      const result = await refreshQueue(db, req.staff!, req.body?.today);
      res.json(result);
    }),
  );

  router.post(
    '/follow-ups/:id/complete',
    asyncRoute(async (req, res) => {
      const result = await completeFollowUp(db, req.params.id, req.staff!, req.body);
      res.json(result);
    }),
  );

  router.post(
    '/follow-ups/:id/snooze',
    asyncRoute(async (req, res) => {
      const result = await snoozeFollowUp(db, req.params.id, req.staff!, req.body);
      res.json(result);
    }),
  );

  router.post(
    '/follow-ups/:id/dismiss',
    asyncRoute(async (req, res) => {
      const result = await dismissFollowUp(db, req.params.id, req.staff!, req.body);
      res.json(result);
    }),
  );

  return router;
}
