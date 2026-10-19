import type { AiDraft, Donation, Donor, DonorSummary, FollowUp, Note, Staff, Uuid } from '../../../shared/types.ts';
import type { Db } from '../../db.ts';
import { logActivity } from '../activity.ts';
import type { AiClient } from './client.ts';
import { buildDraftContext, type DraftInputs } from './context.ts';
import { fallbackDraft, type DraftText } from './fallback.ts';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from './prompts.ts';

export class DraftError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const DRAFT_COLUMNS = `id, follow_up_id, donor_id, prompt_version, source, subject, body_generated,
  body_final, status, created_by, approved_by, approved_at`;

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

  const [[summary], donations, notes, orgRows] = await Promise.all([
    db.query<DonorSummary>('select * from donor_summary where donor_id = $1', [donor.id]),
    db.query<Donation>(
      `select * from donations where donor_id = $1 and voided_at is null
       order by donated_on desc, created_at desc limit 24`,
      [donor.id],
    ),
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
    notes,
    org: {
      orgName: org.org_name ?? 'Free Food For All',
      impactUnitSgd: Number(org.impact_unit_sgd ?? 0),
      impactUnitLabel: org.impact_unit_label ?? 'meal',
      signature: org.signature ?? 'The Free Food For All team',
    },
    today: new Date().toISOString().slice(0, 10),
  };
}

/** DM10: generate a draft for a follow-up. AI if available, otherwise the reason's template. */
export async function createDraft(db: Db, ai: AiClient | null, followUpId: Uuid, staff: Staff): Promise<AiDraft> {
  const inputs = await loadInputs(db, followUpId);
  if (inputs.summary?.personal_outreach) {
    // PRD: major donors get personal outreach from staff, never an AI draft.
    throw new DraftError(422, 'PERSONAL_OUTREACH', 'This donor gets personal outreach; AI drafts are disabled');
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

  const [draft] = await db.query<AiDraft>(
    `insert into ai_drafts (follow_up_id, donor_id, prompt_version, source, subject, body_generated, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${DRAFT_COLUMNS}`,
    [followUpId, inputs.donor.id, PROMPT_VERSION, source, text.subject, text.body, staff.id],
  );
  await logActivity(db, {
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
      ...(aiError ? { ai_error: aiError.slice(0, 200) } : {}),
    },
  });
  return draft;
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
