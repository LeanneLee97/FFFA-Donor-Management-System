import type {
  DonationChannel,
  DonationKind,
  DonorType,
  KeyDateKind,
  PaymentStatus,
  Staff,
  Uuid,
} from '../../shared/types.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import { logActivity } from './activity.ts';

/**
 * DM6: Excel import. The browser reads the .xlsx and sends plain rows; this service validates them,
 * matches donors against the database (design v1.3 section 6) and, on commit, writes everything in one
 * transaction. Preview and commit run the same plan, so what staff approve is what gets written.
 */

export type ImportRow = Record<string, unknown> & { _row: number };

export interface ImportPayload {
  donors?: ImportRow[];
  donations?: ImportRow[];
  key_dates?: ImportRow[];
}

/** Staff answer for a donor row that needs a decision: 'new', or the id of the existing donor it is. */
export type ImportDecisions = Record<string, 'new' | Uuid>;

export interface Candidate {
  id: Uuid;
  name: string;
  email: string | null;
  mobile: string | null;
  reason: string;
}

export interface DonorPlan {
  row: number;
  name: string;
  status: 'new' | 'match' | 'review' | 'duplicate_in_file' | 'invalid';
  errors: string[];
  warnings: string[];
  match?: Candidate;
  candidates?: Candidate[];
}

export interface ChildPlan {
  row: number;
  label: string;
  status: 'new' | 'duplicate' | 'orphan' | 'invalid';
  errors: string[];
}

export interface ImportPlan {
  donors: DonorPlan[];
  donations: ChildPlan[];
  key_dates: ChildPlan[];
  summary: {
    donors_new: number;
    donors_matched: number;
    donors_needing_review: number;
    donations_new: number;
    key_dates_new: number;
    rows_with_errors: number;
    rows_skipped: number;
  };
}

const MAX_DONORS = 2000;
const MAX_CHILD_ROWS = 10000;

const DONOR_TYPES: DonorType[] = ['individual', 'corporate', 'grant_funder'];
const CHANNELS: DonationChannel[] = ['give_asia', 'giving_sg', 'bank', 'paynow', 'in_person', 'other'];
const KINDS: DonationKind[] = ['cash', 'in_kind'];
const PAYMENT_STATUSES: PaymentStatus[] = ['succeeded', 'failed'];
const KEY_DATE_KINDS: KeyDateKind[] = ['sponsorship_expiry', 'grant_report', 'grant_renewal', 'other'];

// ---- cell helpers ----------------------------------------------------------------------------

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** 'Grant funder' -> 'grant_funder', 'Giving.sg' -> 'giving_sg'. */
const slug = (v: unknown): string | null => {
  const s = text(v);
  return s ? s.toLowerCase().replace(/[\s.\-/]+/g, '_').replace(/^_+|_+$/g, '') : null;
};

function bool(v: unknown, errors: string[], field: string): boolean {
  const s = text(v)?.toLowerCase();
  if (!s) return false;
  if (['y', 'yes', 'true', '1'].includes(s)) return true;
  if (['n', 'no', 'false', '0'].includes(s)) return false;
  errors.push(`${field}: use Yes or No`);
  return false;
}

function money(v: unknown, errors: string[], field: string): number | null {
  const s = text(v);
  if (!s) return null;
  const n = Number(s.replace(/[S$,\s]/gi, ''));
  if (!Number.isFinite(n)) {
    errors.push(`${field}: "${s}" is not a number`);
    return null;
  }
  return n;
}

/** Accepts YYYY-MM-DD (what the browser sends) and D/M/YYYY (Singapore style typed as text). */
function date(v: unknown, errors: string[], field: string, required = false): string | null {
  const s = text(v);
  if (!s) {
    if (required) errors.push(`${field} is required`);
    return null;
  }
  let iso: string | null = null;
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (ymd) iso = `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  else if (dmy) iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const d = iso ? new Date(`${iso}T00:00:00Z`) : null;
  if (!iso || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    errors.push(`${field}: "${s}" is not a valid date (use DD/MM/YYYY)`);
    return null;
  }
  return iso;
}

function oneOf<T extends string>(v: unknown, allowed: T[], errors: string[], field: string, fallback: T): T {
  const s = slug(v);
  if (!s) return fallback;
  if ((allowed as string[]).includes(s)) return s as T;
  errors.push(`${field}: "${text(v)}" is not one of ${allowed.join(', ')}`);
  return fallback;
}

export const normEmail = (v: unknown) => text(v)?.toLowerCase() ?? null;

/** Digits only, Singapore +65 stripped, so "+65 9123 4567" and "91234567" match. */
export function normMobile(v: unknown): string | null {
  const digits = text(v)?.replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 && digits.startsWith('65') ? digits.slice(2) : digits;
}

const normName = (...parts: (string | null)[]) =>
  parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim() || null;

// ---- parsed rows -----------------------------------------------------------------------------

interface ParsedDonor {
  row: number;
  fields: {
    donor_type: DonorType;
    organisation_name: string | null;
    first_name: string | null;
    last_name: string | null;
    contact_title: string | null;
    preferred_name: string | null;
    email: string | null;
    mobile: string | null;
    how_they_know_fffa: string | null;
    programme_interest: string[];
    also_volunteers: boolean;
    major_override: boolean;
  };
  ownerEmail: string | null;
  errors: string[];
}

function parseDonor(r: ImportRow): ParsedDonor {
  const errors: string[] = [];
  const donor_type = oneOf(r.donor_type, DONOR_TYPES, errors, 'donor_type', 'individual');
  const fields = {
    donor_type,
    organisation_name: text(r.organisation_name),
    first_name: text(r.first_name),
    last_name: text(r.last_name),
    contact_title: text(r.contact_title),
    preferred_name: text(r.preferred_name),
    email: normEmail(r.email),
    mobile: text(r.mobile),
    how_they_know_fffa: text(r.how_they_know_fffa),
    programme_interest: (text(r.programme_interest) ?? '')
      .split(/[,;]/)
      .map((p) => p.trim())
      .filter(Boolean),
    also_volunteers: bool(r.also_volunteers, errors, 'also_volunteers'),
    major_override: bool(r.major_override, errors, 'major_override'),
  };
  if (!fields.organisation_name && !fields.first_name && !fields.last_name && !fields.preferred_name) {
    errors.push('Needs a name: first name, last name, preferred name or organisation name');
  }
  if (donor_type !== 'individual' && !fields.organisation_name) {
    errors.push('organisation_name is required for corporate and grant funder donors');
  }
  if (fields.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) errors.push(`email: "${fields.email}" is not valid`);
  return { row: r._row, fields, ownerEmail: normEmail(r.relationship_owner_email), errors };
}

const displayName = (f: ParsedDonor['fields']) =>
  f.organisation_name ?? (normName(f.first_name, f.last_name) ? [f.first_name, f.last_name].filter(Boolean).join(' ') : f.preferred_name) ?? 'Unnamed';

interface DbDonor {
  id: Uuid;
  first_name: string | null;
  last_name: string | null;
  organisation_name: string | null;
  preferred_name: string | null;
  email: string | null;
  mobile: string | null;
}

const candidateOf = (d: DbDonor, reason: string): Candidate => ({
  id: d.id,
  name: d.organisation_name ?? ([d.first_name, d.last_name].filter(Boolean).join(' ') || d.preferred_name || 'Unnamed'),
  email: d.email,
  mobile: d.mobile,
  reason,
});

/** Where a donation or key date points: an existing donor, or a donor row from this file. */
type Ref = { id: Uuid } | { row: number };

// ---- the plan --------------------------------------------------------------------------------

interface InternalPlan {
  plan: ImportPlan;
  newDonors: ParsedDonor[]; // rows that will be inserted
  ownerByRow: Map<number, Uuid>;
  donationInserts: { ref: Ref; row: number; v: DonationValues }[];
  keyDateInserts: { ref: Ref; row: number; kind: KeyDateKind; due_on: string; label: string }[];
}

interface DonationValues {
  donated_on: string;
  kind: DonationKind;
  amount_sgd: number | null;
  in_kind_description: string | null;
  estimated_value_sgd: number | null;
  channel: DonationChannel;
  external_ref: string | null;
  campaign: string | null;
  is_recurring: boolean;
  monthly_amount_sgd: number | null;
  payment_status: PaymentStatus;
  programme: string | null;
  thanked: boolean;
}

async function buildPlan(db: Db, payload: ImportPayload, decisions: ImportDecisions, committing: boolean): Promise<InternalPlan> {
  const donorRows = payload.donors ?? [];
  const donationRows = payload.donations ?? [];
  const keyDateRows = payload.key_dates ?? [];
  if (donorRows.length > MAX_DONORS) throw new HttpError(413, 'IMPORT_TOO_LARGE', `Import at most ${MAX_DONORS} donors at a time`);
  if (donationRows.length > MAX_CHILD_ROWS || keyDateRows.length > MAX_CHILD_ROWS) {
    throw new HttpError(413, 'IMPORT_TOO_LARGE', `Import at most ${MAX_CHILD_ROWS} donation or key date rows at a time`);
  }
  if (!donorRows.length && !donationRows.length && !keyDateRows.length) {
    throw new HttpError(400, 'IMPORT_EMPTY', 'The file has no rows to import');
  }

  const existing = await db.query<DbDonor>(
    `select id, first_name, last_name, organisation_name, preferred_name, email, mobile
     from donors where archived_at is null`,
  );
  const byEmail = new Map<string, DbDonor[]>();
  const byMobile = new Map<string, DbDonor[]>();
  const byName = new Map<string, DbDonor[]>();
  const push = (m: Map<string, DbDonor[]>, k: string | null, d: DbDonor) => {
    if (k) m.set(k, [...(m.get(k) ?? []), d]);
  };
  for (const d of existing) {
    push(byEmail, normEmail(d.email), d);
    push(byMobile, normMobile(d.mobile), d);
    push(byName, d.organisation_name?.toLowerCase().trim() ?? normName(d.first_name, d.last_name), d);
  }
  const staffRows = await db.query<{ id: Uuid; email: string }>('select id, email from staff where active');
  const staffByEmail = new Map(staffRows.map((s) => [s.email.toLowerCase(), s.id]));

  const donors: DonorPlan[] = [];
  const newDonors: ParsedDonor[] = [];
  const ownerByRow = new Map<number, Uuid>();
  // Lookup used by donation and key date rows: email / mobile -> where that donor lives.
  const refByEmail = new Map<string, Ref>();
  const refByMobile = new Map<string, Ref>();
  const fileEmail = new Map<string, number>();
  const fileMobile = new Map<string, number>();

  const addRefs = (f: { email: string | null; mobile: string | null }, ref: Ref) => {
    const e = normEmail(f.email);
    const m = normMobile(f.mobile);
    if (e && !refByEmail.has(e)) refByEmail.set(e, ref);
    if (m && !refByMobile.has(m)) refByMobile.set(m, ref);
  };

  for (const raw of donorRows) {
    const p = parseDonor(raw);
    const plan: DonorPlan = { row: p.row, name: displayName(p.fields), status: 'new', errors: p.errors, warnings: [] };
    donors.push(plan);
    if (p.errors.length) {
      plan.status = 'invalid';
      continue;
    }
    if (p.ownerEmail) {
      const owner = staffByEmail.get(p.ownerEmail);
      if (owner) ownerByRow.set(p.row, owner);
      else plan.warnings.push(`relationship_owner_email: no active staff member with ${p.ownerEmail}, left blank`);
    }

    const e = normEmail(p.fields.email);
    const m = normMobile(p.fields.mobile);

    // Same person appearing twice in the file: keep the first, ignore the repeat.
    const earlier = (e && fileEmail.get(e)) || (m && fileMobile.get(m)) || null;
    if (earlier) {
      plan.status = 'duplicate_in_file';
      plan.warnings.push(`Same email or mobile as row ${earlier}; this row is skipped`);
      continue;
    }

    const emailHits = e ? (byEmail.get(e) ?? []) : [];
    const mobileHits = m ? (byMobile.get(m) ?? []) : [];
    const nameKey = p.fields.organisation_name?.toLowerCase().trim() ?? normName(p.fields.first_name, p.fields.last_name);
    const nameHits = nameKey ? (byName.get(nameKey) ?? []) : [];

    const strong = new Map<Uuid, Candidate>();
    for (const d of emailHits) strong.set(d.id, candidateOf(d, 'Same email'));
    for (const d of mobileHits) {
      const prev = strong.get(d.id);
      strong.set(d.id, candidateOf(d, prev ? 'Same email and mobile' : 'Same mobile'));
    }

    let ref: Ref | null = null;
    if (strong.size === 1) {
      plan.status = 'match';
      plan.match = [...strong.values()][0];
      ref = { id: plan.match.id };
    } else if (strong.size > 1) {
      plan.status = 'review';
      plan.candidates = [...strong.values()].map((c) => ({ ...c, reason: `${c.reason} (email and mobile point to different donors)` }));
    } else if (nameHits.length) {
      plan.status = 'review';
      plan.candidates = nameHits.map((d) => candidateOf(d, 'Same name only'));
    }

    if (plan.status === 'review') {
      const choice = decisions[String(p.row)];
      if (choice === 'new') ref = { row: p.row };
      else if (choice && plan.candidates!.some((c) => c.id === choice)) ref = { id: choice };
      if (ref && committing) {
        if ('row' in ref) newDonors.push(p);
        plan.status = 'review';
      }
    } else if (plan.status === 'new') {
      newDonors.push(p);
      ref = { row: p.row };
    }

    if (ref) {
      addRefs(p.fields, ref);
      if (e) fileEmail.set(e, p.row);
      if (m) fileMobile.set(m, p.row);
    }
  }

  const resolve = (r: ImportRow, errors: string[]): Ref | null => {
    const e = normEmail(r.donor_email);
    const m = normMobile(r.donor_mobile);
    if (!e && !m) {
      errors.push('Needs donor_email or donor_mobile to say which donor this belongs to');
      return null;
    }
    const hit = (e && refByEmail.get(e)) || (m && refByMobile.get(m)) || null;
    if (hit) return hit;
    // Not in this file: look for an existing donor.
    const ex = (e && byEmail.get(e)) || (m && byMobile.get(m)) || [];
    if (ex.length === 1) return { id: ex[0].id };
    return null;
  };

  // Donations ------------------------------------------------------------------------------
  const existingRefs = await db.query<{ channel: string; external_ref: string }>(
    'select channel, external_ref from donations where external_ref is not null',
  ); // includes voided rows: the unique index does too
  const seenRefs = new Set(existingRefs.map((r) => `${r.channel}|${r.external_ref}`));
  const donations: ChildPlan[] = [];
  const donationInserts: InternalPlan['donationInserts'] = [];

  for (const r of donationRows) {
    const errors: string[] = [];
    const kind = oneOf(r.kind, KINDS, errors, 'kind', 'cash');
    const v: DonationValues = {
      donated_on: date(r.donated_on, errors, 'donated_on', true) ?? '',
      kind,
      amount_sgd: money(r.amount_sgd, errors, 'amount_sgd'),
      in_kind_description: text(r.in_kind_description),
      estimated_value_sgd: money(r.estimated_value_sgd, errors, 'estimated_value_sgd'),
      channel: oneOf(r.channel, CHANNELS, errors, 'channel', 'other'),
      external_ref: text(r.external_ref),
      campaign: text(r.campaign),
      is_recurring: bool(r.is_recurring, errors, 'is_recurring'),
      monthly_amount_sgd: money(r.monthly_amount_sgd, errors, 'monthly_amount_sgd'),
      payment_status: oneOf(r.payment_status, PAYMENT_STATUSES, errors, 'payment_status', 'succeeded'),
      programme: text(r.programme),
      thanked: bool(r.thanked, errors, 'thanked'),
    };
    if (kind === 'cash' && !(v.amount_sgd && v.amount_sgd > 0)) errors.push('Cash donations need amount_sgd above 0');
    if (kind === 'in_kind' && !v.in_kind_description) errors.push('In-kind donations need in_kind_description');
    if (v.estimated_value_sgd !== null && v.estimated_value_sgd < 0) errors.push('estimated_value_sgd cannot be negative');
    if (v.is_recurring && !v.monthly_amount_sgd) v.monthly_amount_sgd = v.amount_sgd;

    const label = `${v.donated_on || '?'} · ${kind === 'cash' ? `S$${v.amount_sgd ?? '?'}` : (v.in_kind_description ?? 'in-kind')}`;
    const plan: ChildPlan = { row: r._row, label, status: 'new', errors };
    donations.push(plan);
    if (errors.length) {
      plan.status = 'invalid';
      continue;
    }
    const ref = resolve(r, errors);
    if (!ref) {
      plan.status = 'orphan';
      if (!errors.length) errors.push('No donor in the file or the database matches this email or mobile');
      continue;
    }
    if (v.external_ref) {
      const key = `${v.channel}|${v.external_ref}`;
      if (seenRefs.has(key)) {
        plan.status = 'duplicate';
        plan.errors.push(`Already imported: ${v.channel} reference ${v.external_ref}`);
        continue;
      }
      seenRefs.add(key);
    }
    donationInserts.push({ ref, row: r._row, v });
  }

  // Key dates ------------------------------------------------------------------------------
  const keyDates: ChildPlan[] = [];
  const keyDateInserts: InternalPlan['keyDateInserts'] = [];
  const seenKeys = new Set<string>();
  const existingKeys = await db.query<{ donor_id: string; kind: string; due_on: string; label: string | null }>(
    'select donor_id, kind, due_on, label from key_dates',
  );
  for (const k of existingKeys) seenKeys.add(`${k.donor_id}|${k.kind}|${k.due_on}|${k.label ?? ''}`);

  for (const r of keyDateRows) {
    const errors: string[] = [];
    const kind = oneOf(r.kind, KEY_DATE_KINDS, errors, 'kind', 'other');
    const due_on = date(r.due_on, errors, 'due_on', true);
    const label = text(r.label);
    if (!label) errors.push('label is required, e.g. "Q4 report to XYZ Foundation"');
    const plan: ChildPlan = { row: r._row, label: `${due_on ?? '?'} · ${label ?? kind}`, status: 'new', errors };
    keyDates.push(plan);
    if (errors.length) {
      plan.status = 'invalid';
      continue;
    }
    const ref = resolve(r, errors);
    if (!ref) {
      plan.status = 'orphan';
      if (!errors.length) errors.push('No donor in the file or the database matches this email or mobile');
      continue;
    }
    if ('id' in ref) {
      const key = `${ref.id}|${kind}|${due_on}|${label}`;
      if (seenKeys.has(key)) {
        plan.status = 'duplicate';
        plan.errors.push('This key date already exists for the donor');
        continue;
      }
      seenKeys.add(key);
    }
    keyDateInserts.push({ ref, row: r._row, kind, due_on: due_on!, label: label! });
  }

  const count = <T extends { status: string }>(xs: T[], s: string) => xs.filter((x) => x.status === s).length;
  const needsReviewOpen = donors.filter((d) => d.status === 'review' && !decisions[String(d.row)]).length;
  const plan: ImportPlan = {
    donors,
    donations,
    key_dates: keyDates,
    summary: {
      donors_new: count(donors, 'new') + donors.filter((d) => d.status === 'review' && decisions[String(d.row)] === 'new').length,
      donors_matched: count(donors, 'match'),
      donors_needing_review: needsReviewOpen,
      donations_new: donationInserts.length,
      key_dates_new: keyDateInserts.length,
      rows_with_errors: [donors, donations, keyDates].flat().filter((x) => x.status === 'invalid' || x.status === 'orphan').length,
      rows_skipped:
        count(donors, 'duplicate_in_file') + count(donations, 'duplicate') + count(keyDates, 'duplicate') + needsReviewOpen,
    },
  };
  return { plan, newDonors, ownerByRow, donationInserts, keyDateInserts };
}

/** Read-only: what would happen if this file were imported. */
export async function previewImport(db: Db, payload: ImportPayload, decisions: ImportDecisions = {}): Promise<ImportPlan> {
  return (await buildPlan(db, payload ?? {}, decisions ?? {}, false)).plan;
}

/** Writes the plan. Rows with errors or undecided matches are skipped, never half-written. */
export async function commitImport(
  db: Db,
  staff: Staff,
  payload: ImportPayload,
  decisions: ImportDecisions = {},
): Promise<{ donors_created: number; donations_created: number; key_dates_created: number; plan: ImportPlan }> {
  const { plan, newDonors, ownerByRow, donationInserts, keyDateInserts } = await buildPlan(db, payload ?? {}, decisions ?? {}, true);

  const result = await db.transaction(async (tx) => {
    const idByRow = new Map<number, Uuid>();
    for (const p of newDonors) {
      const f = p.fields;
      const [{ id }] = await tx.query<{ id: Uuid }>(
        `insert into donors (donor_type, organisation_name, first_name, last_name, contact_title, preferred_name,
           email, mobile, relationship_owner, how_they_know_fffa, programme_interest, also_volunteers, major_override)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [
          f.donor_type, f.organisation_name, f.first_name, f.last_name, f.contact_title, f.preferred_name,
          f.email, f.mobile, ownerByRow.get(p.row) ?? null, f.how_they_know_fffa, f.programme_interest,
          f.also_volunteers, f.major_override,
        ],
      );
      idByRow.set(p.row, id);
    }
    const idOf = (ref: Ref): Uuid | null => ('id' in ref ? ref.id : (idByRow.get(ref.row) ?? null));

    let donationsCreated = 0;
    for (const { ref, v } of donationInserts) {
      const donorId = idOf(ref);
      if (!donorId) continue; // its donor row was undecided or skipped
      await tx.query(
        `insert into donations (donor_id, donated_on, kind, amount_sgd, in_kind_description, estimated_value_sgd,
           channel, external_ref, campaign, is_recurring, monthly_amount_sgd, payment_status, programme, thanked)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          donorId, v.donated_on, v.kind, v.amount_sgd, v.in_kind_description, v.estimated_value_sgd, v.channel,
          v.external_ref, v.campaign, v.is_recurring, v.monthly_amount_sgd, v.payment_status, v.programme, v.thanked,
        ],
      );
      donationsCreated++;
    }
    let keyDatesCreated = 0;
    for (const k of keyDateInserts) {
      const donorId = idOf(k.ref);
      if (!donorId) continue;
      await tx.query('insert into key_dates (donor_id, kind, due_on, label) values ($1,$2,$3,$4)', [donorId, k.kind, k.due_on, k.label]);
      keyDatesCreated++;
    }

    const out = { donors_created: idByRow.size, donations_created: donationsCreated, key_dates_created: keyDatesCreated };
    // Counts only: no names or contact details in the audit log.
    await logActivity(tx, { actor: staff.id, action: 'import.run', entityType: 'import', entityId: null, diff: { ...out, matched: plan.summary.donors_matched } });
    return out;
  });

  return { ...result, plan };
}
