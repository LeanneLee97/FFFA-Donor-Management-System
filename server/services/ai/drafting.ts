import type {
  AiDraft,
  Donation,
  Donor,
  DonorSummary,
  Engagement,
  EngagementChannel,
  FollowUp,
  KeyDate,
  Note,
  Staff,
  Uuid,
} from '../../../shared/types.ts';
import type { Db } from '../../db.ts';
import { HttpError } from '../../lib/errors.ts';
import { logActivity } from '../activity.ts';
import type { AiClient } from './client.ts';
import { buildDraftContext, type DraftInputs } from './context.ts';
import { fallbackDraft, type DraftText } from './fallback.ts';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from './prompts.ts';

/** Kept as its own name so DM10 errors are easy to spot; behaves like any HttpError. */
export class DraftError extends HttpError {}

const DRAFT_COLUMNS = `id, follow_up_id, donor_id, prompt_version, source, subject, body_generated,
  body_final, status, created_by, approved_by, approved_at, sent_at`;

async function loadInputs(db: Db, followUpId: Uuid): Promise<DraftInputs & { summary: DonorSummary | null }> {
  const [followUp] = await db.query<FollowUp>('select * from follow_ups where id = $1', [followUpId]);
  if (!followUp) throw new DraftError(404, 'NOT_FOUND', 'Follow-up not found');
  if (followUp.status === 'done' || followUp.status === 'dismissed') {
    throw new DraftError(409, 'FOLLOW_UP_CLOSED', `Follow-up is already ${followUp.status}`);
  }

  const [donor] = await db.query<Donor>('select * from donors where id = $1 and archived_at is null', [
    followUp.donor_id,
  ]);
  if (!donor) throw new DraftError(404, 'NOT_FOUND', 'Donor not found or archived');

  const [[summary], donations, [failedDonation], [keyDate], notes, orgRows] = await Promise.all([
    db.query<DonorSummary>('select * from donor_summary where donor_id = $1', [donor.id]),
    db.query<Donation>(
      `select * from donations
       where donor_id = $1 and voided_at is null and payment_status = 'succeeded'
       order by donated_on desc, created_at desc limit 24`,
      [donor.id],
    ),
    db.query<Donation>(
      `select * from donations
       where donor_id = $1 and voided_at is null and payment_status = 'failed'
       order by donated_on desc, created_at desc limit 1`,
      [donor.id],
    ),
    followUp.key_date_id
      ? db.query<KeyDate>('select * from key_dates where id = $1', [followUp.key_date_id])
      : Promise.resolve([] as KeyDate[]),
    db.query<Note>(
      `select * from notes where donor_id = $1 and deleted_at is null order by created_at desc limit 3`,
      [donor.id],
    ),
    db.query<{ key: string; value: string }>('select key, value from org_settings'),
  ]);
  const org = Object.fromEntries(orgRows.map((r) => [r.key, r.value]));

  return {
    followUp,
    donor,
    summary: summary ?? null,
    donations,
    failedDonation: failedDonation ?? null,
    keyDate: keyDate ?? null,
    notes,
    org: {
      orgName: org.org_name ?? 'Free Food For All',
      impactUnitSgd: Number(org.impact_unit_sgd ?? 0),
      impactUnitSingular: org.impact_unit_singular ?? 'meal',
      impactUnitPlural: org.impact_unit_plural ?? 'meals',
      signature: org.signature ?? 'The Free Food For All team',
    },
    today: new Date().toISOString().slice(0, 10),
  };
}

/** DM10: generate a draft for a follow-up. AI if available, otherwise the reason's template. */
export async function createDraft(db: Db, ai: AiClient | null, followUpId: Uuid, staff: Staff): Promise<AiDraft> {
  const inputs = await loadInputs(db, followUpId);
  if (inputs.summary?.is_major) {
    // PRD + FFFA: major donors (S$5,000+/yr, 3+ years, or tagged) get personal outreach, never an AI draft.
    throw new DraftError(422, 'PERSONAL_OUTREACH', 'Major donor: personal outreach from staff, AI drafts are disabled');
  }

  const [approved] = await db.query<{ id: Uuid }>(
    `select id from ai_drafts where follow_up_id = $1 and status = 'approved' limit 1`,
    [followUpId],
  );
  if (approved) {
    throw new DraftError(409, 'ALREADY_APPROVED', 'This follow-up already has an approved message: mark it as sent or discard it first');
  }

  const ctx = buildDraftContext(inputs);
  let text: DraftText;
  let source: AiDraft['source'] = 'ai';
  let aiError: string | undefined;
  if (ai) {
    try {
      text = await ai.generateDraft({ system: SYSTEM_PROMPT, prompt: buildUserPrompt(ctx) });
    } catch (err) {
      aiError = err instanceof Error ? err.message : String(err);
      text = fallbackDraft(ctx);
      source = 'template_fallback';
    }
  } else {
    text = fallbackDraft(ctx);
    source = 'template_fallback';
  }

  // Regenerating replaces the previous unapproved draft, so only one draft per follow-up is ever open.
  return db.transaction(async (tx) => {
    const superseded = await tx.query<{ id: Uuid }>(
      `update ai_drafts set status = 'discarded' where follow_up_id = $1 and status = 'draft' returning id`,
      [followUpId],
    );
    const [draft] = await tx.query<AiDraft>(
      `insert into ai_drafts (follow_up_id, donor_id, prompt_version, source, subject, body_generated, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning ${DRAFT_COLUMNS}`,
      [followUpId, inputs.donor.id, PROMPT_VERSION, source, text.subject, text.body, staff.id],
    );
    await logActivity(tx, {
      actor: staff.id,
      action: 'ai.generate',
      entityType: 'ai_draft',
      entityId: draft.id,
      diff: {
        follow_up_id: followUpId,
        reason: ctx.reason,
        source,
        prompt_version: PROMPT_VERSION,
        model: source === 'ai' ? ai!.model : null,
        ...(superseded.length ? { replaced_draft_ids: superseded.map((d) => d.id) } : {}),
        ...(aiError ? { ai_error: aiError.slice(0, 200) } : {}),
      },
    });
    return draft;
  });
}

async function loadOpenDraft(db: Db, draftId: Uuid): Promise<AiDraft> {
  const [draft] = await db.query<AiDraft>(`select ${DRAFT_COLUMNS} from ai_drafts where id = $1`, [draftId]);
  if (!draft) throw new DraftError(404, 'NOT_FOUND', 'Draft not found');
  if (draft.status !== 'draft') throw new DraftError(409, 'DRAFT_CLOSED', `Draft is already ${draft.status}`);
  return draft;
}

/** Staff sign off on the (possibly edited) text. Nothing is sent; the UI copies it or opens mailto. */
export async function approveDraft(
  db: Db,
  draftId: Uuid,
  staff: Staff,
  edits: { subject?: string; body: string },
): Promise<AiDraft> {
  const body = edits.body?.trim();
  if (!body) throw new DraftError(400, 'BODY_REQUIRED', 'Approved text cannot be empty');
  const current = await loadOpenDraft(db, draftId);
  const subject = edits.subject?.trim() || current.subject;

  const [draft] = await db.query<AiDraft>(
    `update ai_drafts
     set subject = $2, body_final = $3, status = 'approved', approved_by = $4, approved_at = now()
     where id = $1 and status = 'draft'
     returning ${DRAFT_COLUMNS}`,
    [draftId, subject, body, staff.id],
  );
  if (!draft) throw new DraftError(409, 'DRAFT_CLOSED', 'Draft was changed by someone else');
  await logActivity(db, {
    actor: staff.id,
    action: 'ai.approve',
    entityType: 'ai_draft',
    entityId: draftId,
    diff: { edited: body !== current.body_generated || subject !== current.subject },
  });
  return draft;
}

export async function discardDraft(db: Db, draftId: Uuid, staff: Staff): Promise<AiDraft> {
  await loadOpenDraft(db, draftId);
  const [draft] = await db.query<AiDraft>(
    `update ai_drafts set status = 'discarded' where id = $1 and status = 'draft' returning ${DRAFT_COLUMNS}`,
    [draftId],
  );
  if (!draft) throw new DraftError(409, 'DRAFT_CLOSED', 'Draft was changed by someone else');
  await logActivity(db, { actor: staff.id, action: 'ai.discard', entityType: 'ai_draft', entityId: draftId });
  return draft;
}

const ENGAGEMENT_CHANNELS: EngagementChannel[] = ['email', 'call', 'whatsapp', 'meeting', 'event', 'other'];

/**
 * After staff send an approved message themselves, they mark it as sent. The exact text becomes an
 * engagement on the donor's profile (so the conversation stays with FFFA) and the follow-up is done.
 */
export async function markDraftSent(
  db: Db,
  draftId: Uuid,
  staff: Staff,
  opts: { channel?: EngagementChannel } = {},
): Promise<{ draft: AiDraft; engagement: Engagement }> {
  const channel = opts.channel ?? 'email';
  if (!ENGAGEMENT_CHANNELS.includes(channel)) {
    throw new DraftError(400, 'INVALID_CHANNEL', `Channel must be one of: ${ENGAGEMENT_CHANNELS.join(', ')}`);
  }

  return db.transaction(async (tx) => {
    const [draft] = await tx.query<AiDraft>(
      `update ai_drafts set status = 'sent', sent_at = now()
       where id = $1 and status = 'approved'
       returning ${DRAFT_COLUMNS}`,
      [draftId],
    );
    if (!draft) {
      const [existing] = await tx.query<AiDraft>('select status from ai_drafts where id = $1', [draftId]);
      if (!existing) throw new DraftError(404, 'NOT_FOUND', 'Draft not found');
      throw new DraftError(409, 'NOT_APPROVED', `Only approved drafts can be marked as sent (this one is ${existing.status})`);
    }

    const [engagement] = await tx.query<Engagement>(
      `insert into engagements
         (donor_id, follow_up_id, ai_draft_id, channel, summary, message_subject, message_body, staff_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [draft.donor_id, draft.follow_up_id, draft.id, channel, 'Sent follow-up', draft.subject, draft.body_final, staff.id],
    );
    await tx.query(
      `update follow_ups set status = 'done', completed_by = $2
       where id = $1 and status in ('pending', 'snoozed')`,
      [draft.follow_up_id, staff.id],
    );
    await logActivity(tx, {
      actor: staff.id,
      action: 'ai.sent',
      entityType: 'ai_draft',
      entityId: draft.id,
      diff: { channel, engagement_id: engagement.id, follow_up_id: draft.follow_up_id },
    });
    return { draft, engagement };
  });
}
