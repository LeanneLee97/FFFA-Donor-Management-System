import type { Db } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import type { Staff } from '../../shared/types.ts';
import { logActivity } from './activity.ts';
import { runRulesEngine } from './rules/engine.ts';

/**
 * DM6: CSV import from Giving.sg and GIVE.asia (design section 6, "Import matching").
 * Donations de-duplicate on (channel, external_ref); donors match on email, then mobile.
 * Name-only matches are never merged automatically: they come back as "review" and are skipped.
 */

export type ImportPlatform = 'giving_sg' | 'give_asia';
export type RowStatus = 'new_donor' | 'matched' | 'duplicate' | 'review' | 'error';

export interface ImportRow {
  row: number;
  status: RowStatus;
  name: string;
  amount_sgd: number | null;
  donated_on: string | null;
  external_ref: string | null;
  matched_on?: 'email' | 'mobile' | 'earlier_row';
  donor_id?: string;
  message?: string;
}

export interface ImportResult {
  platform: ImportPlatform;
  rows: ImportRow[];
  counts: Record<RowStatus, number>;
}

// Header aliases per field, lower-cased. Covers the column names in each platform's export;
// adjust here if FFFA's real files differ.
const FIELDS = {
  ref: ['donation id', 'transaction id', 'reference', 'ref', 'id'],
  date: ['donation date', 'date', 'transaction date', 'created at'],
  name: ['donor name', 'full name', 'name'],
  first: ['first name'],
  last: ['last name'],
  email: ['donor email', 'email', 'email address'],
  mobile: ['donor phone', 'mobile', 'phone', 'contact number'],
  amount: ['amount (sgd)', 'amount', 'donation amount'],
  campaign: ['campaign', 'campaign name', 'fundraiser'],
  recurring: ['donation type', 'recurring', 'frequency', 'type'],
  status: ['status', 'payment status'],
} as const;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const normEmail = (v?: string) => v?.trim().toLowerCase() || null;

/** Digits only, Singapore +65 prefix removed: '+65 9123 4567' → '91234567'. */
export function normMobile(v?: string): string | null {
  const digits = (v ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 && digits.startsWith('65') ? digits.slice(2) : digits;
}

const normName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

/** Accepts 2026-10-01, 01/10/2026 (day first, as in Singapore exports) and 2026-10-01T…. */
function parseDate(v?: string): string | null {
  const s = v?.trim() ?? '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

interface Parsed {
  row: number;
  ref: string | null;
  date: string | null;
  first: string | null;
  last: string | null;
  name: string;
  email: string | null;
  mobile: string | null;
  mobileRaw: string | null;
  amount: number | null;
  campaign: string | null;
  recurring: boolean;
  failed: boolean;
}

function parseRows(csv: string): Parsed[] {
  const [header, ...body] = parseCsv(csv);
  if (!header) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  const cols = header.map((h) => h.trim().toLowerCase());
  const idx = (aliases: readonly string[]) => cols.findIndex((c) => aliases.includes(c));
  const at = Object.fromEntries(Object.entries(FIELDS).map(([k, a]) => [k, idx(a)])) as Record<keyof typeof FIELDS, number>;
  const missing = (['ref', 'date', 'amount'] as const).filter((k) => at[k] < 0);
  if (at.name < 0 && at.first < 0) missing.push('name' as never);
  if (missing.length) {
    throw new HttpError(400, 'MISSING_COLUMNS', `Missing columns: ${missing.join(', ')}`);
  }

  return body.map((cells, i) => {
    const get = (k: keyof typeof FIELDS) => (at[k] >= 0 ? cells[at[k]]?.trim() || null : null);
    const first = get('first') ?? get('name')?.split(/\s+/)[0] ?? null;
    const last = get('last') ?? (get('name')?.split(/\s+/).slice(1).join(' ') || null);
    const amount = Number((get('amount') ?? '').replace(/[^0-9.]/g, ''));
    const recurringRaw = (get('recurring') ?? '').toLowerCase();
    return {
      row: i + 2, // spreadsheet row number (header is row 1)
      ref: get('ref'),
      date: parseDate(get('date') ?? undefined),
      first,
      last,
      name: [first, last].filter(Boolean).join(' '),
      email: normEmail(get('email') ?? undefined),
      mobile: normMobile(get('mobile') ?? undefined),
      mobileRaw: get('mobile'),
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      campaign: get('campaign'),
      recurring: ['monthly', 'yes', 'true', 'recurring', 'y'].includes(recurringRaw),
      failed: /fail|declin/i.test(get('status') ?? ''),
    };
  });
}

interface DonorKey { id: string; email: string | null; mobile: string | null; name: string }

/** Works out what each row would do. Used by preview (read-only) and commit (inside the transaction). */
async function analyse(db: Db, platform: ImportPlatform, csv: string): Promise<{ parsed: Parsed[]; result: ImportResult }> {
  if (platform !== 'giving_sg' && platform !== 'give_asia') {
    throw new HttpError(400, 'INVALID_PLATFORM', 'Platform must be giving_sg or give_asia');
  }
  const parsed = parseRows(csv);

  const donors = (
    await db.query<{ id: string; email: string | null; mobile: string | null; name: string }>(
      `select id, email, mobile, concat_ws(' ', first_name, last_name) as name from donors where archived_at is null`,
    )
  ).map<DonorKey>((d) => ({ id: d.id, email: normEmail(d.email ?? undefined), mobile: normMobile(d.mobile ?? undefined), name: normName(d.name) }));
  const refs = parsed.map((p) => p.ref).filter((r): r is string => !!r);
  const existingRefs = new Set(
    (
      await db.query<{ external_ref: string }>(
        `select external_ref from donations where channel = $1 and external_ref = any($2::text[])`,
        [platform, refs],
      )
    ).map((r) => r.external_ref),
  );

  const seenRefs = new Set<string>();
  const newInFile = new Map<string, number>(); // email/mobile → first row creating that donor
  const rows: ImportRow[] = parsed.map((p) => {
    const base = { row: p.row, name: p.name, amount_sgd: p.amount, donated_on: p.date, external_ref: p.ref };
    if (!p.ref || !p.date || !p.amount || !p.name) {
      const what = !p.ref ? 'reference' : !p.date ? 'a valid date' : !p.amount ? 'a valid amount' : 'a name';
      return { ...base, status: 'error', message: `Row is missing ${what}` };
    }
    if (existingRefs.has(p.ref) || seenRefs.has(p.ref)) {
      return { ...base, status: 'duplicate', message: 'Already imported' };
    }
    seenRefs.add(p.ref);

    const byEmail = p.email ? donors.filter((d) => d.email === p.email) : [];
    const byMobile = !byEmail.length && p.mobile ? donors.filter((d) => d.mobile === p.mobile) : [];
    const hits = byEmail.length ? byEmail : byMobile;
    if (hits.length === 1) {
      return { ...base, status: 'matched', matched_on: byEmail.length ? 'email' : 'mobile', donor_id: hits[0].id };
    }
    if (hits.length > 1) {
      return { ...base, status: 'review', message: 'Matches more than one donor' };
    }
    const earlier = (p.email && newInFile.get(`e:${p.email}`)) || (p.mobile && newInFile.get(`m:${p.mobile}`));
    if (earlier) return { ...base, status: 'matched', matched_on: 'earlier_row', message: `Same donor as row ${earlier}` };
    if (donors.some((d) => d.name === normName(p.name))) {
      return { ...base, status: 'review', message: 'Same name as an existing donor, but email and mobile differ' };
    }
    if (p.email) newInFile.set(`e:${p.email}`, p.row);
    if (p.mobile) newInFile.set(`m:${p.mobile}`, p.row);
    return { ...base, status: 'new_donor' };
  });

  const counts: Record<RowStatus, number> = { new_donor: 0, matched: 0, duplicate: 0, review: 0, error: 0 };
  for (const r of rows) counts[r.status]++;
  return { parsed, result: { platform, rows, counts } };
}

export async function previewImport(db: Db, platform: ImportPlatform, csv: string): Promise<ImportResult> {
  return (await analyse(db, platform, csv)).result;
}

/** Imports new and matched rows in one transaction; duplicates, review and error rows are skipped. */
export async function commitImport(
  db: Db,
  staff: Staff,
  platform: ImportPlatform,
  csv: string,
): Promise<ImportResult & { donations_added: number; donors_added: number; follow_ups_created: number }> {
  const out = await db.transaction(async (tx) => {
    const { parsed, result } = await analyse(tx, platform, csv);
    const byRow = new Map(parsed.map((p) => [p.row, p]));
    const created = new Map<string, string>(); // email/mobile key → new donor id
    let donationsAdded = 0;
    let donorsAdded = 0;

    for (const r of result.rows) {
      if (r.status !== 'new_donor' && r.status !== 'matched') continue;
      const p = byRow.get(r.row)!;
      let donorId = r.donor_id;
      if (!donorId) {
        donorId = (p.email && created.get(`e:${p.email}`)) || (p.mobile && created.get(`m:${p.mobile}`)) || undefined;
      }
      if (!donorId) {
        const [d] = await tx.query<{ id: string }>(
          `insert into donors (first_name, last_name, email, mobile, how_they_know_fffa)
           values ($1, $2, $3, $4, $5) returning id`,
          [p.first, p.last, p.email, p.mobileRaw, platform === 'giving_sg' ? 'Giving.sg' : 'GIVE.asia'],
        );
        donorId = d.id;
        donorsAdded++;
        if (p.email) created.set(`e:${p.email}`, donorId);
        if (p.mobile) created.set(`m:${p.mobile}`, donorId);
      }
      r.donor_id = donorId;
      await tx.query(
        `insert into donations (donor_id, donated_on, amount_sgd, channel, external_ref, campaign,
                                is_recurring, monthly_amount_sgd, payment_status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [donorId, p.date, p.amount, platform, p.ref, p.campaign, p.recurring, p.recurring ? p.amount : null, p.failed ? 'failed' : 'succeeded'],
      );
      donationsAdded++;
    }

    await logActivity(tx, {
      actor: staff.id,
      action: 'import.run',
      entityType: 'import',
      entityId: null,
      diff: { platform, ...result.counts, donations_added: donationsAdded, donors_added: donorsAdded },
    });
    return { ...result, donations_added: donationsAdded, donors_added: donorsAdded };
  });

  // New gifts can raise thank-you, failed-payment and upgrade follow-ups straight away.
  const { created } = await runRulesEngine(db);
  return { ...out, follow_ups_created: created };
}
