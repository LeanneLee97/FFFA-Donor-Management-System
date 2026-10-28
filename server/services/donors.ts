import type {
  Donation,
  DonationChannel,
  DonationKind,
  Donor,
  DonorFilters,
  DonorListItem,
  DonorType,
  Engagement,
  EngagementChannel,
  IsoDate,
  KeyDate,
  KeyDateKind,
  Note,
  PaymentStatus,
  Staff,
  Tier,
  Uuid,
} from '../../shared/types.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import { logActivity } from './activity.ts';

const VALID_DONOR_TYPES: DonorType[] = ['individual', 'corporate', 'grant_funder'];
const VALID_CHANNELS: DonationChannel[] = ['give_asia', 'giving_sg', 'bank', 'paynow', 'in_person', 'other'];
const VALID_KINDS: DonationKind[] = ['cash', 'in_kind'];
const VALID_PAYMENT_STATUSES: PaymentStatus[] = ['succeeded', 'failed'];
const VALID_KEY_DATE_KINDS: KeyDateKind[] = ['sponsorship_expiry', 'grant_report', 'grant_renewal', 'other'];
const VALID_ENGAGEMENT_CHANNELS: EngagementChannel[] = ['email', 'call', 'whatsapp', 'meeting', 'event', 'other'];
const VALID_TIERS: Tier[] = ['bronze', 'silver', 'gold', 'diamond'];

export async function listDonors(db: Db, filters?: DonorFilters): Promise<DonorListItem[]> {
  const conditions: string[] = ['d.archived_at is null'];
  const params: unknown[] = [];

  if (filters?.query?.trim()) {
    params.push(`%${filters.query.trim().toLowerCase()}%`);
    const p = `$${params.length}`;
    conditions.push(`(
      lower(coalesce(d.first_name, '')) like ${p} or
      lower(coalesce(d.last_name, '')) like ${p} or
      lower(coalesce(d.preferred_name, '')) like ${p} or
      lower(coalesce(d.organisation_name, '')) like ${p} or
      lower(coalesce(d.email, '')) like ${p} or
      coalesce(d.mobile, '') like ${p}
    )`);
  }

  if (filters?.type) {
    if (!VALID_DONOR_TYPES.includes(filters.type)) {
      throw new HttpError(400, 'INVALID_DONOR_TYPE', `Unknown donor type: ${filters.type}`);
    }
    params.push(filters.type);
    conditions.push(`d.donor_type = $${params.length}`);
  }

  if (filters?.tier) {
    if (!VALID_TIERS.includes(filters.tier)) {
      throw new HttpError(400, 'INVALID_TIER', `Unknown tier: ${filters.tier}`);
    }
    params.push(filters.tier);
    conditions.push(`s.tier = $${params.length}`);
  }

  if (filters?.lastDonationBefore) {
    params.push(filters.lastDonationBefore);
    conditions.push(`(s.last_donation_on is null or s.last_donation_on < $${params.length})`);
  }

  if (filters?.owner) {
    params.push(filters.owner);
    conditions.push(`d.relationship_owner = $${params.length}`);
  }

  const sql = `
    select d.*,
           coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), d.preferred_name, d.organisation_name) as donor_name,
           to_jsonb(s) as summary
    from donors d
    left join donor_summary s on s.donor_id = d.id
    where ${conditions.join(' and ')}
    order by coalesce(s.last_donation_on, d.created_at::date) desc, d.created_at desc
  `;

  return db.query<DonorListItem>(sql, params);
}

export interface CreateDonorInput {
  donor_type?: DonorType;
  organisation_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  contact_title?: string | null;
  preferred_name?: string | null;
  email?: string | null;
  mobile?: string | null;
  relationship_owner?: Uuid | null;
  how_they_know_fffa?: string | null;
  programme_interest?: string[];
  also_volunteers?: boolean;
  major_override?: boolean;
  next_action?: string | null;
  next_action_due?: IsoDate | null;
}

export async function createDonor(db: Db, staff: Staff, input: CreateDonorInput): Promise<Donor> {
  const donorType: DonorType = input.donor_type ?? 'individual';
  if (!VALID_DONOR_TYPES.includes(donorType)) {
    throw new HttpError(400, 'INVALID_DONOR_TYPE', `Unknown donor type: ${donorType}`);
  }

  const orgName = input.organisation_name?.trim() || null;
  const firstName = input.first_name?.trim() || null;
  const lastName = input.last_name?.trim() || null;
  const preferredName = input.preferred_name?.trim() || null;

  if (!orgName && !firstName && !lastName && !preferredName) {
    throw new HttpError(400, 'INVALID_DONOR', 'Donor must have a name (first name, last name, preferred name, or organisation name)');
  }

  if ((donorType === 'corporate' || donorType === 'grant_funder') && !orgName) {
    throw new HttpError(400, 'INVALID_DONOR', 'Organisation name is required for corporate and grant funder donors');
  }

  const email = input.email?.trim().toLowerCase() || null;
  const mobile = input.mobile?.trim() || null;
  const contactTitle = input.contact_title?.trim() || null;
  const howTheyKnow = input.how_they_know_fffa?.trim() || null;
  const progInterest = input.programme_interest ?? [];
  const alsoVolunteers = Boolean(input.also_volunteers);
  const majorOverride = Boolean(input.major_override);
  const nextAction = input.next_action?.trim() || null;
  const nextActionDue = input.next_action_due || null;
  const relationshipOwner = input.relationship_owner || null;

  return db.transaction(async (tx) => {
    const [donor] = await tx.query<Donor>(
      `insert into donors (
        donor_type, organisation_name, first_name, last_name, contact_title, preferred_name,
        email, mobile, relationship_owner, how_they_know_fffa, programme_interest,
        also_volunteers, major_override, next_action, next_action_due
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      returning *`,
      [
        donorType,
        orgName,
        firstName,
        lastName,
        contactTitle,
        preferredName,
        email,
        mobile,
        relationshipOwner,
        howTheyKnow,
        progInterest,
        alsoVolunteers,
        majorOverride,
        nextAction,
        nextActionDue,
      ],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'donor.create',
      entityType: 'donor',
      entityId: donor.id,
      diff: {
        donor_type: donor.donor_type,
        organisation_name: donor.organisation_name,
        first_name: donor.first_name,
        last_name: donor.last_name,
      },
    });

    return donor;
  });
}

export async function updateDonor(
  db: Db,
  donorId: Uuid,
  staff: Staff,
  input: Partial<CreateDonorInput>,
): Promise<Donor> {
  const [existing] = await db.query<Donor>('select * from donors where id = $1 and archived_at is null', [donorId]);
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Donor not found');

  const donorType = input.donor_type ?? existing.donor_type;
  if (!VALID_DONOR_TYPES.includes(donorType)) {
    throw new HttpError(400, 'INVALID_DONOR_TYPE', `Unknown donor type: ${donorType}`);
  }

  const orgName = input.organisation_name !== undefined ? (input.organisation_name?.trim() || null) : existing.organisation_name;
  const firstName = input.first_name !== undefined ? (input.first_name?.trim() || null) : existing.first_name;
  const lastName = input.last_name !== undefined ? (input.last_name?.trim() || null) : existing.last_name;
  const preferredName = input.preferred_name !== undefined ? (input.preferred_name?.trim() || null) : existing.preferred_name;

  if (!orgName && !firstName && !lastName && !preferredName) {
    throw new HttpError(400, 'INVALID_DONOR', 'Donor must have a name (first name, last name, preferred name, or organisation name)');
  }

  if ((donorType === 'corporate' || donorType === 'grant_funder') && !orgName) {
    throw new HttpError(400, 'INVALID_DONOR', 'Organisation name is required for corporate and grant funder donors');
  }

  const email = input.email !== undefined ? (input.email?.trim().toLowerCase() || null) : existing.email;
  const mobile = input.mobile !== undefined ? (input.mobile?.trim() || null) : existing.mobile;
  const contactTitle = input.contact_title !== undefined ? (input.contact_title?.trim() || null) : existing.contact_title;
  const howTheyKnow = input.how_they_know_fffa !== undefined ? (input.how_they_know_fffa?.trim() || null) : existing.how_they_know_fffa;
  const progInterest = input.programme_interest !== undefined ? input.programme_interest : existing.programme_interest;
  const alsoVolunteers = input.also_volunteers !== undefined ? Boolean(input.also_volunteers) : existing.also_volunteers;
  const majorOverride = input.major_override !== undefined ? Boolean(input.major_override) : existing.major_override;
  const nextAction = input.next_action !== undefined ? (input.next_action?.trim() || null) : existing.next_action;
  const nextActionDue = input.next_action_due !== undefined ? (input.next_action_due || null) : existing.next_action_due;
  const relationshipOwner = input.relationship_owner !== undefined ? (input.relationship_owner || null) : existing.relationship_owner;

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const fields = [
    ['donor_type', existing.donor_type, donorType],
    ['organisation_name', existing.organisation_name, orgName],
    ['first_name', existing.first_name, firstName],
    ['last_name', existing.last_name, lastName],
    ['contact_title', existing.contact_title, contactTitle],
    ['preferred_name', existing.preferred_name, preferredName],
    ['email', existing.email, email],
    ['mobile', existing.mobile, mobile],
    ['relationship_owner', existing.relationship_owner, relationshipOwner],
    ['how_they_know_fffa', existing.how_they_know_fffa, howTheyKnow],
    ['also_volunteers', existing.also_volunteers, alsoVolunteers],
    ['major_override', existing.major_override, majorOverride],
    ['next_action', existing.next_action, nextAction],
    ['next_action_due', existing.next_action_due, nextActionDue],
  ] as const;

  for (const [key, before, after] of fields) {
    if (before !== after) diff[key] = { from: before, to: after };
  }

  if (JSON.stringify(existing.programme_interest) !== JSON.stringify(progInterest)) {
    diff.programme_interest = { from: existing.programme_interest, to: progInterest };
  }

  if (Object.keys(diff).length === 0) return existing;

  return db.transaction(async (tx) => {
    const [updated] = await tx.query<Donor>(
      `update donors
       set donor_type = $2, organisation_name = $3, first_name = $4, last_name = $5,
           contact_title = $6, preferred_name = $7, email = $8, mobile = $9,
           relationship_owner = $10, how_they_know_fffa = $11, programme_interest = $12,
           also_volunteers = $13, major_override = $14, next_action = $15, next_action_due = $16
       where id = $1
       returning *`,
      [
        donorId,
        donorType,
        orgName,
        firstName,
        lastName,
        contactTitle,
        preferredName,
        email,
        mobile,
        relationshipOwner,
        howTheyKnow,
        progInterest,
        alsoVolunteers,
        majorOverride,
        nextAction,
        nextActionDue,
      ],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'donor.update',
      entityType: 'donor',
      entityId: donorId,
      diff,
    });

    return updated;
  });
}

export async function archiveDonor(db: Db, donorId: Uuid, staff: Staff): Promise<Donor> {
  const [donor] = await db.query<Donor>('select * from donors where id = $1 and archived_at is null', [donorId]);
  if (!donor) throw new HttpError(404, 'NOT_FOUND', 'Donor not found');

  return db.transaction(async (tx) => {
    const [archived] = await tx.query<Donor>(
      'update donors set archived_at = now() where id = $1 returning *',
      [donorId],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'donor.archive',
      entityType: 'donor',
      entityId: donorId,
    });

    return archived;
  });
}

export async function deleteDonor(db: Db, donorId: Uuid, staff: Staff): Promise<void> {
  const [donor] = await db.query<Donor>('select * from donors where id = $1', [donorId]);
  if (!donor) throw new HttpError(404, 'NOT_FOUND', 'Donor not found');

  await db.transaction(async (tx) => {
    await tx.query('delete from donors where id = $1', [donorId]);
    await logActivity(tx, {
      actor: staff.id,
      action: 'donor.delete',
      entityType: 'donor',
      entityId: donorId,
      diff: { reason: 'pdpa_request' },
    });
  });
}

export interface CreateDonationInput {
  donated_on: IsoDate;
  kind?: DonationKind;
  amount_sgd?: number | null;
  in_kind_description?: string | null;
  estimated_value_sgd?: number | null;
  channel?: DonationChannel;
  external_ref?: string | null;
  campaign?: string | null;
  is_recurring?: boolean;
  monthly_amount_sgd?: number | null;
  payment_status?: PaymentStatus;
  programme?: string | null;
  thanked?: boolean;
}

export async function createDonation(
  db: Db,
  donorId: Uuid,
  staff: Staff,
  input: CreateDonationInput,
): Promise<Donation> {
  const [donor] = await db.query<Donor>('select id from donors where id = $1 and archived_at is null', [donorId]);
  if (!donor) throw new HttpError(404, 'NOT_FOUND', 'Donor not found');

  if (!input.donated_on) throw new HttpError(400, 'INVALID_DONATION', 'donated_on is required');

  const kind = input.kind ?? 'cash';
  if (!VALID_KINDS.includes(kind)) throw new HttpError(400, 'INVALID_DONATION', `Unknown donation kind: ${kind}`);

  const channel = input.channel ?? 'other';
  if (!VALID_CHANNELS.includes(channel)) throw new HttpError(400, 'INVALID_DONATION', `Unknown channel: ${channel}`);

  const paymentStatus = input.payment_status ?? 'succeeded';
  if (!VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
    throw new HttpError(400, 'INVALID_DONATION', `Unknown payment status: ${paymentStatus}`);
  }

  let amountSgd: number | null = null;
  let inKindDesc: string | null = null;
  let estimatedValueSgd: number | null = null;

  if (kind === 'cash') {
    if (typeof input.amount_sgd !== 'number' || Number.isNaN(input.amount_sgd) || input.amount_sgd <= 0) {
      throw new HttpError(400, 'INVALID_DONATION', 'Cash donations require amount_sgd > 0');
    }
    amountSgd = input.amount_sgd;
  } else {
    inKindDesc = input.in_kind_description?.trim() || null;
    if (!inKindDesc) {
      throw new HttpError(400, 'INVALID_DONATION', 'In-kind donations require in_kind_description');
    }
    if (input.estimated_value_sgd !== undefined && input.estimated_value_sgd !== null) {
      if (typeof input.estimated_value_sgd !== 'number' || input.estimated_value_sgd < 0) {
        throw new HttpError(400, 'INVALID_DONATION', 'estimated_value_sgd must be 0 or more');
      }
      estimatedValueSgd = input.estimated_value_sgd;
    }
  }

  const externalRef = input.external_ref?.trim() || null;
  if (externalRef) {
    const [existing] = await db.query<{ id: string }>(
      'select id from donations where channel = $1 and external_ref = $2 and voided_at is null',
      [channel, externalRef],
    );
    if (existing) {
      throw new HttpError(409, 'DUPLICATE_DONATION', `A donation with reference '${externalRef}' already exists for ${channel}`);
    }
  }

  const campaign = input.campaign?.trim() || null;
  const isRecurring = Boolean(input.is_recurring);
  const monthlyAmount = input.monthly_amount_sgd !== undefined ? input.monthly_amount_sgd : null;
  const programme = input.programme?.trim() || null;
  const thanked = Boolean(input.thanked);

  return db.transaction(async (tx) => {
    const [donation] = await tx.query<Donation>(
      `insert into donations (
        donor_id, donated_on, kind, amount_sgd, in_kind_description, estimated_value_sgd,
        channel, external_ref, campaign, is_recurring, monthly_amount_sgd, payment_status,
        programme, thanked
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      returning *`,
      [
        donorId,
        input.donated_on,
        kind,
        amountSgd,
        inKindDesc,
        estimatedValueSgd,
        channel,
        externalRef,
        campaign,
        isRecurring,
        monthlyAmount,
        paymentStatus,
        programme,
        thanked,
      ],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'donation.create',
      entityType: 'donation',
      entityId: donation.id,
      diff: {
        donor_id: donorId,
        kind,
        amount_sgd: amountSgd,
        channel,
        campaign,
        payment_status: paymentStatus,
      },
    });

    return donation;
  });
}

export async function voidDonation(db: Db, donationId: Uuid, staff: Staff, reason: string): Promise<Donation> {
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    throw new HttpError(400, 'INVALID_VOID_REASON', 'A void reason is required');
  }

  const [donation] = await db.query<Donation>('select * from donations where id = $1', [donationId]);
  if (!donation) throw new HttpError(404, 'NOT_FOUND', 'Donation not found');
  if (donation.voided_at) throw new HttpError(400, 'ALREADY_VOIDED', 'Donation has already been voided');

  return db.transaction(async (tx) => {
    const [voided] = await tx.query<Donation>(
      `update donations
       set voided_at = now(), void_reason = $2
       where id = $1
       returning *`,
      [donationId, reason.trim()],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'donation.void',
      entityType: 'donation',
      entityId: donationId,
      diff: {
        reason: reason.trim(),
        donor_id: donation.donor_id,
        amount_sgd: donation.amount_sgd,
        kind: donation.kind,
      },
    });

    return voided;
  });
}

export async function createNote(db: Db, donorId: Uuid, staff: Staff, body: string): Promise<Note> {
  const [donor] = await db.query<Donor>('select id from donors where id = $1 and archived_at is null', [donorId]);
  if (!donor) throw new HttpError(404, 'NOT_FOUND', 'Donor not found');

  if (!body || typeof body !== 'string' || !body.trim()) {
    throw new HttpError(400, 'INVALID_NOTE', 'Note body cannot be empty');
  }

  return db.transaction(async (tx) => {
    const [note] = await tx.query<Note>(
      `insert into notes (donor_id, author, body)
       values ($1, $2, $3)
       returning *`,
      [donorId, staff.id, body.trim()],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'note.create',
      entityType: 'note',
      entityId: note.id,
      diff: { donor_id: donorId },
    });

    return note;
  });
}

export async function deleteNote(db: Db, noteId: Uuid, staff: Staff): Promise<Note> {
  const [note] = await db.query<Note>('select * from notes where id = $1 and deleted_at is null', [noteId]);
  if (!note) throw new HttpError(404, 'NOT_FOUND', 'Note not found');

  if (staff.role !== 'admin' && note.author !== staff.id) {
    throw new HttpError(403, 'FORBIDDEN', 'Only the note author or an admin can delete this note');
  }

  return db.transaction(async (tx) => {
    const [deleted] = await tx.query<Note>(
      'update notes set deleted_at = now() where id = $1 returning *',
      [noteId],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'note.delete',
      entityType: 'note',
      entityId: noteId,
      diff: { donor_id: note.donor_id },
    });

    return deleted;
  });
}

export interface CreateEngagementInput {
  channel?: EngagementChannel;
  engaged_on?: IsoDate;
  campaign?: string | null;
  summary: string;
  message_subject?: string | null;
  message_body?: string | null;
  follow_up_id?: Uuid | null;
  ai_draft_id?: Uuid | null;
}

export async function createEngagement(
  db: Db,
  donorId: Uuid,
  staff: Staff,
  input: CreateEngagementInput,
): Promise<Engagement> {
  const [donor] = await db.query<Donor>('select id from donors where id = $1 and archived_at is null', [donorId]);
  if (!donor) throw new HttpError(404, 'NOT_FOUND', 'Donor not found');

  const summary = input.summary?.trim();
  if (!summary) throw new HttpError(400, 'INVALID_ENGAGEMENT', 'Engagement summary is required');

  const channel = input.channel ?? 'other';
  if (!VALID_ENGAGEMENT_CHANNELS.includes(channel)) {
    throw new HttpError(400, 'INVALID_ENGAGEMENT', `Unknown engagement channel: ${channel}`);
  }

  const engagedOn = input.engaged_on || new Date().toISOString().slice(0, 10);
  const campaign = input.campaign?.trim() || null;
  const messageSubject = input.message_subject?.trim() || null;
  const messageBody = input.message_body || null;
  const followUpId = input.follow_up_id || null;
  const aiDraftId = input.ai_draft_id || null;

  return db.transaction(async (tx) => {
    const [engagement] = await tx.query<Engagement>(
      `insert into engagements (
        donor_id, follow_up_id, ai_draft_id, engaged_on, channel, campaign, summary,
        message_subject, message_body, staff_id
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning *`,
      [
        donorId,
        followUpId,
        aiDraftId,
        engagedOn,
        channel,
        campaign,
        summary,
        messageSubject,
        messageBody,
        staff.id,
      ],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'engagement.create',
      entityType: 'engagement',
      entityId: engagement.id,
      diff: { donor_id: donorId, channel, campaign },
    });

    return engagement;
  });
}

export async function listKeyDates(db: Db, donorId: Uuid): Promise<KeyDate[]> {
  const [donor] = await db.query<Donor>('select id from donors where id = $1 and archived_at is null', [donorId]);
  if (!donor) throw new HttpError(404, 'NOT_FOUND', 'Donor not found');

  return db.query<KeyDate>('select * from key_dates where donor_id = $1 order by due_on asc', [donorId]);
}

export interface CreateKeyDateInput {
  kind?: KeyDateKind;
  due_on: IsoDate;
  label: string;
}

export async function createKeyDate(
  db: Db,
  donorId: Uuid,
  staff: Staff,
  input: CreateKeyDateInput,
): Promise<KeyDate> {
  const [donor] = await db.query<Donor>('select id from donors where id = $1 and archived_at is null', [donorId]);
  if (!donor) throw new HttpError(404, 'NOT_FOUND', 'Donor not found');

  if (!input.due_on || typeof input.due_on !== 'string') {
    throw new HttpError(400, 'INVALID_KEY_DATE', 'due_on date is required');
  }

  const label = input.label?.trim();
  if (!label) throw new HttpError(400, 'INVALID_KEY_DATE', 'label is required');

  const kind = input.kind ?? 'other';
  if (!VALID_KEY_DATE_KINDS.includes(kind)) {
    throw new HttpError(400, 'INVALID_KEY_DATE', `Unknown key date kind: ${kind}`);
  }

  return db.transaction(async (tx) => {
    const [keyDate] = await tx.query<KeyDate>(
      `insert into key_dates (donor_id, kind, due_on, label)
       values ($1, $2, $3, $4)
       returning *`,
      [donorId, kind, input.due_on, label],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'key_date.create',
      entityType: 'key_date',
      entityId: keyDate.id,
      diff: { donor_id: donorId, kind, due_on: input.due_on, label },
    });

    return keyDate;
  });
}

export interface UpdateKeyDateInput {
  kind?: KeyDateKind;
  due_on?: IsoDate;
  label?: string;
  completed?: boolean;
}

export async function updateKeyDate(
  db: Db,
  keyDateId: Uuid,
  staff: Staff,
  input: UpdateKeyDateInput,
): Promise<KeyDate> {
  const [existing] = await db.query<KeyDate>('select * from key_dates where id = $1', [keyDateId]);
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Key date not found');

  const kind = input.kind ?? existing.kind;
  if (!VALID_KEY_DATE_KINDS.includes(kind)) {
    throw new HttpError(400, 'INVALID_KEY_DATE', `Unknown key date kind: ${kind}`);
  }

  const dueOn = input.due_on ?? existing.due_on;
  const label = input.label !== undefined ? (input.label.trim() || null) : existing.label;
  if (!label) throw new HttpError(400, 'INVALID_KEY_DATE', 'label cannot be empty');

  let completedAt: string | null = existing.completed_at;
  if (input.completed !== undefined) {
    completedAt = input.completed ? new Date().toISOString() : null;
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx.query<KeyDate>(
      `update key_dates
       set kind = $2, due_on = $3, label = $4, completed_at = $5
       where id = $1
       returning *`,
      [keyDateId, kind, dueOn, label, completedAt],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'key_date.update',
      entityType: 'key_date',
      entityId: keyDateId,
      diff: {
        donor_id: existing.donor_id,
        kind: kind !== existing.kind ? { from: existing.kind, to: kind } : undefined,
        due_on: dueOn !== existing.due_on ? { from: existing.due_on, to: dueOn } : undefined,
        label: label !== existing.label ? { from: existing.label, to: label } : undefined,
        completed_at: completedAt !== existing.completed_at ? { from: existing.completed_at, to: completedAt } : undefined,
      },
    });

    return updated;
  });
}
