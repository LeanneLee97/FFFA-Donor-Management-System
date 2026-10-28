import type {
  Engagement,
  EngagementChannel,
  FollowUp,
  IsoDate,
  Staff,
  Uuid,
} from '../../shared/types.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import { logActivity } from './activity.ts';
import { runRulesEngine } from './rules/engine.ts';
import { daysBetween, toIsoDateString } from './rules/rules.ts';

const VALID_ENGAGEMENT_CHANNELS: EngagementChannel[] = [
  'email',
  'call',
  'whatsapp',
  'meeting',
  'event',
  'other',
];

export interface CompleteFollowUpInput {
  channel?: EngagementChannel;
  engaged_on?: IsoDate;
  campaign?: string | null;
  summary?: string;
  message_subject?: string | null;
  message_body?: string | null;
  mark_key_date_done?: boolean;
}

export interface SnoozeFollowUpInput {
  until: IsoDate;
}

export interface DismissFollowUpInput {
  reason?: string;
}

export async function refreshQueue(
  db: Db,
  staff: Staff,
  today?: IsoDate,
): Promise<{ evaluated: number; created: number; awakened: number }> {
  const todayStr = today ? toIsoDateString(today) : new Date().toISOString().slice(0, 10);

  // 1. Wake up any snoozed follow-ups whose snooze duration has arrived or passed
  const awakened = await db.query<{ id: string }>(
    `update follow_ups
     set status = 'pending', snoozed_until = null
     where status = 'snoozed' and snoozed_until <= $1::date
     returning id`,
    [todayStr],
  );

  // 2. Run rules engine to evaluate active donors and insert new candidates
  const engineResult = await runRulesEngine(db, todayStr);

  await logActivity(db, {
    actor: staff.id,
    action: 'followup.refresh',
    entityType: 'follow_up',
    entityId: null,
    diff: {
      evaluated: engineResult.evaluated,
      created: engineResult.created,
      awakened: awakened.length,
    },
  });

  return {
    evaluated: engineResult.evaluated,
    created: engineResult.created,
    awakened: awakened.length,
  };
}

export async function completeFollowUp(
  db: Db,
  followUpId: Uuid,
  staff: Staff,
  input: CompleteFollowUpInput = {},
): Promise<{ follow_up: FollowUp; engagement: Engagement }> {
  const channel = input.channel ?? 'other';
  if (!VALID_ENGAGEMENT_CHANNELS.includes(channel)) {
    throw new HttpError(
      400,
      'INVALID_CHANNEL',
      `Channel must be one of: ${VALID_ENGAGEMENT_CHANNELS.join(', ')}`,
    );
  }

  const engagedOn = input.engaged_on ? toIsoDateString(input.engaged_on) : new Date().toISOString().slice(0, 10);

  return db.transaction(async (tx) => {
    const [followUp] = await tx.query<FollowUp>('select * from follow_ups where id = $1', [followUpId]);
    if (!followUp) throw new HttpError(404, 'NOT_FOUND', 'Follow-up not found');
    if (followUp.status === 'done') throw new HttpError(400, 'ALREADY_COMPLETED', 'Follow-up is already completed');

    const summary = input.summary?.trim() || `Follow-up completed: ${followUp.reason.replace(/_/g, ' ')}`;

    // 1. Record engagement touchpoint (resets cadence clock on donor_summary view)
    const [engagement] = await tx.query<Engagement>(
      `insert into engagements (
        donor_id, follow_up_id, engaged_on, channel, campaign, summary,
        message_subject, message_body, staff_id
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning *`,
      [
        followUp.donor_id,
        followUp.id,
        engagedOn,
        channel,
        input.campaign?.trim() || null,
        summary,
        input.message_subject?.trim() || null,
        input.message_body || null,
        staff.id,
      ],
    );

    // 2. Mark follow_up done
    const [updatedFollowUp] = await tx.query<FollowUp>(
      `update follow_ups
       set status = 'done', completed_by = $2
       where id = $1
       returning *`,
      [followUpId, staff.id],
    );

    // 3. Mark key date complete if linked and requested (or default for key_date reasons)
    if (followUp.key_date_id && input.mark_key_date_done !== false) {
      await tx.query(
        'update key_dates set completed_at = now() where id = $1 and completed_at is null',
        [followUp.key_date_id],
      );
    }

    // 4. If thank_you_due, mark the corresponding donation thanked
    if (followUp.reason === 'thank_you_due' && followUp.dedupe_key.includes('|thank_you|')) {
      const donationId = followUp.dedupe_key.split('|thank_you|')[1];
      if (donationId) {
        await tx.query('update donations set thanked = true where id = $1 and thanked = false', [
          donationId,
        ]);
      }
    }

    // 5. Audit log
    await logActivity(tx, {
      actor: staff.id,
      action: 'followup.complete',
      entityType: 'follow_up',
      entityId: followUpId,
      diff: {
        reason: followUp.reason,
        channel,
        engagement_id: engagement.id,
        donor_id: followUp.donor_id,
      },
    });

    return { follow_up: updatedFollowUp, engagement };
  });
}

export async function snoozeFollowUp(
  db: Db,
  followUpId: Uuid,
  staff: Staff,
  input: SnoozeFollowUpInput,
): Promise<FollowUp> {
  if (!input.until) throw new HttpError(400, 'INVALID_SNOOZE_DATE', 'until date is required');

  const todayStr = new Date().toISOString().slice(0, 10);
  const untilStr = toIsoDateString(input.until);

  if (daysBetween(todayStr, untilStr) <= 0) {
    throw new HttpError(400, 'INVALID_SNOOZE_DATE', 'Snooze date must be in the future');
  }

  return db.transaction(async (tx) => {
    const [followUp] = await tx.query<FollowUp>('select * from follow_ups where id = $1', [followUpId]);
    if (!followUp) throw new HttpError(404, 'NOT_FOUND', 'Follow-up not found');
    if (followUp.status === 'done') throw new HttpError(400, 'CANNOT_SNOOZE', 'Cannot snooze a completed follow-up');
    if (followUp.status === 'dismissed') {
      throw new HttpError(400, 'CANNOT_SNOOZE', 'Cannot snooze a dismissed follow-up');
    }

    const [updated] = await tx.query<FollowUp>(
      `update follow_ups
       set status = 'snoozed', snoozed_until = $2
       where id = $1
       returning *`,
      [followUpId, untilStr],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'followup.snooze',
      entityType: 'follow_up',
      entityId: followUpId,
      diff: { until: untilStr, previous_status: followUp.status },
    });

    return updated;
  });
}

export async function dismissFollowUp(
  db: Db,
  followUpId: Uuid,
  staff: Staff,
  input: DismissFollowUpInput = {},
): Promise<FollowUp> {
  return db.transaction(async (tx) => {
    const [followUp] = await tx.query<FollowUp>('select * from follow_ups where id = $1', [followUpId]);
    if (!followUp) throw new HttpError(404, 'NOT_FOUND', 'Follow-up not found');
    if (followUp.status === 'done') {
      throw new HttpError(400, 'CANNOT_DISMISS', 'Cannot dismiss a completed follow-up');
    }

    const [updated] = await tx.query<FollowUp>(
      `update follow_ups
       set status = 'dismissed'
       where id = $1
       returning *`,
      [followUpId],
    );

    await logActivity(tx, {
      actor: staff.id,
      action: 'followup.dismiss',
      entityType: 'follow_up',
      entityId: followUpId,
      diff: { reason: input.reason?.trim() || null },
    });

    return updated;
  });
}
