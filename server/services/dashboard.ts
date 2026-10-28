import type { Dashboard } from '../../shared/types.ts';
import type { Db } from '../db.ts';


/** DM5: aggregates only (no donor names or contact details), so it is safe to show on screen. */
export async function getDashboard(db: Db): Promise<Dashboard> {
  const [[donors], [giving], [recurring], tiers, followUps, months, campaigns, [ai]] = await Promise.all([
    db.query<Dashboard['donors']>(
      `select count(*)::int as total,
              count(*) filter (where s.last_donation_on >= current_date - 365)::int as active_12m,
              count(*) filter (where s.is_major)::int as major,
              count(*) filter (where exists (
                select 1 from donations x where x.donor_id = d.id and x.is_recurring and x.voided_at is null
                  and x.payment_status = 'succeeded' and x.donated_on >= current_date - 45))::int as recurring
       from donors d join donor_summary s on s.donor_id = d.id
       where d.archived_at is null`,
    ),
    db.query<{ total: number }>(
      `select coalesce(sum(s.giving_12m_sgd), 0)::float as total
       from donor_summary s join donors d on d.id = s.donor_id where d.archived_at is null`,
    ),
    // Each recurring donor's latest monthly amount, if they gave in the last 45 days.
    db.query<{ total: number }>(
      `select coalesce(sum(monthly), 0)::float as total from (
         select distinct on (x.donor_id) coalesce(x.monthly_amount_sgd, x.amount_sgd) as monthly
         from donations x join donors d on d.id = x.donor_id
         where d.archived_at is null and x.is_recurring and x.voided_at is null
           and x.payment_status = 'succeeded' and x.donated_on >= current_date - 45
         order by x.donor_id, x.donated_on desc) r`,
    ),
    db.query<{ tier: string; donors: number }>(
      `select s.tier, count(*)::int as donors
       from donor_summary s join donors d on d.id = s.donor_id join tier_settings t on t.tier = s.tier
       where d.archived_at is null group by s.tier, t.min_12m_giving_sgd order by t.min_12m_giving_sgd desc`,
    ),
    db.query<{ reason: string; pending: number }>(
      `select reason, count(*)::int as pending from follow_ups
       where status = 'pending' group by reason order by pending desc, reason`,
    ),
    db.query<Dashboard['months'][number]>(
      `with m as (
         select to_char(gs, 'YYYY-MM') as month
         from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') gs
       )
       select m.month,
              coalesce((select sum(amount_sgd) from donations where kind = 'cash' and voided_at is null
                          and payment_status = 'succeeded' and to_char(donated_on, 'YYYY-MM') = m.month), 0)::float as donations_sgd,
              (select count(*) from donations where voided_at is null and payment_status = 'succeeded'
                 and to_char(donated_on, 'YYYY-MM') = m.month)::int as donations,
              (select count(*) from engagements where to_char(engaged_on, 'YYYY-MM') = m.month)::int as engagements
       from m order by m.month`,
    ),
    db.query<Dashboard['campaigns'][number]>(
      `select coalesce(campaign, 'No campaign') as campaign, sum(amount_sgd)::float as donations_sgd,
              count(distinct donor_id)::int as donors
       from donations
       where kind = 'cash' and voided_at is null and payment_status = 'succeeded' and donated_on >= current_date - 365
       group by 1 order by donations_sgd desc limit 8`,
    ),
    db.query<Dashboard['ai']>(
      `select count(*) filter (where created_at >= now() - interval '30 days')::int as drafted_30d,
              count(*) filter (where status = 'sent' and sent_at >= now() - interval '30 days')::int as sent_30d
       from ai_drafts`,
    ),
  ]);
  return {
    donors,
    giving_12m_sgd: giving.total,
    monthly_recurring_sgd: recurring.total,
    tiers,
    follow_ups: followUps,
    months,
    campaigns,
    ai,
  };
}

export interface ActivityEntry {
  id: number;
  at: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  diff: Record<string, unknown> | null;
}

/** DM7: latest activity, newest first. Optionally filtered to one entity type. */
export async function listActivity(db: Db, entityType?: string, limit = 50): Promise<ActivityEntry[]> {
  return db.query<ActivityEntry>(
    `select a.id, a.at, s.name as actor_name, a.action, a.entity_type, a.entity_id, a.diff
     from activity_log a left join staff s on s.id = a.actor
     where ($1::text is null or a.entity_type = $1)
     order by a.id desc limit $2`,
    [entityType ?? null, Math.min(Math.max(limit, 1), 200)],
  );
}
