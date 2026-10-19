import { Router } from 'express';
import type { Db } from '../db.ts';
import { asyncRoute } from '../lib/asyncRoute.ts';
import type { AiClient } from '../services/ai/client.ts';
import { approveDraft, createDraft, discardDraft } from '../services/ai/drafting.ts';

/** DM10 routes (design section 6). Mounted under /api behind requireStaff. */
export function draftsRouter(db: Db, ai: AiClient | null): Router {
  const router = Router();

  router.post(
    '/follow-ups/:id/draft',
    asyncRoute(async (req, res) => {
      res.status(201).json(await createDraft(db, ai, req.params.id, req.staff!));
    }),
  );

  router.post(
    '/drafts/:id/approve',
    asyncRoute(async (req, res) => {
      const { subject, body } = req.body ?? {};
      res.json(await approveDraft(db, req.params.id, req.staff!, { subject, body }));
    }),
  );

  router.post(
    '/drafts/:id/discard',
    asyncRoute(async (req, res) => {
      res.json(await discardDraft(db, req.params.id, req.staff!));
    }),
  );

  return router;
}
