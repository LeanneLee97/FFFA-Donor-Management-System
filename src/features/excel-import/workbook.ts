import ExcelJS from 'exceljs';

/**
 * The agreed Excel format for loading donors. One workbook, up to three sheets, header in row 1.
 * Column names are the API field names (server/services/import.ts); capitals and spaces in headers are ignored.
 */

export interface SheetSpec {
  key: 'donors' | 'donations' | 'key_dates';
  name: string;
  required: boolean;
  columns: { name: string; note: string; options?: string[]; example: string }[];
}

export const SHEETS: SheetSpec[] = [
  {
    key: 'donors',
    name: 'Donors',
    required: true,
    columns: [
      { name: 'donor_type', note: 'individual, corporate or grant_funder. Blank = individual', options: ['individual', 'corporate', 'grant_funder'], example: 'corporate' },
      { name: 'organisation_name', note: 'Required for corporate and grant_funder', example: 'Acme Logistics Pte Ltd' },
      { name: 'first_name', note: 'Individual, or the contact person at an organisation', example: 'Ravi' },
      { name: 'last_name', note: '', example: 'Kumar' },
      { name: 'contact_title', note: "Contact person's role (organisations)", example: 'CSR Manager' },
      { name: 'preferred_name', note: 'How messages should address them', example: '' },
      { name: 'email', note: 'Used to match existing donors', example: 'ravi@example.com' },
      { name: 'mobile', note: 'Used to match existing donors. +65 is ignored', example: '+65 9123 4567' },
      { name: 'how_they_know_fffa', note: 'Free text', example: 'Met at a festive food drive' },
      { name: 'programme_interest', note: 'Comma-separated: RTE, Food Redistribution, KidsLuvIt, General', example: 'RTE, KidsLuvIt' },
      { name: 'also_volunteers', note: 'Yes or No', options: ['Yes', 'No'], example: 'No' },
      { name: 'major_override', note: 'Yes to tag as a major donor (personal outreach)', options: ['Yes', 'No'], example: 'No' },
      { name: 'relationship_owner_email', note: 'Staff email of the relationship owner', example: 'staff@fffa.org' },
    ],
  },
  {
    key: 'donations',
    name: 'Donations',
    required: false,
    columns: [
      { name: 'donor_email', note: 'Email OR mobile says which donor this gift belongs to', example: 'ravi@example.com' },
      { name: 'donor_mobile', note: '', example: '' },
      { name: 'donated_on', note: 'DD/MM/YYYY or an Excel date', example: '15/09/2026' },
      { name: 'kind', note: 'cash or in_kind. Blank = cash', options: ['cash', 'in_kind'], example: 'cash' },
      { name: 'amount_sgd', note: 'Cash gifts', example: '2000' },
      { name: 'in_kind_description', note: 'In-kind gifts, e.g. 200 packs of rice', example: '' },
      { name: 'estimated_value_sgd', note: 'In-kind gifts', example: '' },
      { name: 'channel', note: 'give_asia, giving_sg, bank, paynow, in_person, other', options: ['give_asia', 'giving_sg', 'bank', 'paynow', 'in_person', 'other'], example: 'bank' },
      { name: 'external_ref', note: 'Platform transaction id. Stops double-counting on re-import', example: '' },
      { name: 'campaign', note: 'e.g. Steps for Meals', example: 'Steps for Meals' },
      { name: 'is_recurring', note: 'Yes for monthly giving', options: ['Yes', 'No'], example: 'No' },
      { name: 'monthly_amount_sgd', note: 'Recurring gifts (defaults to amount_sgd)', example: '' },
      { name: 'payment_status', note: 'succeeded or failed. Blank = succeeded', options: ['succeeded', 'failed'], example: 'succeeded' },
      { name: 'programme', note: '', example: 'Food Redistribution' },
      { name: 'thanked', note: 'Yes if FFFA has already thanked them', options: ['Yes', 'No'], example: 'Yes' },
    ],
  },
  {
    key: 'key_dates',
    name: 'Key dates',
    required: false,
    columns: [
      { name: 'donor_email', note: 'Email OR mobile says which donor this belongs to', example: 'ravi@example.com' },
      { name: 'donor_mobile', note: '', example: '' },
      { name: 'kind', note: 'sponsorship_expiry, grant_report, grant_renewal, other', options: ['sponsorship_expiry', 'grant_report', 'grant_renewal', 'other'], example: 'sponsorship_expiry' },
      { name: 'due_on', note: 'DD/MM/YYYY or an Excel date', example: '30/11/2026' },
      { name: 'label', note: 'What is due', example: 'Sponsorship renewal' },
    ],
  },
];

const headerKey = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s.]+/g, '_');

/** Turns whatever Excel stores in a cell (dates, formulas, rich text, hyperlinks) into a plain value. */
function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return plain(o.result);
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('text' in o) return plain(o.text);
    return null; // errors and anything else
  }
  return v;
}

export interface ParsedWorkbook {
  rows: { donors: Record<string, unknown>[]; donations: Record<string, unknown>[]; key_dates: Record<string, unknown>[] };
  /** Problems with the file itself (missing sheet, unknown columns), shown before the row-level checks. */
  problems: string[];
  notes: string[];
}

export async function readWorkbook(file: File): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('This does not look like an .xlsx file. Save it as "Excel Workbook (.xlsx)" and try again.');
  }

  const out: ParsedWorkbook = { rows: { donors: [], donations: [], key_dates: [] }, problems: [], notes: [] };
  for (const spec of SHEETS) {
    const ws = wb.worksheets.find((w) => headerKey(w.name) === headerKey(spec.name));
    if (!ws) {
      if (spec.required) out.problems.push(`The "${spec.name}" sheet is missing. Download the template to see the format.`);
      else out.notes.push(`No "${spec.name}" sheet found, skipping.`);
      continue;
    }
    const known = new Set(spec.columns.map((c) => c.name));
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      headers[col] = headerKey(plain(cell.value));
    });
    const unknown = headers.filter((h) => h && !known.has(h));
    if (unknown.length) out.notes.push(`"${spec.name}": ignoring unknown columns ${unknown.join(', ')}.`);
    if (!headers.some((h) => known.has(h))) {
      out.problems.push(`"${spec.name}": row 1 must be the column headers (see the template).`);
      continue;
    }

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const rec: Record<string, unknown> = { _row: rowNumber };
      let any = false;
      headers.forEach((h, col) => {
        if (!h || !known.has(h)) return;
        const v = plain(row.getCell(col).value);
        if (v !== null && String(v).trim() !== '') {
          rec[h] = v;
          any = true;
        }
      });
      if (any) out.rows[spec.key].push(rec);
    });
  }
  return out;
}

/** Builds the downloadable template: the three sheets plus an Instructions sheet. */
export async function downloadTemplate() {
  const wb = new ExcelJS.Workbook();
  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 28 }, { width: 70 }, { width: 28 }];
  help.addRow(['FFFA donor import: how to fill this in']).font = { bold: true, size: 14 };
  help.addRow(['Keep the sheet names and row 1 headers. One row per donor / gift / key date. Dummy data only until FFFA says otherwise. Do not add NRIC, FIN or UEN.']);
  help.addRow([]);
  for (const spec of SHEETS) {
    help.addRow([`${spec.name} sheet${spec.required ? ' (required)' : ' (optional)'}`, 'What to enter', 'Example']).font = { bold: true };
    for (const c of spec.columns) help.addRow([c.name, c.note, c.example]);
    help.addRow([]);
  }
  help.addRow(['Matching', 'Donors are matched to existing ones by email, then mobile. Same name only = you decide on screen. Gifts with the same channel + external_ref are never imported twice.']);

  for (const spec of SHEETS) {
    const ws = wb.addWorksheet(spec.name);
    ws.columns = spec.columns.map((c) => ({ header: c.name, key: c.name, width: Math.max(16, c.name.length + 4) }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    spec.columns.forEach((c, i) => {
      if (!c.options) return;
      for (let r = 2; r <= 500; r++) {
        ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${c.options.join(',')}"`] };
      }
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fffa-donor-import-template.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
