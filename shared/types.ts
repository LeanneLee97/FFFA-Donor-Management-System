// Shared domain types for the API and the frontend. Mirrors server/migrations/001_init.sql.
// Dates are 'YYYY-MM-DD' strings, timestamps are ISO strings, money is a number in SGD.

export type Uuid = string;
export type IsoDate = string;
export type IsoTimestamp = string;

export type StaffRole = 'staff' | 'admin';
export type DonorType = 'individual' | 'corporate' | 'grant_funder';
export type DonationChannel = 'give_asia' | 'giving_sg' | 'bank' | 'paynow' | 'other';
export type EngagementChannel = 'email' | 'call' | 'whatsapp' | 'meeting' | 'event' | 'other';
export type Tier = 'bronze' | 'silver' | 'gold' | 'diamond';
export type FollowUpReason =
  | 'thank_you_due'
  | 'cadence_due'
  | 'lapsed'
  | 'anniversary'
  | 'key_date'
  | 'upgrade_candidate'
  | 'manual';
export type FollowUpStatus = 'pending' | 'snoozed' | 'done' | 'dismissed';
export type DraftStatus = 'draft' | 'approved' | 'discarded';
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
  first_name: string | null;
  last_name: string | null;
  organisation_name: string | null;
  preferred_name: string | null;
  email: string | null;
  mobile: string | null;
  donor_type: DonorType;
  key_date: IsoDate | null;
  key_date_label: string | null;
  relationship_owner: Uuid | null;
  how_they_know_fffa: string | null;
  programme_interest: string[];
  also_volunteers: boolean;
  next_action: string | null;
  next_action_due: IsoDate | null;
  archived_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
}

/** Computed on read by the donor_summary view; never stored. */
export interface DonorSummary {
  donor_id: Uuid;
  donation_count: number | null;
  first_donation_on: IsoDate | null;
  last_donation_on: IsoDate | null;
  last_donation_sgd: number | null;
  last_donation_event: string | null;
  avg_donation_sgd: number | null;
  avg_days_between: number | null;
  giving_12m_sgd: number;
  last_engaged_on: IsoDate | null;
  last_engagement_channel: EngagementChannel | null;
  days_since_engagement: number;
  tier: Tier;
  cadence_days: number;
  personal_outreach: boolean;
}

export interface Donation {
  id: Uuid;
  donor_id: Uuid;
  donated_on: IsoDate;
  amount_sgd: number;
  channel: DonationChannel;
  event: string | null;
  is_recurring: boolean;
  monthly_amount_sgd: number | null;
  programme: string | null;
  thanked: boolean;
  voided_at: IsoTimestamp | null;
  void_reason: string | null;
}

export interface Engagement {
  id: Uuid;
  donor_id: Uuid;
  follow_up_id: Uuid | null;
  engaged_on: IsoDate;
  channel: EngagementChannel;
  event: string | null;
  summary: string | null;
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
}

/** Standard error body for every API route. */
export interface ApiError {
  error: string;
  code?: string;
}
