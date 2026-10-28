import type {
  Donation,
  Donor,
  DonorSummary,
  Engagement,
  FollowUp,
  FollowUpReason,
  IsoDate,
  KeyDate,
  Uuid,
} from '../../../shared/types.ts';
import type { Settings } from '../settings.ts';

export interface FollowUpCandidate {
  donor_id: Uuid;
  reason: FollowUpReason;
  dedupe_key: string;
  due_on: IsoDate;
  key_date_id?: Uuid | null;
}

export interface DonorRuleContext {
  donor: Donor;
  summary: DonorSummary | null;
  donations: Donation[];
  key_dates: KeyDate[];
  engagements: Engagement[];
  follow_ups: FollowUp[];
}

export type RuleFn = (context: DonorRuleContext, settings: Settings, today: IsoDate) => FollowUpCandidate[];
