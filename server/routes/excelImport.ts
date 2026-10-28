import { Router } from 'express';
import type { Db } from '../db.ts';
import { asyncRoute } from '../lib/asyncRoute.ts';
import { HttpError } from '../lib/errors.ts';
import { requireAdmin } from '../middleware/auth.ts';
import { exportDonorsWorkbook } from '../services/export.ts';
import { commitImport, previewImport, type ImportDecisions, type ImportPayload } from '../services/import.ts';

/**
 * DM6: donor master-data import from an Excel workbook (Donors / Donations / Key dates sheets).
 * The browser reads the .xlsx and sends rows as JSON. Platform CSVs (Giving.sg, GIVE.asia) use
 * /import/preview and /import/commit in insights.ts. Mounted under /api behind requireStaff.
 */
export function excelImportRouter(db: Db): Router {
  const router = Router();

  const read = (body: unknown) => {
    const { rows, decisions } = (body ?? {}) as { rows?: ImportPayload; decisions?: ImportDecisions };
    if (!rows || typeof rows !== 'object') throw new HttpError(400, 'ROWS_REQUIRED', 'Send the sheet rows as { rows: { donors, donations, key_dates } }');
    return { rows, decisions: decisions ?? {} };
  };

  router.post(
    '/import/excel/preview',
    asyncRoute(async (req, res) => {
      const { rows, decisions } = read(req.body);
      res.json(await previewImport(db, rows, decisions));
    }),
  );

  router.post(
    '/import/excel/commit',
    asyncRoute(async (req, res) => {
      const { rows, decisions } = read(req.body);
      res.status(201).json(await commitImport(db, req.staff!, rows, decisions));
    }),
  );

  // Contains personal data, so admins only; every export is written to the activity log.
  router.get(
    '/export/donors.xlsx',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const { buffer } = await exportDonorsWorkbook(db, req.staff!);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="fffa-donors-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.send(buffer);
    }),
  );

  return router;
}
