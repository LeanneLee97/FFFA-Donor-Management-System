-- FFFA Donor Management MVP: initial schema (design v1.1, section 3).
-- Runs unchanged on Supabase Postgres and on PGlite for local development.

create table staff (
  id          uuid primary key default gen_random_uuid(), -- = Supabase auth user id in production
  name        text not null,
  email       text not null unique,
  role        text not null default 'staff' check (role in ('staff', 'admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table donors (
  id                  uuid primary key default gen_random_uuid(),
  first_name          text,
  last_name           text,
  organisation_name   text,
  preferred_name      text,
  email               text,
  mobile              text,
  donor_type          text not null default 'individual'
                        check (donor_type in ('individual', 'corporate', 'grant_funder')),
  key_date            date,
  key_date_label      text,
  relationship_owner  uuid references staff(id),
  how_they_know_fffa  text,
  programme_interest  text[] not null default '{}',
  also_volunteers     boolean not null default false,
  next_action         text,
  next_action_due     date,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  constraint donor_has_name check (
    coalesce(first_name, last_name, organisation_name, preferred_name) is not null
  )
);

create table donations (
  id                  uuid primary key default gen_random_uuid(),
  donor_id            uuid not null references donors(id) on delete cascade,
  donated_on          date not null,
  amount_sgd          numeric(12, 2) not null check (amount_sgd > 0),
  channel             text not null default 'other'
                        check (channel in ('give_asia', 'giving_sg', 'bank', 'paynow', 'other')),
  event               text,
  is_recurring        boolean not null default false,
  monthly_amount_sgd  numeric(12, 2),
  programme           text,
  thanked             boolean not null default false,
  voided_at           timestamptz,
  void_reason         text,
  created_at          timestamptz not null default now(),
  constraint void_needs_reason check (voided_at is null or void_reason is not null)
);
create index donations_donor_idx on donations (donor_id, donated_on desc);

create table follow_ups (
  id             uuid primary key default gen_random_uuid(),
  donor_id       uuid not null references donors(id) on delete cascade,
  reason         text not null check (reason in (
                   'thank_you_due', 'cadence_due', 'lapsed', 'anniversary',
                   'key_date', 'upgrade_candidate', 'manual')),
  dedupe_key     text not null unique,
  status         text not null default 'pending'
                   check (status in ('pending', 'snoozed', 'done', 'dismissed')),
  due_on         date not null default current_date,
  snoozed_until  date,
  completed_by   uuid references staff(id),
  created_at     timestamptz not null default now()
);
create index follow_ups_status_idx on follow_ups (status, due_on);

create table engagements (
  id            uuid primary key default gen_random_uuid(),
  donor_id      uuid not null references donors(id) on delete cascade,
  follow_up_id  uuid references follow_ups(id),
  engaged_on    date not null default current_date,
  channel       text not null default 'other'
                  check (channel in ('email', 'call', 'whatsapp', 'meeting', 'event', 'other')),
  event         text,
  summary       text,
  staff_id      uuid references staff(id),
  created_at    timestamptz not null default now()
);
create index engagements_donor_idx on engagements (donor_id, engaged_on desc);

create table notes (
  id          uuid primary key default gen_random_uuid(),
  donor_id    uuid not null references donors(id) on delete cascade,
  author      uuid references staff(id),
  body        text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index notes_donor_idx on notes (donor_id, created_at desc);

create table ai_drafts (
  id              uuid primary key default gen_random_uuid(),
  follow_up_id    uuid not null references follow_ups(id) on delete cascade,
  donor_id        uuid not null references donors(id) on delete cascade,
  prompt_version  text not null,
  source          text not null check (source in ('ai', 'template_fallback')),
  subject         text not null,
  body_generated  text not null,
  body_final      text,
  status          text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  created_by      uuid references staff(id),
  approved_by     uuid references staff(id),
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table activity_log (
  id           bigint generated always as identity primary key,
  actor        uuid references staff(id),
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  diff         jsonb,
  at           timestamptz not null default now()
);
create index activity_log_entity_idx on activity_log (entity_type, entity_id, at desc);

-- Config ---------------------------------------------------------------------

create table tier_settings (
  tier               text primary key check (tier in ('bronze', 'silver', 'gold', 'diamond')),
  min_12m_giving_sgd numeric(12, 2) not null,
  cadence_days       integer not null check (cadence_days > 0),
  personal_outreach  boolean not null default false
);
insert into tier_settings values
  ('bronze',      0,  90, false),
  ('silver',   1000,  60, false),
  ('gold',     5000,  45, false),
  ('diamond', 20000,  30, true);

create table rule_settings (
  key    text primary key,
  value  integer not null
);
insert into rule_settings values
  ('thank_you_after_days', 3),
  ('lapsed_recurring_days', 45),
  ('lapsed_one_off_days', 365),
  ('key_date_window_days', 30),
  ('anniversary_window_days', 7),
  ('upgrade_same_amount_months', 12);

create table org_settings (
  key    text primary key,
  value  text not null
);
insert into org_settings values
  ('org_name', 'Free Food For All'),
  ('impact_unit_sgd', '3'),
  ('impact_unit_label', 'Ready-To-Eat meal'),
  ('signature', E'Warm regards,\nThe Free Food For All team');

-- Computed donor summary (never stored, so it can't go stale) ------------------

create view donor_summary as
with giving as (
  select donor_id,
         count(*)                                                    as donation_count,
         max(donated_on)                                             as last_donation_on,
         min(donated_on)                                             as first_donation_on,
         round(avg(amount_sgd), 2)                                   as avg_donation_sgd,
         coalesce(sum(amount_sgd) filter (where donated_on > current_date - 365), 0)
                                                                     as giving_12m_sgd,
         case when count(*) > 1
              then round((max(donated_on) - min(donated_on))::numeric / (count(*) - 1), 1)
         end                                                         as avg_days_between
  from donations
  where voided_at is null
  group by donor_id
),
last_donation as (
  select distinct on (donor_id) donor_id, amount_sgd, event
  from donations
  where voided_at is null
  order by donor_id, donated_on desc, created_at desc
),
last_engagement as (
  select distinct on (donor_id) donor_id, engaged_on, channel
  from engagements
  order by donor_id, engaged_on desc, created_at desc
)
select d.id                                              as donor_id,
       g.donation_count,
       g.first_donation_on,
       g.last_donation_on,
       ld.amount_sgd                                     as last_donation_sgd,
       ld.event                                          as last_donation_event,
       g.avg_donation_sgd,
       g.avg_days_between,
       coalesce(g.giving_12m_sgd, 0)                     as giving_12m_sgd,
       le.engaged_on                                     as last_engaged_on,
       le.channel                                        as last_engagement_channel,
       current_date - coalesce(le.engaged_on, g.first_donation_on, d.created_at::date)
                                                         as days_since_engagement,
       t.tier,
       t.cadence_days,
       t.personal_outreach
from donors d
left join giving g          on g.donor_id = d.id
left join last_donation ld  on ld.donor_id = d.id
left join last_engagement le on le.donor_id = d.id
left join lateral (
  select tier, cadence_days, personal_outreach
  from tier_settings
  where min_12m_giving_sgd <= coalesce(g.giving_12m_sgd, 0)
  order by min_12m_giving_sgd desc
  limit 1
) t on true
where d.archived_at is null;

-- The browser never talks to the database directly (design section 8).
-- With RLS on and no policies, Supabase's anon/authenticated roles can't read anything;
-- the API connects as the table owner, which bypasses RLS.
alter table staff          enable row level security;
alter table donors         enable row level security;
alter table donations      enable row level security;
alter table follow_ups     enable row level security;
alter table engagements    enable row level security;
alter table notes          enable row level security;
alter table ai_drafts      enable row level security;
alter table activity_log   enable row level security;
alter table tier_settings  enable row level security;
alter table rule_settings  enable row level security;
alter table org_settings   enable row level security;
