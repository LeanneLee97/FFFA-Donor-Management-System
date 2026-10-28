import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { SHEETS } from '../../src/features/excel-import/workbook.ts';

/**
 * Builds the two demo workbooks in docs/samples (run: npm run demo:files).
 * All people and organisations are fictional; emails use example.org, mobiles are made up.
 * Dates are relative to the day you run this, so re-run it on demo day to keep the follow-ups fresh.
 *
 *  1. fffa-demo-donors.xlsx  the main load: 12 donors that trigger every follow-up rule
 *  2. fffa-demo-update.xlsx  a second file that shows matching, duplicates and error handling
 */

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/samples');

const now = new Date();
const midnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const ago = (days: number) => new Date(midnight - days * 86_400_000);
const ahead = (days: number) => new Date(midnight + days * 86_400_000);
/** Same calendar day `years` ago, plus `extra` days (so an anniversary lands `extra` days from now). */
const yearsAgo = (years: number, extra = 0) => new Date(Date.UTC(now.getFullYear() - years, now.getMonth(), now.getDate() + extra));

type Rec = Record<string, unknown>;
interface Book {
  donors: Rec[];
  donations: Rec[];
  key_dates: Rec[];
}

const mei = 'meiling.tan@example.org';
const monthly = (email: string, amount: number, months: number, channel: string, extra: Rec = {}): Rec[] =>
  Array.from({ length: months }, (_, i) => ({
    donor_email: email, donated_on: ago(30 * i + 5), kind: 'cash', amount_sgd: amount, channel,
    is_recurring: 'Yes', monthly_amount_sgd: amount, payment_status: 'succeeded', thanked: 'Yes', ...extra,
  }));

const main: Book = {
  donors: [
    { donor_type: 'individual', first_name: 'Mei Ling', last_name: 'Tan', email: mei, mobile: '+65 8100 0001', programme_interest: 'RTE', how_they_know_fffa: 'Volunteered at a festive food drive', also_volunteers: 'Yes' }, // upgrade ask
    { donor_type: 'corporate', organisation_name: 'Acme Logistics Pte Ltd', first_name: 'Ravi', last_name: 'Kumar', contact_title: 'CSR Manager', email: 'ravi.kumar@example.org', mobile: '+65 8100 0002', programme_interest: 'Food Redistribution' }, // key date
    { donor_type: 'grant_funder', organisation_name: 'Harbour Hope Foundation', first_name: 'Sarah', last_name: 'Lim', contact_title: 'Programme Officer', email: 'sarah.lim@example.org', mobile: '+65 8100 0003', programme_interest: 'KidsLuvIt' }, // grant report due
    { donor_type: 'individual', first_name: 'Daniel', last_name: 'Wong', email: 'daniel.wong@example.org', mobile: '+65 8100 0004', programme_interest: 'General' }, // lapsed
    { donor_type: 'individual', first_name: 'Priya', last_name: 'Nair', email: 'priya.nair@example.org', mobile: '+65 8100 0005', programme_interest: 'KidsLuvIt' }, // failed payment
    { donor_type: 'individual', first_name: 'Ahmad', last_name: 'Rahman', email: 'ahmad.rahman@example.org', mobile: '+65 8100 0006', programme_interest: 'RTE', how_they_know_fffa: 'Read about FFFA in the news' }, // thank-you due
    { donor_type: 'individual', first_name: 'Grace', last_name: 'Lee', email: 'grace.lee@example.org', mobile: '+65 8100 0007', programme_interest: 'Food Redistribution' }, // in-kind thank-you
    { donor_type: 'individual', first_name: 'Boon Huat', last_name: 'Tan', email: 'boonhuat.tan@example.org', mobile: '+65 8100 0008', programme_interest: 'RTE, KidsLuvIt' }, // major: S$5,000+ in 12 months
    { donor_type: 'individual', first_name: 'Siti', last_name: 'Aminah', email: 'siti.aminah@example.org', mobile: '+65 8100 0009', programme_interest: 'KidsLuvIt' }, // anniversary
    { donor_type: 'individual', first_name: 'Wei', last_name: 'Lim', preferred_name: 'Dr Lim', email: 'wei.lim@example.org', mobile: '+65 8100 0010', programme_interest: 'General' }, // major: 3+ years
    { donor_type: 'individual', first_name: 'Jasmine', last_name: 'Ong', email: 'jasmine.ong@example.org', mobile: '+65 8100 0011', major_override: 'Yes', how_they_know_fffa: 'Introduced by the board' }, // major: tagged by staff
    { donor_type: 'corporate', organisation_name: 'Sunrise Bakery', first_name: 'Michelle', last_name: 'Goh', contact_title: 'Owner', email: 'michelle.goh@example.org', mobile: '+65 8100 0012', programme_interest: 'Food Redistribution' }, // in-kind from a business
  ],
  donations: [
    ...monthly(mei, 30, 14, 'giving_sg', { programme: 'RTE' }),
    { donor_email: 'ravi.kumar@example.org', donated_on: ago(200), amount_sgd: 2000, channel: 'bank', campaign: 'Steps for Meals', programme: 'Food Redistribution', thanked: 'Yes' },
    { donor_email: 'sarah.lim@example.org', donated_on: ago(150), amount_sgd: 4000, channel: 'bank', programme: 'KidsLuvIt', thanked: 'Yes' },
    { donor_email: 'daniel.wong@example.org', donated_on: ago(220), amount_sgd: 50, channel: 'give_asia', external_ref: 'GA-100201', campaign: 'Steps for Meals', thanked: 'Yes' },
    { donor_email: 'priya.nair@example.org', donated_on: ago(2), amount_sgd: 20, channel: 'give_asia', is_recurring: 'Yes', monthly_amount_sgd: 20, payment_status: 'failed', external_ref: 'GA-100305' },
    { donor_email: 'priya.nair@example.org', donated_on: ago(32), amount_sgd: 20, channel: 'give_asia', is_recurring: 'Yes', monthly_amount_sgd: 20, external_ref: 'GA-100304', thanked: 'Yes' },
    { donor_email: 'priya.nair@example.org', donated_on: ago(62), amount_sgd: 20, channel: 'give_asia', is_recurring: 'Yes', monthly_amount_sgd: 20, external_ref: 'GA-100303', thanked: 'Yes' },
    { donor_email: 'ahmad.rahman@example.org', donated_on: ago(4), amount_sgd: 100, channel: 'paynow', programme: 'RTE', thanked: 'No' },
    { donor_email: 'grace.lee@example.org', donated_on: ago(4), kind: 'in_kind', in_kind_description: '200 packs of rice', estimated_value_sgd: 800, channel: 'in_person', thanked: 'No' },
    { donor_email: 'boonhuat.tan@example.org', donated_on: ago(40), amount_sgd: 5000, channel: 'bank', thanked: 'Yes' },
    { donor_email: 'boonhuat.tan@example.org', donated_on: ago(100), amount_sgd: 3000, channel: 'bank', thanked: 'Yes' },
    { donor_email: 'siti.aminah@example.org', donated_on: yearsAgo(2, 5), amount_sgd: 15, channel: 'giving_sg', external_ref: 'GS-77001', thanked: 'Yes' },
    { donor_email: 'siti.aminah@example.org', donated_on: ago(25), amount_sgd: 15, channel: 'giving_sg', external_ref: 'GS-77002', thanked: 'Yes' },
    { donor_email: 'wei.lim@example.org', donated_on: ago(1500), amount_sgd: 200, channel: 'bank', thanked: 'Yes' },
    { donor_email: 'wei.lim@example.org', donated_on: ago(30), amount_sgd: 200, channel: 'bank', thanked: 'Yes' },
    { donor_email: 'jasmine.ong@example.org', donated_on: ago(20), amount_sgd: 300, channel: 'paynow', thanked: 'Yes' },
    { donor_email: 'michelle.goh@example.org', donated_on: ago(10), kind: 'in_kind', in_kind_description: '60 loaves of bread (weekly surplus)', estimated_value_sgd: 180, channel: 'in_person', thanked: 'No' },
  ],
  key_dates: [
    { donor_email: 'ravi.kumar@example.org', kind: 'sponsorship_expiry', due_on: ahead(21), label: 'Food Redistribution sponsorship renewal' },
    { donor_email: 'sarah.lim@example.org', kind: 'grant_report', due_on: ahead(14), label: 'KidsLuvIt Q4 grant report' },
    { donor_email: 'sarah.lim@example.org', kind: 'grant_renewal', due_on: ahead(75), label: 'Grant renewal decision' },
  ],
};

/** Run after the main load: one existing donor, one lookalike, one repeat gift, one bad row, one new donor. */
const update: Book = {
  donors: [
    { donor_type: 'individual', first_name: 'Mei Ling', last_name: 'Tan', email: mei, mobile: '+65 8100 0001' }, // same email: matched automatically
    { donor_type: 'individual', first_name: 'Ahmad', last_name: 'Rahman', email: 'a.rahman@example.net', mobile: '+65 8100 9999' }, // name only: you decide
    { donor_type: 'individual', first_name: 'Nurul', last_name: 'Huda', email: 'nurul.huda@example.org', mobile: '+65 8100 0013', programme_interest: 'RTE' }, // brand new
    { donor_type: 'corporate', first_name: 'No', last_name: 'Organisation', email: 'broken@example.org' }, // error: organisation name missing
  ],
  donations: [
    { donor_email: 'priya.nair@example.org', donated_on: ago(32), amount_sgd: 20, channel: 'give_asia', external_ref: 'GA-100304' }, // already imported
    { donor_email: 'nurul.huda@example.org', donated_on: ago(1), amount_sgd: 80, channel: 'giving_sg', external_ref: 'GS-88001', campaign: 'Steps for Meals' }, // new
    { donor_email: 'daniel.wong@example.org', donated_on: '31/02/2026', amount_sgd: 50, channel: 'give_asia' }, // error: impossible date
    { donor_email: 'nobody@example.org', donated_on: ago(3), amount_sgd: 25, channel: 'paynow' }, // error: no such donor
  ],
  key_dates: [],
};

async function write(file: string, book: Book) {
  const wb = new ExcelJS.Workbook();
  for (const spec of SHEETS) {
    const ws = wb.addWorksheet(spec.name);
    ws.columns = spec.columns.map((c) => ({ header: c.name, key: c.name, width: Math.max(16, c.name.length + 4) }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const rec of book[spec.key]) ws.addRow(spec.columns.map((c) => rec[c.name] ?? null));
    spec.columns.forEach((c, i) => {
      if (c.name === 'donated_on' || c.name === 'due_on') ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy';
    });
  }
  await wb.xlsx.writeFile(path.join(OUT, file));
  console.log(`Wrote docs/samples/${file}`);
}

await mkdir(OUT, { recursive: true });
await write('fffa-demo-donors.xlsx', main);
await write('fffa-demo-update.xlsx', update);
