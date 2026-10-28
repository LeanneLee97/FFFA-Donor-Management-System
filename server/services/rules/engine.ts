import type { IsoDate } from '../../../shared/types.ts';
import type { Db } from '../../db.ts';
import { getSettings, type Settings } from '../settings.ts';
import { ALL_RULES } from './rules.ts';
import type { DonorRuleContext, FollowUpCandidate } from './types.ts';
import type {
  Donation,
  Donor,
  DonorSummary,
  Engagement,
  FollowUp,
  KeyDate,
} from '../../../shared/types.ts';

/** Pure evaluation of all 7 follow-up rules for a single donor context. */
export function evaluateDonorRules(
  context: DonorRuleContext,
  settings: Settings,
  today: IsoDate,
): FollowUpCandidate[] {
  const candidates: FollowUpCandidate[] = [];
  for (const rule of ALL_RULES) {
    const matches = rule(context, settings, today);
    candidates.push(...matches);
  }
  return candidates;
}

/**
 * Runs the follow-up rules engine across all active donors in the database.
 * Upserts candidates into the follow_ups table using on conflict (dedupe_key) do nothing.
 * Returns how many donors were evaluated and how many new follow-ups were materialized.
 */
export async function runRulesEngine(
  db: Db,
  todayInput?: IsoDate,
): Promise<{ evaluated: number; created: number }> {
  const today = todayInput ?? new Date().toISOString().slice(0, 10);
  const settings = await getSettings(db);

  const donors = await db.query<Donor>('select * from donors where archived_at is null');
  if (donors.length === 0) return { evaluated: 0, created: 0 };

  const [summaries, donations, keyDates, engagements, followUps] = await Promise.all([
    db.query<DonorSummary>('select * from donor_summary'),
    db.query<Donation>('select * from donations where voided_at is null order by donated_on desc'),
    db.query<KeyDate>('select * from key_dates where completed_at is null order by due_on asc'),
    db.query<Engagement>('select * from engagements order by engaged_on desc'),
    db.query<FollowUp>('select * from follow_ups'),
  ]);

  const summaryByDonor = new Map(summaries.map((s) => [s.donor_id, s]));
  const donationsByDonor = new Map<string, Donation[]>();
  for (const d of donations) {
    const list = donationsByDonor.get(d.donor_id) ?? [];
    list.push(d);
    donationsByDonor.set(d.donor_id, list);
  }
  const keyDatesByDonor = new Map<string, KeyDate[]>();
  for (const kd of keyDates) {
    const list = keyDatesByDonor.get(kd.donor_id) ?? [];
    list.push(kd);
    keyDatesByDonor.set(kd.donor_id, list);
  }
  const engagementsByDonor = new Map<string, Engagement[]>();
  for (const e of engagements) {
    const list = engagementsByDonor.get(e.donor_id) ?? [];
    list.push(e);
    engagementsByDonor.set(e.donor_id, list);
  }
  const followUpsByDonor = new Map<string, FollowUp[]>();
  for (const f of followUps) {
    const list = followUpsByDonor.get(f.donor_id) ?? [];
    list.push(f);
    followUpsByDonor.set(f.donor_id, list);
  }

  const allCandidates: FollowUpCandidate[] = [];

  for (const donor of donors) {
    const context: DonorRuleContext = {
      donor,
      summary: summaryByDonor.get(donor.id) ?? null,
      donations: donationsByDonor.get(donor.id) ?? [],
      key_dates: keyDatesByDonor.get(donor.id) ?? [],
      engagements: engagementsByDonor.get(donor.id) ?? [],
      follow_ups: followUpsByDonor.get(donor.id) ?? [],
    };

    const candidates = evaluateDonorRules(context, settings, today);
    allCandidates.push(...candidates);
  }

  let createdCount = 0;
  if (allCandidates.length > 0) {
    await db.transaction(async (tx) => {
      for (const c of allCandidates) {
        const res = await tx.query<{ id: string }>(
          `insert into follow_ups (donor_id, reason, dedupe_key, due_on, key_date_id, status)
           values ($1, $2, $3, $4, $5, 'pending')
           on conflict (dedupe_key) do nothing
           returning id`,
          [c.donor_id, c.reason, c.dedupe_key, c.due_on, c.key_date_id ?? null],
        );
        if (res.length > 0) createdCount++;
      }
    });
  }

  return { evaluated: donors.length, created: createdCount };
}
