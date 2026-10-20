import type { Donation, Donor, DonorSummary, FollowUp, KeyDate, Note } from '../../../shared/types.ts';

/** Everything the model is allowed to see for one draft. No email, mobile, address, tier or tax ids. */
export interface DraftContext {
  reason: FollowUp['reason'];
  /** Who the message greets: the person, or the contact person at an organisation. */
  donorName: string;
  organisationName: string | null;
  donorType: Donor['donor_type'];
  tenureMonths: number | null;
  donationCount: number;
  recentDonations: {
    date: string;
    kind: Donation['kind'];
    amountSgd: number | null;
    inKindItem: string | null;
    campaign: string | null;
    programme: string | null;
  }[];
  recurring: { monthlySgd: number; sinceMonths: number } | null;
  failedPayment: { date: string; monthlySgd: number | null; platform: string } | null;
  programmeInterest: string[];
  alsoVolunteers: boolean;
  howTheyKnowFffa: string | null;
  keyDate: { date: string; kind: KeyDate['kind']; label: string } | null;
  notes: string[];
  impact: {
    unitSgd: number;
    unitSingular: string;
    unitPlural: string;
    /** Units the most recent cash gift paid for, worked out here so the model never does maths. */
    lastDonationUnits: number | null;
  };
  /** Only for upgrade asks: a modest, concrete step up. */
  upgrade: { currentMonthlySgd: number; suggestedMonthlySgd: number; extraUnitsPerMonth: number } | null;
  orgName: string;
  signature: string;
}

export interface OrgSettings {
  orgName: string;
  impactUnitSgd: number;
  impactUnitSingular: string;
  impactUnitPlural: string;
  signature: string;
}

export interface DraftInputs {
  followUp: FollowUp;
  donor: Donor;
  summary: DonorSummary | null;
  /** Successful, non-voided gifts (cash and in-kind), newest first. */
  donations: Donation[];
  /** Latest failed recurring payment, for failed_payment follow-ups. */
  failedDonation: Donation | null;
  keyDate: KeyDate | null;
  notes: Note[]; // newest first, deleted ones already excluded
  org: OrgSettings;
  today: string; // YYYY-MM-DD
}

const MAX_NOTES = 3;
const MAX_NOTE_CHARS = 300;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Singapore numbers (+65 / 8-digit starting 6, 8 or 9) and other long digit runs.
const PHONE_RE = /(\+?\d[\d\s-]{6,}\d)/g;
const NRIC_RE = /\b[STFGM]\d{7}[A-Z]\b/gi;

const PLATFORM: Record<Donation['channel'], string> = {
  give_asia: 'GIVE.asia',
  giving_sg: 'Giving.sg',
  bank: 'bank transfer',
  paynow: 'PayNow',
  in_person: 'in person',
  other: 'their giving platform',
};

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

/** Individuals by their own name; organisations through their contact person, else the organisation. */
export function displayName(donor: Donor): string {
  const person = donor.preferred_name || donor.first_name;
  const name =
    donor.donor_type === 'individual'
      ? person || donor.last_name || donor.organisation_name
      : person || donor.organisation_name || donor.last_name;
  return (name || 'Friend').trim();
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
  const { followUp, donor, summary, donations, failedDonation, keyDate, notes, org, today } = input;
  const unit = org.impactUnitSgd > 0 ? org.impactUnitSgd : null;
  const cash = donations.filter((d) => d.kind === 'cash' && d.amount_sgd);

  const recurringGift = cash.find((d) => d.is_recurring && d.monthly_amount_sgd);
  const firstRecurring = [...cash].reverse().find((d) => d.is_recurring);
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

  const lastCash = cash[0];
  return {
    reason: followUp.reason,
    donorName: displayName(donor),
    organisationName: donor.donor_type === 'individual' ? null : donor.organisation_name,
    donorType: donor.donor_type,
    tenureMonths: summary?.first_donation_on ? monthsBetween(summary.first_donation_on, today) : null,
    donationCount: summary?.donation_count ?? cash.length,
    recentDonations: donations.slice(0, 3).map((d) => ({
      date: d.donated_on,
      kind: d.kind,
      amountSgd: d.kind === 'cash' ? d.amount_sgd : null,
      inKindItem: d.kind === 'in_kind' ? d.in_kind_description : null,
      campaign: d.campaign,
      programme: d.programme,
    })),
    recurring,
    failedPayment:
      followUp.reason === 'failed_payment' && failedDonation
        ? {
            date: failedDonation.donated_on,
            monthlySgd: failedDonation.monthly_amount_sgd ?? failedDonation.amount_sgd,
            platform: PLATFORM[failedDonation.channel],
          }
        : null,
    programmeInterest: donor.programme_interest,
    alsoVolunteers: donor.also_volunteers,
    howTheyKnowFffa: donor.how_they_know_fffa,
    keyDate:
      followUp.reason === 'key_date' && keyDate
        ? { date: keyDate.due_on, kind: keyDate.kind, label: keyDate.label ?? keyDate.kind.replace('_', ' ') }
        : null,
    notes: notes.slice(0, MAX_NOTES).map((n) => scrubNote(n.body)),
    impact: {
      unitSgd: org.impactUnitSgd,
      unitSingular: org.impactUnitSingular,
      unitPlural: org.impactUnitPlural,
      lastDonationUnits: lastCash && unit ? Math.floor(lastCash.amount_sgd! / unit) : null,
    },
    upgrade,
    orgName: org.orgName,
    signature: org.signature,
  };
}
