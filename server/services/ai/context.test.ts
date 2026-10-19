import { describe, expect, it } from 'vitest';
import type { Donation, Donor, FollowUp } from '../../../shared/types.ts';
import { buildDraftContext, scrubNote, suggestUpgrade, type DraftInputs } from './context.ts';
import { fallbackDraft } from './fallback.ts';
import { buildUserPrompt } from './prompts.ts';

const donor: Donor = {
  id: 'd1',
  first_name: 'Mei Ling',
  last_name: 'Tan',
  organisation_name: null,
  preferred_name: null,
  email: 'meiling@example.com',
  mobile: '+65 9123 4567',
  donor_type: 'individual',
  key_date: null,
  key_date_label: null,
  relationship_owner: null,
  how_they_know_fffa: 'Volunteered at a festive drive',
  programme_interest: ['RTE'],
  also_volunteers: true,
  next_action: null,
  next_action_due: null,
  archived_at: null,
  created_at: '2024-01-01T00:00:00Z',
};

const donation = (over: Partial<Donation>): Donation => ({
  id: 'x',
  donor_id: 'd1',
  donated_on: '2026-10-01',
  amount_sgd: 30,
  channel: 'giving_sg',
  event: null,
  is_recurring: true,
  monthly_amount_sgd: 30,
  programme: 'RTE',
  thanked: true,
  voided_at: null,
  void_reason: null,
  ...over,
});

const followUp = (reason: FollowUp['reason']): FollowUp => ({
  id: 'f1',
  donor_id: 'd1',
  reason,
  dedupe_key: 'k',
  status: 'pending',
  due_on: '2026-10-19',
  snoozed_until: null,
  completed_by: null,
});

const inputs = (reason: FollowUp['reason'], over: Partial<DraftInputs> = {}): DraftInputs => ({
  followUp: followUp(reason),
  donor,
  summary: null,
  donations: [donation({ donated_on: '2026-10-01' }), donation({ donated_on: '2024-10-01' })],
  notes: [],
  org: { orgName: 'Free Food For All', impactUnitSgd: 3, impactUnitLabel: 'Ready-To-Eat meal', signature: 'FFFA' },
  today: '2026-10-19',
  ...over,
});

describe('buildDraftContext', () => {
  it('never includes contact details', () => {
    const json = JSON.stringify(buildDraftContext(inputs('thank_you_due')));
    expect(json).not.toContain('meiling@example.com');
    expect(json).not.toContain('9123');
    expect(json).not.toMatch(/"(email|mobile|tier)"/);
  });

  it('works out impact and upgrade numbers in code, not in the model', () => {
    const ctx = buildDraftContext(inputs('upgrade_candidate'));
    expect(ctx.impact.lastDonationUnits).toBe(10); // S$30 / S$3
    expect(ctx.upgrade).toEqual({ currentMonthlySgd: 30, suggestedMonthlySgd: 45, extraUnitsPerMonth: 5 });
    expect(ctx.recurring?.sinceMonths).toBe(24);
  });

  it('only sends upgrade figures for upgrade asks', () => {
    expect(buildDraftContext(inputs('thank_you_due')).upgrade).toBeNull();
  });

  it('prefers preferred name, then first name, then organisation', () => {
    expect(buildDraftContext(inputs('manual')).donorName).toBe('Mei Ling');
    const corp = { ...donor, first_name: null, organisation_name: 'Acme Pte Ltd' };
    expect(buildDraftContext(inputs('manual', { donor: corp })).donorName).toBe('Acme Pte Ltd');
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
      'thank_you_due', 'cadence_due', 'lapsed', 'anniversary', 'key_date', 'upgrade_candidate', 'manual',
    ];
    for (const reason of reasons) {
      const draft = fallbackDraft(buildDraftContext(inputs(reason)));
      expect(draft.subject.length).toBeGreaterThan(0);
      expect(draft.body).toContain('Dear Mei Ling,');
      expect(draft.body).toContain('FFFA');
    }
  });

  it('uses the computed impact in thank-yous', () => {
    expect(fallbackDraft(buildDraftContext(inputs('thank_you_due'))).body).toContain('around 10 Ready-To-Eat meals');
  });
});

describe('buildUserPrompt', () => {
  it('includes the reason guidance and the context', () => {
    const prompt = buildUserPrompt(buildDraftContext(inputs('lapsed')));
    expect(prompt).toContain('we miss your support');
    expect(prompt).toContain('"donorName": "Mei Ling"');
  });
});
