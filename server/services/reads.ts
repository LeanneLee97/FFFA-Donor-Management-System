import type {
  Donation,
  Donor,
  DonorProfile,
  DonorSummary,
  Engagement,
  FollowUp,
  FollowUpStatus,
  KeyDate,
  Note,
  QueueItem,
  Uuid,
} from '../../shared/types.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../lib/errors.ts';

// Read-only views used by the DM10 drafting screen. Swaraj's donor and follow-up slice extends
// these with filters and write endpoints (design section 6).

const STATUSES: FollowUpStatus[] = ['pending', 'snoozed', 'done', 'dismissed'];

/** Open follow-ups by default (pending and snoozed), oldest due first. */
export async function listFollowUps(db: Db, statusParam?: string): Promise<QueueItem[]> {
  const statuses = statusParam ? statusParam.split(',') : ['pending', 'snoozed'];
  const invalid = statuses.find((s) => !STATUSES.includes(s as FollowUpStatus));
  if (invalid) throw new HttpError(400, 'INVALID_STATUS', `Unknown status: ${invalid}`);

  return db.query<QueueItem>(
    `select f.*,
            coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), d.preferred_name, d.organisation_name) as donor_name,
            d.organisation_name,
            d.donor_type,
            coalesce(s.is_major, false) as is_major,
            k.label as key_date_label,
            (select to_jsonb(a) from ai_drafts a
              where a.follow_up_id = f.id and a.status in ('draft', 'approved')
              order by a.created_at desc limit 1) as open_draft
     from follow_ups f
     join donors d on d.id = f.donor_id and d.archived_at is null
     left join donor_summary s on s.donor_id = d.id
     left join key_dates k on k.id = f.key_date_id
     where f.status = any($1)
     order by f.due_on, f.created_at`,
    [statuses],
  );
}

export async function getDonorProfile(db: Db, donorId: Uuid): Promise<DonorProfile> {
  const [donor] = await db.query<Donor>('select * from donors where id = $1 and archived_at is null', [donorId]);
  if (!donor) throw new HttpError(404, 'NOT_FOUND', 'Donor not found');

  const [[summary], donations, engagements, notes, key_dates, follow_ups] = await Promise.all([
    db.query<DonorSummary>('select * from donor_summary where donor_id = $1', [donorId]),
    db.query<Donation>(
      'select * from donations where donor_id = $1 and voided_at is null order by donated_on desc, created_at desc limit 50',
      [donorId],
    ),
    db.query<Engagement>(
      'select * from engagements where donor_id = $1 order by engaged_on desc, created_at desc limit 50',
      [donorId],
    ),
    db.query<Note>(
      'select * from notes where donor_id = $1 and deleted_at is null order by created_at desc limit 20',
      [donorId],
    ),
    db.query<KeyDate>('select * from key_dates where donor_id = $1 order by due_on', [donorId]),
    db.query<FollowUp>(
      `select * from follow_ups where donor_id = $1 and status in ('pending', 'snoozed') order by due_on`,
      [donorId],
    ),
  ]);
  return { donor, summary: summary ?? null, donations, engagements, notes, key_dates, follow_ups };
}
