// Shared domain types for the API and the frontend. Mirrors server/migrations (001 + 002).
// Dates are 'YYYY-MM-DD' strings, timestamps are ISO strings, money is a number in SGD.

export type Uuid = string;
export type IsoDate = string;
export type IsoTimestamp = string;

export type StaffRole = 'staff' | 'admin';
export type DonorType = 'individual' | 'corporate' | 'grant_funder';
export type DonationChannel = 'give_asia' | 'giving_sg' | 'bank' | 'paynow' | 'in_person' | 'other';
export type DonationKind = 'cash' | 'in_kind';
export type PaymentStatus = 'succeeded' | 'failed';
export type KeyDateKind = 'sponsorship_expiry' | 'grant_report' | 'grant_renewal' | 'other';
export type EngagementChannel = 'email' | 'call' | 'whatsapp' | 'meeting' | 'event' | 'other';
export type Tier = 'bronze' | 'silver' | 'gold' | 'diamond';
export type FollowUpReason =
  | 'thank_you_due'
  | 'failed_payment'
  | 'cadence_due'
  | 'lapsed'
  | 'anniversary'
  | 'key_date'
  | 'upgrade_candidate'
  | 'manual';
export type FollowUpStatus = 'pending' | 'snoozed' | 'done' | 'dismissed';
export type DraftStatus = 'draft' | 'approved' | 'sent' | 'discarded';
export type DraftSource = 'ai' | 'template_fallback';

export interface Staff {
  id: Uuid;
  name: string;
  email: string;
  role: StaffRole;
  active: boolean;
}

export interface Donor {
  id: Uuid;
  donor_type: DonorType;
  /** The donor for corporates and grant funders; first/last name are then the contact person. */
  organisation_name: string | null;
  first_name: string | null;
  last_name: string | null;
  contact_title: string | null;
  preferred_name: string | null;
  email: string | null;
  mobile: string | null;
  relationship_owner: Uuid | null;
  how_they_know_fffa: string | null;
  programme_interest: string[];
  also_volunteers: boolean;
  /** Staff tagged this donor as major (one of three ways to be major; see DonorSummary.is_major). */
  major_override: boolean;
  next_action: string | null;
  next_action_due: IsoDate | null;
  archived_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
}

/** Computed on read by the donor_summary view; never stored. Totals count successful cash gifts only. */
export interface DonorSummary {
  donor_id: Uuid;
  donation_count: number;
  first_donation_on: IsoDate | null;
  last_donation_on: IsoDate | null;
  last_donation_sgd: number | null;
  last_donation_campaign: string | null;
  avg_donation_sgd: number | null;
  avg_days_between: number | null;
  giving_12m_sgd: number;
  in_kind_count: number;
  years_with_fffa: number;
  last_engaged_on: IsoDate | null;
  last_engagement_channel: EngagementChannel | null;
  days_since_engagement: number;
  tier: Tier;
  cadence_days: number;
  /** S$5,000+ in 12 months, 3+ years with FFFA, or tagged by staff: personal outreach, no AI drafts. */
  is_major: boolean;
}

export interface Donation {
  id: Uuid;
  donor_id: Uuid;
  donated_on: IsoDate;
  kind: DonationKind;
  /** Cash gifts only. */
  amount_sgd: number | null;
  /** In-kind gifts only, e.g. "200 packs of rice". */
  in_kind_description: string | null;
  estimated_value_sgd: number | null;
  channel: DonationChannel;
  external_ref: string | null;
  campaign: string | null;
  is_recurring: boolean;
  monthly_amount_sgd: number | null;
  payment_status: PaymentStatus;
  programme: string | null;
  thanked: boolean;
  voided_at: IsoTimestamp | null;
  void_reason: string | null;
}

export interface KeyDate {
  id: Uuid;
  donor_id: Uuid;
  kind: KeyDateKind;
  due_on: IsoDate;
  label: string | null;
  completed_at: IsoTimestamp | null;
}

export interface Engagement {
  id: Uuid;
  donor_id: Uuid;
  follow_up_id: Uuid | null;
  ai_draft_id: Uuid | null;
  engaged_on: IsoDate;
  channel: EngagementChannel;
  campaign: string | null;
  summary: string | null;
  /** The message actually sent, so the conversation history stays with FFFA. */
  message_subject: string | null;
  message_body: string | null;
  staff_id: Uuid | null;
}

export interface Note {
  id: Uuid;
  donor_id: Uuid;
  author: Uuid | null;
  body: string;
  created_at: IsoTimestamp;
  deleted_at: IsoTimestamp | null;
}

export interface FollowUp {
  id: Uuid;
  donor_id: Uuid;
  key_date_id: Uuid | null;
  reason: FollowUpReason;
  dedupe_key: string;
  status: FollowUpStatus;
  due_on: IsoDate;
  snoozed_until: IsoDate | null;
  completed_by: Uuid | null;
}

export interface AiDraft {
  id: Uuid;
  follow_up_id: Uuid;
  donor_id: Uuid;
  prompt_version: string;
  source: DraftSource;
  subject: string;
  body_generated: string;
  body_final: string | null;
  status: DraftStatus;
  created_by: Uuid | null;
  approved_by: Uuid | null;
  approved_at: IsoTimestamp | null;
  sent_at: IsoTimestamp | null;
}

/** GET /api/follow-ups: an open follow-up with what the queue needs to show. */
export interface QueueItem extends FollowUp {
  donor_name: string;
  organisation_name: string | null;
  donor_type: DonorType;
  is_major: boolean;
  key_date_label: string | null;
  /** Latest draft for this follow-up that is still in play (draft or approved), if any. */
  open_draft: AiDraft | null;
}

/** GET /api/donors/:id */
export interface DonorProfile {
  donor: Donor;
  summary: DonorSummary | null;
  donations: Donation[];
  engagements: Engagement[];
  notes: Note[];
  key_dates: KeyDate[];
  follow_ups: FollowUp[];
}

/** GET /api/donors: a donor with display name and computed summary. */
export interface DonorListItem extends Donor {
  donor_name: string;
  summary: DonorSummary | null;
}

export interface DonorFilters {
  query?: string;
  type?: DonorType;
  tier?: Tier;
  lastDonationBefore?: IsoDate;
  owner?: Uuid;
}

/** Standard error body for every API route. */
export interface ApiError {
  error: string;
  code?: string;
}

/** GET /api/dashboard (DM5): aggregates only. */
export interface Dashboard {
  donors: { total: number; active_12m: number; major: number; recurring: number };
  giving_12m_sgd: number;
  monthly_recurring_sgd: number;
  tiers: { tier: string; donors: number }[];
  follow_ups: { reason: string; pending: number }[];
  months: { month: string; donations_sgd: number; donations: number; engagements: number }[];
  campaigns: { campaign: string; donations_sgd: number; donors: number }[];
  ai: { drafted_30d: number; sent_30d: number };
}
