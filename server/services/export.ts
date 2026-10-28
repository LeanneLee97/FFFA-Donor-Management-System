import ExcelJS from 'exceljs';
import type { Staff } from '../../shared/types.ts';
import type { Db } from '../db.ts';
import { logActivity } from './activity.ts';

/**
 * Exports the current donors, donations and key dates as an Excel workbook in the same format the
 * importer reads, so an export can be edited and re-imported. A read-only Summary sheet adds the
 * computed fields (tier, major, 12-month giving). Contains personal data: admin-only and logged.
 */

const yn = (b: unknown) => (b ? 'Yes' : 'No');

function sheet(wb: ExcelJS.Workbook, name: string, headers: string[], rows: unknown[][]) {
  const ws = wb.addWorksheet(name);
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(16, h.length + 4) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  rows.forEach((r) => ws.addRow(r));
}

export async function exportDonorsWorkbook(db: Db, staff: Staff): Promise<{ buffer: Buffer; counts: Record<string, number> }> {
  const [donors, donations, keyDates, summary] = await Promise.all([
    db.query<Record<string, any>>(
      `select d.*, s.email as owner_email from donors d left join staff s on s.id = d.relationship_owner
       where d.archived_at is null order by coalesce(d.organisation_name, d.last_name, d.first_name)`,
    ),
    db.query<Record<string, any>>(
      `select x.*, d.email as donor_email, d.mobile as donor_mobile from donations x
       join donors d on d.id = x.donor_id
       where d.archived_at is null and x.voided_at is null order by x.donated_on`,
    ),
    db.query<Record<string, any>>(
      `select k.*, d.email as donor_email, d.mobile as donor_mobile from key_dates k
       join donors d on d.id = k.donor_id where d.archived_at is null order by k.due_on`,
    ),
    db.query<Record<string, any>>(
      `select d.organisation_name, d.first_name, d.last_name, d.email, s.* from donor_summary s
       join donors d on d.id = s.donor_id order by s.giving_12m_sgd desc`,
    ),
  ]);

  const wb = new ExcelJS.Workbook();
  sheet(
    wb,
    'Donors',
    ['donor_type', 'organisation_name', 'first_name', 'last_name', 'contact_title', 'preferred_name', 'email', 'mobile',
     'how_they_know_fffa', 'programme_interest', 'also_volunteers', 'major_override', 'relationship_owner_email'],
    donors.map((d) => [d.donor_type, d.organisation_name, d.first_name, d.last_name, d.contact_title, d.preferred_name, d.email,
      d.mobile, d.how_they_know_fffa, (d.programme_interest ?? []).join(', '), yn(d.also_volunteers), yn(d.major_override), d.owner_email]),
  );
  sheet(
    wb,
    'Donations',
    ['donor_email', 'donor_mobile', 'donated_on', 'kind', 'amount_sgd', 'in_kind_description', 'estimated_value_sgd', 'channel',
     'external_ref', 'campaign', 'is_recurring', 'monthly_amount_sgd', 'payment_status', 'programme', 'thanked'],
    donations.map((x) => [x.donor_email, x.donor_mobile, x.donated_on, x.kind, x.amount_sgd, x.in_kind_description, x.estimated_value_sgd,
      x.channel, x.external_ref, x.campaign, yn(x.is_recurring), x.monthly_amount_sgd, x.payment_status, x.programme, yn(x.thanked)]),
  );
  sheet(
    wb,
    'Key dates',
    ['donor_email', 'donor_mobile', 'kind', 'due_on', 'label'],
    keyDates.map((k) => [k.donor_email, k.donor_mobile, k.kind, k.due_on, k.label]),
  );
  sheet(
    wb,
    'Summary (read-only)',
    ['donor', 'email', 'tier', 'is_major', 'giving_12m_sgd', 'last_donation_on', 'last_engaged_on', 'years_with_fffa'],
    summary.map((s) => [s.organisation_name ?? [s.first_name, s.last_name].filter(Boolean).join(' '), s.email, s.tier, yn(s.is_major),
      s.giving_12m_sgd, s.last_donation_on, s.last_engaged_on, s.years_with_fffa]),
  );

  const counts = { donors: donors.length, donations: donations.length, key_dates: keyDates.length };
  await logActivity(db, { actor: staff.id, action: 'export.donors', entityType: 'export', entityId: null, diff: counts });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), counts };
}
