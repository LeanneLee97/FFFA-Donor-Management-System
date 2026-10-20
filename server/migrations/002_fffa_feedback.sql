-- FFFA feedback of 20 Oct 2026 (design v1.2, section 3).

-- The view reads columns renamed below; it is recreated at the end.
drop view donor_summary;

-- Donors: organisation contact person and staff "major" tag --------------------

alter table donors add column contact_title text;
alter table donors add column major_override boolean not null default false;

-- Key dates: several per donor (grant report, renewal, sponsorship expiry) ------

create table key_dates (
  id            uuid primary key default gen_random_uuid(),
  donor_id      uuid not null references donors(id) on delete cascade,
  kind          text not null default 'other'
                  check (kind in ('sponsorship_expiry', 'grant_report', 'grant_renewal', 'other')),
  due_on        date not null,
  label         text,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index key_dates_due_idx on key_dates (due_on) where completed_at is null;
alter table key_dates enable row level security;

insert into key_dates (donor_id, due_on, label)
select id, key_date, key_date_label from donors where key_date is not null;

alter table donors drop column key_date;
alter table donors drop column key_date_label;

-- Donations: campaign, in-kind, payment status, platform reference --------------

alter table donations rename column event to campaign;
alter table donations add column kind text not null default 'cash' check (kind in ('cash', 'in_kind'));
alter table donations add column in_kind_description text;
alter table donations add column estimated_value_sgd numeric(12, 2) check (estimated_value_sgd >= 0);
alter table donations add column external_ref text;
alter table donations add column payment_status text not null default 'succeeded'
  check (payment_status in ('succeeded', 'failed'));

alter table donations drop constraint donations_amount_sgd_check;
alter table donations alter column amount_sgd drop not null;
alter table donations add constraint donation_has_value check (
  (kind = 'cash' and amount_sgd > 0) or (kind = 'in_kind' and in_kind_description is not null)
);

alter table donations drop constraint donations_channel_check;
alter table donations add constraint donations_channel_check
  check (channel in ('give_asia', 'giving_sg', 'bank', 'paynow', 'in_person', 'other'));

-- Re-importing the same platform export never double-counts (design section 6).
create unique index donations_external_ref_idx on donations (channel, external_ref) where external_ref is not null;

-- Follow-ups: failed payments and links to key dates ----------------------------

alter table follow_ups drop constraint follow_ups_reason_check;
alter table follow_ups add constraint follow_ups_reason_check check (reason in (
  'thank_you_due', 'failed_payment', 'cadence_due', 'lapsed', 'anniversary',
  'key_date', 'upgrade_candidate', 'manual'));
alter table follow_ups add column key_date_id uuid references key_dates(id) on delete cascade;

-- Engagements keep the message that was actually sent ---------------------------

alter table engagements rename column event to campaign;
alter table engagements add column ai_draft_id uuid references ai_drafts(id);
alter table engagements add column message_subject text;
alter table engagements add column message_body text;

-- AI drafts: approved → sent ------------------------------------------------------

alter table ai_drafts drop constraint ai_drafts_status_check;
alter table ai_drafts add constraint ai_drafts_status_check
  check (status in ('draft', 'approved', 'sent', 'discarded'));
alter table ai_drafts add column sent_at timestamptz;

-- Settings ---------------------------------------------------------------------

-- "Major" is now its own rule (below), separate from tiers.
alter table tier_settings drop column personal_outreach;

update rule_settings set value = 180 where key = 'lapsed_one_off_days';
insert into rule_settings values ('failed_payment_window_days', 7);

update org_settings set value = '10' where key = 'impact_unit_sgd';
delete from org_settings where key = 'impact_unit_label';
insert into org_settings values
  ('impact_unit_singular', 'meal for an elderly person'),
  ('impact_unit_plural', 'meals for elderly people'),
  ('major_min_12m_sgd', '5000'),
  ('major_min_years', '3');

-- Computed donor summary --------------------------------------------------------
-- Cash, successful, non-voided gifts count towards totals, tiers and "major".
-- Tenure counts from the first successful gift of any kind.

create view donor_summary as
with cash as (
  select donor_id,
         count(*)                                                    as donation_count,
         max(donated_on)                                             as last_donation_on,
         round(avg(amount_sgd), 2)                                   as avg_donation_sgd,
         coalesce(sum(amount_sgd) filter (where donated_on > current_date - 365), 0)
                                                                     as giving_12m_sgd,
         case when count(*) > 1
              then round((max(donated_on) - min(donated_on))::numeric / (count(*) - 1), 1)
         end                                                         as avg_days_between
  from donations
  where voided_at is null and payment_status = 'succeeded' and kind = 'cash'
  group by donor_id
),
any_gift as (
  select donor_id, min(donated_on) as first_donation_on, count(*) filter (where kind = 'in_kind') as in_kind_count
  from donations
  where voided_at is null and payment_status = 'succeeded'
  group by donor_id
),
last_donation as (
  select distinct on (donor_id) donor_id, amount_sgd, campaign
  from donations
  where voided_at is null and payment_status = 'succeeded' and kind = 'cash'
  order by donor_id, donated_on desc, created_at desc
),
last_engagement as (
  select distinct on (donor_id) donor_id, engaged_on, channel
  from engagements
  order by donor_id, engaged_on desc, created_at desc
),
major as (
  select (select value::numeric from org_settings where key = 'major_min_12m_sgd') as min_12m,
         (select value::int from org_settings where key = 'major_min_years') as min_years
)
select d.id                                              as donor_id,
       coalesce(c.donation_count, 0)                     as donation_count,
       g.first_donation_on,
       c.last_donation_on,
       ld.amount_sgd                                     as last_donation_sgd,
       ld.campaign                                       as last_donation_campaign,
       c.avg_donation_sgd,
       c.avg_days_between,
       coalesce(c.giving_12m_sgd, 0)                     as giving_12m_sgd,
       coalesce(g.in_kind_count, 0)                      as in_kind_count,
       case when g.first_donation_on is not null
            then floor((current_date - g.first_donation_on) / 365.25)::int
            else 0 end                                   as years_with_fffa,
       le.engaged_on                                     as last_engaged_on,
       le.channel                                        as last_engagement_channel,
       current_date - coalesce(le.engaged_on, g.first_donation_on, d.created_at::date)
                                                         as days_since_engagement,
       t.tier,
       t.cadence_days,
       (d.major_override
         or coalesce(c.giving_12m_sgd, 0) >= m.min_12m
         or g.first_donation_on <= (current_date - make_interval(years => m.min_years))::date
       ) is true                                         as is_major
from donors d
cross join major m
left join cash c             on c.donor_id = d.id
left join any_gift g         on g.donor_id = d.id
left join last_donation ld   on ld.donor_id = d.id
left join last_engagement le on le.donor_id = d.id
left join lateral (
  select tier, cadence_days
  from tier_settings
  where min_12m_giving_sgd <= coalesce(c.giving_12m_sgd, 0)
  order by min_12m_giving_sgd desc
  limit 1
) t on true
where d.archived_at is null;
