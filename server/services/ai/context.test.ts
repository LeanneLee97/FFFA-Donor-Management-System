import { describe, expect, it } from 'vitest';
import type { Donation, Donor, FollowUp, KeyDate } from '../../../shared/types.ts';
import { buildDraftContext, displayName, scrubNote, suggestUpgrade, type DraftInputs } from './context.ts';
import { fallbackDraft } from './fallback.ts';
import { buildUserPrompt } from './prompts.ts';

const donor: Donor = {
  id: 'd1',
  donor_type: 'individual',
  organisation_name: null,
  first_name: 'Mei Ling',
  last_name: 'Tan',
  contact_title: null,
  preferred_name: null,
  email: 'meiling@example.com',
  mobile: '+65 9123 4567',
  relationship_owner: null,
  how_they_know_fffa: 'Volunteered at a festive drive',
  programme_interest: ['RTE'],
  also_volunteers: true,
  major_override: false,
  next_action: null,
  next_action_due: null,
  archived_at: null,
  created_at: '2024-01-01T00:00:00Z',
};

const corporate: Donor = {
  ...donor,
  donor_type: 'corporate',
  organisation_name: 'Acme Pte Ltd',
  first_name: 'Ravi',
  last_name: 'Kumar',
  contact_title: 'CSR Manager',
};

const donation = (over: Partial<Donation>): Donation => ({
  id: 'x',
  donor_id: 'd1',
  donated_on: '2026-10-01',
  kind: 'cash',
  amount_sgd: 30,
  in_kind_description: null,
  estimated_value_sgd: null,
  channel: 'giving_sg',
  external_ref: null,
  campaign: 'Steps for Meals',
  is_recurring: true,
  monthly_amount_sgd: 30,
  payment_status: 'succeeded',
  programme: 'RTE',
  thanked: true,
  voided_at: null,
  void_reason: null,
  ...over,
});

const followUp = (reason: FollowUp['reason']): FollowUp => ({
  id: 'f1',
  donor_id: 'd1',
  key_date_id: null,
  reason,
  dedupe_key: 'k',
  status: 'pending',
  due_on: '2026-10-21',
  snoozed_until: null,
  completed_by: null,
});

const keyDate: KeyDate = {
  id: 'k1',
  donor_id: 'd1',
  kind: 'grant_report',
  due_on: '2026-11-15',
  label: 'Q4 report to XYZ Foundation',
  completed_at: null,
};

const inputs = (reason: FollowUp['reason'], over: Partial<DraftInputs> = {}): DraftInputs => ({
  followUp: followUp(reason),
  donor,
  summary: null,
  donations: [donation({ donated_on: '2026-10-01' }), donation({ donated_on: '2024-10-01' })],
  failedDonation: null,
  keyDate: null,
  notes: [],
  org: {
    orgName: 'Free Food For All',
    impactUnitSgd: 10,
    impactUnitSingular: 'meal for an elderly person',
    impactUnitPlural: 'meals for elderly people',
    signature: 'FFFA',
  },
  today: '2026-10-21',
  ...over,
});

describe('buildDraftContext', () => {
  it('never includes contact details or tier', () => {
    const json = JSON.stringify(buildDraftContext(inputs('thank_you_due')));
    expect(json).not.toContain('meiling@example.com');
    expect(json).not.toContain('9123');
    expect(json).not.toMatch(/"(email|mobile|tier|is_major)"/);
  });

  it('works out impact and upgrade numbers in code, with the S$10 meal unit', () => {
    const ctx = buildDraftContext(inputs('upgrade_candidate'));
    expect(ctx.impact.lastDonationUnits).toBe(3); // S$30 / S$10
    expect(ctx.upgrade).toEqual({ currentMonthlySgd: 30, suggestedMonthlySgd: 45, extraUnitsPerMonth: 1 });
    expect(ctx.recurring?.sinceMonths).toBe(24);
  });

  it('only sends upgrade figures for upgrade asks', () => {
    expect(buildDraftContext(inputs('thank_you_due')).upgrade).toBeNull();
  });

  it('includes campaigns and in-kind items, without a dollar value on in-kind', () => {
    const rice = donation({ kind: 'in_kind', amount_sgd: null, in_kind_description: '200 packs of rice', estimated_value_sgd: 800 });
    const ctx = buildDraftContext(inputs('thank_you_due', { donations: [rice] }));
    expect(ctx.recentDonations[0]).toMatchObject({ kind: 'in_kind', inKindItem: '200 packs of rice', amountSgd: null });
    expect(JSON.stringify(ctx)).not.toContain('800');
    expect(ctx.impact.lastDonationUnits).toBeNull();
  });

  it('adds failed-payment details only for failed_payment follow-ups', () => {
    const failed = donation({ payment_status: 'failed', channel: 'give_asia', donated_on: '2026-10-18' });
    expect(buildDraftContext(inputs('failed_payment', { failedDonation: failed })).failedPayment).toEqual({
      date: '2026-10-18',
      monthlySgd: 30,
      platform: 'GIVE.asia',
    });
    expect(buildDraftContext(inputs('thank_you_due', { failedDonation: failed })).failedPayment).toBeNull();
  });

  it('uses the key_dates row for key_date follow-ups', () => {
    expect(buildDraftContext(inputs('key_date', { keyDate })).keyDate).toEqual({
      date: '2026-11-15',
      kind: 'grant_report',
      label: 'Q4 report to XYZ Foundation',
    });
  });
});

describe('displayName', () => {
  it('greets individuals by preferred, then first name', () => {
    expect(displayName(donor)).toBe('Mei Ling');
    expect(displayName({ ...donor, preferred_name: 'Ling' })).toBe('Ling');
  });

  it('greets organisations through their contact person, else the organisation', () => {
    expect(displayName(corporate)).toBe('Ravi');
    expect(displayName({ ...corporate, first_name: null })).toBe('Acme Pte Ltd');
  });
});

describe('scrubNote', () => {
  it('removes emails, phone numbers and NRICs typed into notes', () => {
    const out = scrubNote('Call her on 9123 4567 or mail tan@abc.sg, NRIC S1234567D. Loves KidsLuvIt.');
    expect(out).toBe('Call her on [number removed] or mail [email removed], NRIC [id removed]. Loves KidsLuvIt.');
  });

  it('caps long notes', () => {
    expect(scrubNote('a'.repeat(500)).length).toBe(300);
  });
});

describe('suggestUpgrade', () => {
  it('asks for a modest, round step up', () => {
    expect(suggestUpgrade(10)).toBe(15);
    expect(suggestUpgrade(20)).toBe(30);
    expect(suggestUpgrade(5)).toBe(10);
  });
});

describe('fallbackDraft', () => {
  it('has a usable template for every reason', () => {
    const reasons: FollowUp['reason'][] = [
      'thank_you_due', 'failed_payment', 'cadence_due', 'lapsed', 'anniversary', 'key_date', 'upgrade_candidate', 'manual',
    ];
    for (const reason of reasons) {
      const draft = fallbackDraft(buildDraftContext(inputs(reason, { keyDate })));
      expect(draft.subject.length).toBeGreaterThan(0);
      expect(draft.body).toContain('Dear Mei Ling,');
      expect(draft.body).toContain('FFFA');
      expect(draft.body).not.toContain('undefined');
    }
  });

  it('uses the computed impact with correct plurals', () => {
    expect(fallbackDraft(buildDraftContext(inputs('thank_you_due'))).body).toContain(
      'provides around 3 meals for elderly people',
    );
    const ten = [donation({ amount_sgd: 10 })];
    expect(fallbackDraft(buildDraftContext(inputs('thank_you_due', { donations: ten }))).body).toContain(
      'around 1 meal for an elderly person',
    );
    expect(fallbackDraft(buildDraftContext(inputs('upgrade_candidate'))).body).toContain(
      'S$45 a month would provide around 1 more meal for an elderly person each month',
    );
  });

  it('thanks in-kind donors for the items, and organisations by name', () => {
    const rice = donation({ kind: 'in_kind', amount_sgd: null, in_kind_description: '200 packs of rice' });
    const body = fallbackDraft(buildDraftContext(inputs('thank_you_due', { donor: corporate, donations: [rice] }))).body;
    expect(body).toContain('Dear Ravi,');
    expect(body).toContain("Acme Pte Ltd's recent donation");
    expect(body).toContain('200 packs of rice');
  });

  it('writes key dates in plain English', () => {
    const body = fallbackDraft(buildDraftContext(inputs('key_date', { keyDate }))).body;
    expect(body).toContain('Q4 report to XYZ Foundation is due on 15 November 2026');
  });

  it('writes a gentle failed-payment note naming the platform', () => {
    const failed = donation({ payment_status: 'failed', channel: 'give_asia' });
    const body = fallbackDraft(buildDraftContext(inputs('failed_payment', { failedDonation: failed }))).body;
    expect(body).toContain("S$30 monthly gift on GIVE.asia didn't go through");
  });
});

describe('buildUserPrompt', () => {
  it('includes the reason guidance and the context', () => {
    const prompt = buildUserPrompt(buildDraftContext(inputs('lapsed')));
    expect(prompt).toContain('we miss your support');
    expect(prompt).toContain('"donorName": "Mei Ling"');
  });
});
