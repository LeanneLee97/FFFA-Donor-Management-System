import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  Donation,
  Donor,
  DonorSummary,
  FollowUp,
  KeyDate,
} from '../../../shared/types.ts';
import { createDb, migrate, type Db } from '../../db.ts';
import { getSettings, type Settings } from '../settings.ts';
import { runRulesEngine } from './engine.ts';
import {
  daysBetween,
  monthsBetween,
  ruleAnniversary,
  ruleCadenceDue,
  ruleFailedPayment,
  ruleKeyDate,
  ruleLapsed,
  ruleThankYouDue,
  ruleUpgradeCandidate,
  subtractMonths,
} from './rules.ts';
import type { DonorRuleContext } from './types.ts';

const TODAY = '2026-10-28';

const DEFAULT_SETTINGS: Settings = {
  rules: {
    thank_you_after_days: 3,
    lapsed_recurring_days: 45,
    lapsed_one_off_days: 180,
    key_date_window_days: 30,
    anniversary_window_days: 7,
    upgrade_same_amount_months: 12,
    failed_payment_window_days: 7,
  },
  tiers: [
    { tier: 'bronze', min_12m_giving_sgd: 0, cadence_days: 90 },
    { tier: 'silver', min_12m_giving_sgd: 1000, cadence_days: 60 },
    { tier: 'gold', min_12m_giving_sgd: 5000, cadence_days: 45 },
    { tier: 'diamond', min_12m_giving_sgd: 20000, cadence_days: 30 },
  ],
  org: {
    impact_unit_sgd: '10',
    major_min_12m_sgd: '5000',
    major_min_years: '3',
  },
};

function makeDonor(id = 'd1', overrides: Partial<Donor> = {}): Donor {
  return {
    id,
    donor_type: 'individual',
    organisation_name: null,
    first_name: 'Test',
    last_name: 'Donor',
    contact_title: null,
    preferred_name: null,
    email: 'test@fffa.test',
    mobile: null,
    relationship_owner: null,
    how_they_know_fffa: null,
    programme_interest: [],
    also_volunteers: false,
    major_override: false,
    next_action: null,
    next_action_due: null,
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeContext(overrides: Partial<DonorRuleContext> = {}): DonorRuleContext {
  return {
    donor: makeDonor(),
    summary: null,
    donations: [],
    key_dates: [],
    engagements: [],
    follow_ups: [],
    ...overrides,
  };
}

describe('date helper functions', () => {
  it('computes daysBetween accurately', () => {
    expect(daysBetween('2026-10-25', '2026-10-28')).toBe(3);
    expect(daysBetween('2026-10-28', '2026-10-25')).toBe(-3);
    expect(daysBetween('2026-10-28', '2026-10-28')).toBe(0);
  });

  it('computes monthsBetween and subtractMonths accurately', () => {
    expect(monthsBetween('2025-10-28', '2026-10-28')).toBe(12);
    expect(monthsBetween('2026-04-15', '2026-10-28')).toBe(6);
    expect(subtractMonths('2026-10-28', 12)).toBe('2025-10-28');
    expect(subtractMonths('2026-03-31', 1)).toBe('2026-02-28');
  });
});

describe('pure rule functions', () => {
  describe('ruleThankYouDue', () => {
    it('fires when a donation is unthanked and >= 3 days old', () => {
      const ctx = makeContext({
        donations: [
          {
            id: 'don-1',
            donor_id: 'd1',
            donated_on: '2026-10-24', // 4 days ago
            kind: 'cash',
            amount_sgd: 100,
            in_kind_description: null,
            estimated_value_sgd: null,
            channel: 'paynow',
            external_ref: null,
            campaign: null,
            is_recurring: false,
            monthly_amount_sgd: null,
            payment_status: 'succeeded',
            programme: 'RTE',
            thanked: false,
            voided_at: null,
            void_reason: null,
          },
        ],
      });

      const candidates = ruleThankYouDue(ctx, DEFAULT_SETTINGS, TODAY);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toBe('thank_you_due');
      expect(candidates[0].dedupe_key).toBe('donor:d1|thank_you|don-1');
    });

    it('does not fire when donation is < 3 days old or already thanked or voided', () => {
      const ctx = makeContext({
        donations: [
          {
            id: 'don-2',
            donor_id: 'd1',
            donated_on: '2026-10-27', // 1 day ago
            kind: 'cash',
            amount_sgd: 100,
            in_kind_description: null,
            estimated_value_sgd: null,
            channel: 'paynow',
            external_ref: null,
            campaign: null,
            is_recurring: false,
            monthly_amount_sgd: null,
            payment_status: 'succeeded',
            programme: null,
            thanked: false,
            voided_at: null,
            void_reason: null,
          },
          {
            id: 'don-3',
            donor_id: 'd1',
            donated_on: '2026-10-20',
            kind: 'cash',
            amount_sgd: 100,
            in_kind_description: null,
            estimated_value_sgd: null,
            channel: 'paynow',
            external_ref: null,
            campaign: null,
            is_recurring: false,
            monthly_amount_sgd: null,
            payment_status: 'succeeded',
            programme: null,
            thanked: true,
            voided_at: null,
            void_reason: null,
          },
        ],
      });

      expect(ruleThankYouDue(ctx, DEFAULT_SETTINGS, TODAY)).toHaveLength(0);
    });
  });

  describe('ruleFailedPayment', () => {
    it('fires within 7 days of recurring payment failure', () => {
      const ctx = makeContext({
        donations: [
          {
            id: 'fail-1',
            donor_id: 'd1',
            donated_on: '2026-10-26', // 2 days ago
            kind: 'cash',
            amount_sgd: 30,
            in_kind_description: null,
            estimated_value_sgd: null,
            channel: 'give_asia',
            external_ref: null,
            campaign: null,
            is_recurring: true,
            monthly_amount_sgd: 30,
            payment_status: 'failed',
            programme: null,
            thanked: false,
            voided_at: null,
            void_reason: null,
          },
        ],
      });

      const candidates = ruleFailedPayment(ctx, DEFAULT_SETTINGS, TODAY);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toBe('failed_payment');
      expect(candidates[0].dedupe_key).toBe('donor:d1|failed_payment|fail-1');
    });

    it('does not fire if failure is older than 7 days', () => {
      const ctx = makeContext({
        donations: [
          {
            id: 'fail-old',
            donor_id: 'd1',
            donated_on: '2026-10-15', // 13 days ago
            kind: 'cash',
            amount_sgd: 30,
            in_kind_description: null,
            estimated_value_sgd: null,
            channel: 'give_asia',
            external_ref: null,
            campaign: null,
            is_recurring: true,
            monthly_amount_sgd: 30,
            payment_status: 'failed',
            programme: null,
            thanked: false,
            voided_at: null,
            void_reason: null,
          },
        ],
      });

      expect(ruleFailedPayment(ctx, DEFAULT_SETTINGS, TODAY)).toHaveLength(0);
    });
  });

  describe('ruleKeyDate', () => {
    it('fires when key date is due within 30 days and incomplete', () => {
      const ctx = makeContext({
        key_dates: [
          {
            id: 'kd-1',
            donor_id: 'd1',
            kind: 'grant_report',
            due_on: '2026-11-15', // 18 days away
            label: 'Annual Impact Report',
            completed_at: null,
          },
        ],
      });

      const candidates = ruleKeyDate(ctx, DEFAULT_SETTINGS, TODAY);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toBe('key_date');
      expect(candidates[0].key_date_id).toBe('kd-1');
      expect(candidates[0].dedupe_key).toBe('keydate:kd-1');
    });

    it('does not fire if key date is completed or > 30 days away', () => {
      const ctx = makeContext({
        key_dates: [
          {
            id: 'kd-far',
            donor_id: 'd1',
            kind: 'grant_report',
            due_on: '2026-12-31', // > 60 days
            label: 'Far Report',
            completed_at: null,
          },
          {
            id: 'kd-done',
            donor_id: 'd1',
            kind: 'sponsorship_expiry',
            due_on: '2026-11-05',
            label: 'Done Renewal',
            completed_at: '2026-10-20T00:00:00Z',
          },
        ],
      });

      expect(ruleKeyDate(ctx, DEFAULT_SETTINGS, TODAY)).toHaveLength(0);
    });
  });

  describe('ruleCadenceDue', () => {
    it('fires when days since last engagement exceeds tier cadence', () => {
      const ctx = makeContext({
        summary: {
          donor_id: 'd1',
          donation_count: 5,
          first_donation_on: '2025-01-01',
          last_donation_on: '2026-05-01',
          last_donation_sgd: 1000,
          last_donation_campaign: null,
          avg_donation_sgd: 1000,
          avg_days_between: 30,
          giving_12m_sgd: 5000,
          in_kind_count: 0,
          years_with_fffa: 1,
          last_engaged_on: '2026-09-01', // 57 days ago
          last_engagement_channel: 'email',
          days_since_engagement: 57,
          tier: 'gold',
          cadence_days: 45, // cadence is 45 days
          is_major: true,
        },
      });

      const candidates = ruleCadenceDue(ctx, DEFAULT_SETTINGS, TODAY);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toBe('cadence_due');
      expect(candidates[0].dedupe_key).toBe('donor:d1|cadence|2026-09-01');
    });
  });

  describe('ruleLapsed', () => {
    it('fires for one-off donors with no gift in >= 180 days', () => {
      const ctx = makeContext({
        summary: {
          donor_id: 'd1',
          donation_count: 1,
          first_donation_on: '2026-04-01',
          last_donation_on: '2026-04-01', // 210 days ago (> 180)
          last_donation_sgd: 50,
          last_donation_campaign: null,
          avg_donation_sgd: 50,
          avg_days_between: null,
          giving_12m_sgd: 50,
          in_kind_count: 0,
          years_with_fffa: 0,
          last_engaged_on: null,
          last_engagement_channel: null,
          days_since_engagement: 210,
          tier: 'bronze',
          cadence_days: 90,
          is_major: false,
        },
        donations: [
          {
            id: 'oneoff-1',
            donor_id: 'd1',
            donated_on: '2026-04-01',
            kind: 'cash',
            amount_sgd: 50,
            in_kind_description: null,
            estimated_value_sgd: null,
            channel: 'give_asia',
            external_ref: null,
            campaign: null,
            is_recurring: false,
            monthly_amount_sgd: null,
            payment_status: 'succeeded',
            programme: null,
            thanked: true,
            voided_at: null,
            void_reason: null,
          },
        ],
      });

      const candidates = ruleLapsed(ctx, DEFAULT_SETTINGS, TODAY);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toBe('lapsed');
      expect(candidates[0].dedupe_key).toBe('donor:d1|lapsed|2026-10');
    });

    it('fires for recurring donors with no gift in >= 45 days', () => {
      const ctx = makeContext({
        summary: {
          donor_id: 'd1',
          donation_count: 3,
          first_donation_on: '2026-01-01',
          last_donation_on: '2026-09-10', // 48 days ago (> 45)
          last_donation_sgd: 20,
          last_donation_campaign: null,
          avg_donation_sgd: 20,
          avg_days_between: 30,
          giving_12m_sgd: 60,
          in_kind_count: 0,
          years_with_fffa: 0,
          last_engaged_on: null,
          last_engagement_channel: null,
          days_since_engagement: 48,
          tier: 'bronze',
          cadence_days: 90,
          is_major: false,
        },
        donations: [
          {
            id: 'rec-1',
            donor_id: 'd1',
            donated_on: '2026-09-10',
            kind: 'cash',
            amount_sgd: 20,
            in_kind_description: null,
            estimated_value_sgd: null,
            channel: 'giving_sg',
            external_ref: null,
            campaign: null,
            is_recurring: true,
            monthly_amount_sgd: 20,
            payment_status: 'succeeded',
            programme: null,
            thanked: true,
            voided_at: null,
            void_reason: null,
          },
        ],
      });

      const candidates = ruleLapsed(ctx, DEFAULT_SETTINGS, TODAY);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toBe('lapsed');
    });
  });

  describe('ruleAnniversary', () => {
    it('fires when first donation anniversary is within 7 days', () => {
      const ctx = makeContext({
        summary: {
          donor_id: 'd1',
          donation_count: 2,
          first_donation_on: '2024-11-02', // 2 years ago, anniversary in 5 days
          last_donation_on: '2026-10-01',
          last_donation_sgd: 15,
          last_donation_campaign: null,
          avg_donation_sgd: 15,
          avg_days_between: 700,
          giving_12m_sgd: 15,
          in_kind_count: 0,
          years_with_fffa: 2,
          last_engaged_on: null,
          last_engagement_channel: null,
          days_since_engagement: 27,
          tier: 'bronze',
          cadence_days: 90,
          is_major: false,
        },
      });

      const candidates = ruleAnniversary(ctx, DEFAULT_SETTINGS, TODAY);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toBe('anniversary');
      expect(candidates[0].due_on).toBe('2026-11-02');
      expect(candidates[0].dedupe_key).toBe('donor:d1|anniversary|2026');
    });

    it('does not fire if donor has been with FFFA for less than 1 year', () => {
      const ctx = makeContext({
        summary: {
          donor_id: 'd1',
          donation_count: 1,
          first_donation_on: '2026-05-01', // only 5 months ago
          last_donation_on: '2026-05-01',
          last_donation_sgd: 50,
          last_donation_campaign: null,
          avg_donation_sgd: 50,
          avg_days_between: null,
          giving_12m_sgd: 50,
          in_kind_count: 0,
          years_with_fffa: 0,
          last_engaged_on: null,
          last_engagement_channel: null,
          days_since_engagement: 180,
          tier: 'bronze',
          cadence_days: 90,
          is_major: false,
        },
      });

      expect(ruleAnniversary(ctx, DEFAULT_SETTINGS, TODAY)).toHaveLength(0);
    });
  });

  describe('ruleUpgradeCandidate', () => {
    it('fires when recurring at same amount for >= 12 months with no recent ask', () => {
      const gifts: Donation[] = [];
      for (let i = 0; i < 14; i++) {
        gifts.push({
          id: `upg-${i}`,
          donor_id: 'd1',
          donated_on: subtractMonths(TODAY, i),
          kind: 'cash',
          amount_sgd: 30,
          in_kind_description: null,
          estimated_value_sgd: null,
          channel: 'giving_sg',
          external_ref: null,
          campaign: null,
          is_recurring: true,
          monthly_amount_sgd: 30,
          payment_status: 'succeeded',
          programme: 'RTE',
          thanked: true,
          voided_at: null,
          void_reason: null,
        });
      }

      const ctx = makeContext({
        donations: gifts,
        follow_ups: [],
        engagements: [],
      });

      const candidates = ruleUpgradeCandidate(ctx, DEFAULT_SETTINGS, TODAY);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reason).toBe('upgrade_candidate');
      expect(candidates[0].dedupe_key).toBe('donor:d1|upgrade|2026');
    });

    it('does not fire if an upgrade follow-up was already generated in the last 12 months', () => {
      const gifts: Donation[] = [];
      for (let i = 0; i < 14; i++) {
        gifts.push({
          id: `upg-${i}`,
          donor_id: 'd1',
          donated_on: subtractMonths(TODAY, i),
          kind: 'cash',
          amount_sgd: 30,
          in_kind_description: null,
          estimated_value_sgd: null,
          channel: 'giving_sg',
          external_ref: null,
          campaign: null,
          is_recurring: true,
          monthly_amount_sgd: 30,
          payment_status: 'succeeded',
          programme: 'RTE',
          thanked: true,
          voided_at: null,
          void_reason: null,
        });
      }

      const ctx = makeContext({
        donations: gifts,
        follow_ups: [
          {
            id: 'f-upg',
            donor_id: 'd1',
            key_date_id: null,
            reason: 'upgrade_candidate',
            dedupe_key: 'donor:d1|upgrade|2026',
            status: 'done',
            due_on: '2026-08-01', // asked 2 months ago
            snoozed_until: null,
            completed_by: null,
          },
        ],
      });

      expect(ruleUpgradeCandidate(ctx, DEFAULT_SETTINGS, TODAY)).toHaveLength(0);
    });
  });
});

describe('runRulesEngine DB integration', () => {
  let db: Db;

  beforeAll(async () => {
    db = await createDb();
  });

  beforeEach(async () => {
    await db.exec('drop schema public cascade; create schema public;');
    await migrate(db);
  });

  afterAll(() => db.close());

  it('evaluates donors and idempotently writes follow_ups', async () => {
    // 1. Create a donor who donated 4 days ago with unthanked donation
    const [donor] = await db.query<Donor>(
      `insert into donors (first_name, last_name, email) values ('Alice', 'Wong', 'alice@test.fffa') returning *`,
    );
    await db.query(
      `insert into donations (donor_id, donated_on, amount_sgd, thanked)
       values ($1, '2026-10-24', 100, false)`,
      [donor.id],
    );

    // 2. Create a donor with approaching key date
    const [grantFunder] = await db.query<Donor>(
      `insert into donors (donor_type, organisation_name) values ('grant_funder', 'Temasek') returning *`,
    );
    await db.query(
      `insert into key_dates (donor_id, kind, due_on, label)
       values ($1, 'grant_report', '2026-11-10', 'Q4 Report')`,
      [grantFunder.id],
    );

    // First engine run
    const result1 = await runRulesEngine(db, TODAY);
    expect(result1.evaluated).toBe(2);
    expect(result1.created).toBe(2);

    const followUps = await db.query<FollowUp>('select * from follow_ups order by reason');
    expect(followUps).toHaveLength(2);
    expect(followUps.map((f) => f.reason)).toEqual(['key_date', 'thank_you_due']);

    // Second engine run: should be completely idempotent (0 new created)
    const result2 = await runRulesEngine(db, TODAY);
    expect(result2.evaluated).toBe(2);
    expect(result2.created).toBe(0);

    // Snoozing one does not cause it to be recreated
    await db.query(`update follow_ups set status = 'snoozed', snoozed_until = '2026-11-01' where reason = 'thank_you_due'`);
    const result3 = await runRulesEngine(db, TODAY);
    expect(result3.created).toBe(0);
  });
});
