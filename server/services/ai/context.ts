import type { Donation, Donor, DonorSummary, FollowUp, Note } from '../../../shared/types.ts';

/** Everything the model is allowed to see for one draft. No email, mobile, address or tier. */
export interface DraftContext {
  reason: FollowUp['reason'];
  donorName: string;
  donorType: Donor['donor_type'];
  tenureMonths: number | null;
  donationCount: number;
  recentDonations: { date: string; amountSgd: number; programme: string | null; event: string | null }[];
  recurring: { monthlySgd: number; sinceMonths: number } | null;
  programmeInterest: string[];
  alsoVolunteers: boolean;
  howTheyKnowFffa: string | null;
  keyDate: { date: string; label: string } | null;
  notes: string[];
  impact: {
    unitSgd: number;
    unitLabel: string;
    /** Units the most recent donation paid for, worked out here so the model never does maths. */
    lastDonationUnits: number | null;
  };
  /** Only for upgrade asks: a modest, concrete step up. */
  upgrade: { currentMonthlySgd: number; suggestedMonthlySgd: number; extraUnitsPerMonth: number } | null;
  orgName: string;
  signature: string;
}

export interface DraftInputs {
  followUp: FollowUp;
  donor: Donor;
  summary: DonorSummary | null;
  donations: Donation[]; // newest first, voided ones already excluded
  notes: Note[]; // newest first, deleted ones already excluded
  org: { orgName: string; impactUnitSgd: number; impactUnitLabel: string; signature: string };
  today: string; // YYYY-MM-DD
}

const MAX_NOTES = 3;
const MAX_NOTE_CHARS = 300;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Singapore numbers (+65 / 8-digit starting 6, 8 or 9) and other long digit runs.
const PHONE_RE = /(\+?\d[\d\s-]{6,}\d)/g;
const NRIC_RE = /\b[STFGM]\d{7}[A-Z]\b/gi;

/** Notes are free text, so staff may have typed contact details or IDs into them. Strip those. */
export function scrubNote(text: string): string {
  const scrubbed = text
    .replace(EMAIL_RE, '[email removed]')
    .replace(NRIC_RE, '[id removed]')
    .replace(PHONE_RE, '[number removed]')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.length > MAX_NOTE_CHARS ? `${scrubbed.slice(0, MAX_NOTE_CHARS - 1)}…` : scrubbed;
}

export function displayName(donor: Donor): string {
  return (
    donor.preferred_name ||
    donor.first_name ||
    donor.organisation_name ||
    donor.last_name ||
    'Friend'
  ).trim();
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()));
}

/** A modest ask: +50%, rounded up to the next S$5, at least S$5 more. */
export function suggestUpgrade(currentMonthlySgd: number): number {
  const target = Math.ceil((currentMonthlySgd * 1.5) / 5) * 5;
  return Math.max(target, currentMonthlySgd + 5);
}

export function buildDraftContext(input: DraftInputs): DraftContext {
  const { followUp, donor, summary, donations, notes, org, today } = input;
  const unit = org.impactUnitSgd > 0 ? org.impactUnitSgd : null;

  const recurringGift = donations.find((d) => d.is_recurring && d.monthly_amount_sgd);
  const firstRecurring = [...donations].reverse().find((d) => d.is_recurring);
  const recurring = recurringGift
    ? {
        monthlySgd: recurringGift.monthly_amount_sgd!,
        sinceMonths: monthsBetween(firstRecurring!.donated_on, today),
      }
    : null;

  let upgrade: DraftContext['upgrade'] = null;
  if (followUp.reason === 'upgrade_candidate' && recurring) {
    const suggested = suggestUpgrade(recurring.monthlySgd);
    upgrade = {
      currentMonthlySgd: recurring.monthlySgd,
      suggestedMonthlySgd: suggested,
      extraUnitsPerMonth: unit ? Math.floor((suggested - recurring.monthlySgd) / unit) : 0,
    };
  }

  const last = donations[0];
  return {
    reason: followUp.reason,
    donorName: displayName(donor),
    donorType: donor.donor_type,
    tenureMonths: summary?.first_donation_on ? monthsBetween(summary.first_donation_on, today) : null,
    donationCount: summary?.donation_count ?? donations.length,
    recentDonations: donations.slice(0, 3).map((d) => ({
      date: d.donated_on,
      amountSgd: d.amount_sgd,
      programme: d.programme,
      event: d.event,
    })),
    recurring,
    programmeInterest: donor.programme_interest,
    alsoVolunteers: donor.also_volunteers,
    howTheyKnowFffa: donor.how_they_know_fffa,
    keyDate:
      followUp.reason === 'key_date' && donor.key_date
        ? { date: donor.key_date, label: donor.key_date_label ?? 'Key date' }
        : null,
    notes: notes.slice(0, MAX_NOTES).map((n) => scrubNote(n.body)),
    impact: {
      unitSgd: org.impactUnitSgd,
      unitLabel: org.impactUnitLabel,
      lastDonationUnits: last && unit ? Math.floor(last.amount_sgd / unit) : null,
    },
    upgrade,
    orgName: org.orgName,
    signature: org.signature,
  };
}
