import { Router } from 'express';
import type { DonorType, Tier } from '../../shared/types.ts';
import type { Db } from '../db.ts';
import { asyncRoute } from '../lib/asyncRoute.ts';
import { requireAdmin } from '../middleware/auth.ts';
import {
  archiveDonor,
  createDonation,
  createDonor,
  createEngagement,
  createKeyDate,
  createNote,
  deleteDonor,
  deleteNote,
  listDonors,
  listKeyDates,
  updateDonor,
  updateKeyDate,
  voidDonation,
} from '../services/donors.ts';

/**
 * DM1, DM3, DM8, DM9: Donor, donation, note, engagement and key dates routes.
 * Mounted under /api behind requireStaff.
 */
export function donorsRouter(db: Db): Router {
  const router = Router();

  router.get(
    '/donors',
    asyncRoute(async (req, res) => {
      const { query, type, tier, lastDonationBefore, owner } = req.query;
      const donors = await listDonors(db, {
        query: typeof query === 'string' ? query : undefined,
        type: typeof type === 'string' ? (type as DonorType) : undefined,
        tier: typeof tier === 'string' ? (tier as Tier) : undefined,
        lastDonationBefore: typeof lastDonationBefore === 'string' ? lastDonationBefore : undefined,
        owner: typeof owner === 'string' ? owner : undefined,
      });
      res.json(donors);
    }),
  );

  router.post(
    '/donors',
    asyncRoute(async (req, res) => {
      const donor = await createDonor(db, req.staff!, req.body);
      res.status(201).json(donor);
    }),
  );

  router.patch(
    '/donors/:id',
    asyncRoute(async (req, res) => {
      const donor = await updateDonor(db, req.params.id, req.staff!, req.body);
      res.json(donor);
    }),
  );

  router.post(
    '/donors/:id/archive',
    asyncRoute(async (req, res) => {
      const archived = await archiveDonor(db, req.params.id, req.staff!);
      res.json({ success: true, archived_at: archived.archived_at });
    }),
  );

  router.delete(
    '/donors/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      await deleteDonor(db, req.params.id, req.staff!);
      res.json({ success: true, deleted: true });
    }),
  );

  router.post(
    '/donors/:id/donations',
    asyncRoute(async (req, res) => {
      const donation = await createDonation(db, req.params.id, req.staff!, req.body);
      res.status(201).json(donation);
    }),
  );

  router.post(
    '/donations/:id/void',
    asyncRoute(async (req, res) => {
      const voided = await voidDonation(db, req.params.id, req.staff!, req.body?.reason);
      res.json(voided);
    }),
  );

  router.post(
    '/donors/:id/notes',
    asyncRoute(async (req, res) => {
      const note = await createNote(db, req.params.id, req.staff!, req.body?.body);
      res.status(201).json(note);
    }),
  );

  router.delete(
    '/notes/:id',
    asyncRoute(async (req, res) => {
      const deleted = await deleteNote(db, req.params.id, req.staff!);
      res.json({ success: true, deleted_at: deleted.deleted_at });
    }),
  );

  router.post(
    '/donors/:id/engagements',
    asyncRoute(async (req, res) => {
      const engagement = await createEngagement(db, req.params.id, req.staff!, req.body);
      res.status(201).json(engagement);
    }),
  );

  router.get(
    '/donors/:id/key-dates',
    asyncRoute(async (req, res) => {
      const keyDates = await listKeyDates(db, req.params.id);
      res.json(keyDates);
    }),
  );

  router.post(
    '/donors/:id/key-dates',
    asyncRoute(async (req, res) => {
      const keyDate = await createKeyDate(db, req.params.id, req.staff!, req.body);
      res.status(201).json(keyDate);
    }),
  );

  router.patch(
    '/key-dates/:id',
    asyncRoute(async (req, res) => {
      const keyDate = await updateKeyDate(db, req.params.id, req.staff!, req.body);
      res.json(keyDate);
    }),
  );

  return router;
}
