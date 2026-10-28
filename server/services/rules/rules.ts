import type { FollowUpCandidate, RuleFn } from './types.ts';

export function toIsoDateString(val: string | Date): string {
  if (typeof val === 'string') return val.slice(0, 10);
  return new Date(val).toISOString().slice(0, 10);
}

export function parseDate(isoDate: string | Date): { year: number; month: number; day: number } {
  const str = toIsoDateString(isoDate);
  const [year, month, day] = str.split('-').map(Number);
  return { year, month, day };
}

export function daysBetween(from: string | Date, to: string | Date): number {
  const strFrom = toIsoDateString(from);
  const strTo = toIsoDateString(to);
  const d1 = new Date(strFrom + 'T00:00:00Z').getTime();
  const d2 = new Date(strTo + 'T00:00:00Z').getTime();
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function monthsBetween(from: string | Date, to: string | Date): number {
  const p1 = parseDate(from);
  const p2 = parseDate(to);
  let months = (p2.year - p1.year) * 12 + (p2.month - p1.month);
  if (p2.day < p1.day) months--;
  return months;
}

export function subtractMonths(isoDate: string | Date, months: number): string {
  const { year, month, day } = parseDate(isoDate);
  const totalMonths = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, maxDay);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Rule 1: thank_you_due
 * A donation (cash or in-kind) has thanked = false and is >= N days old (default 3).
 */
export const ruleThankYouDue: RuleFn = (context, settings, today) => {
  const thresholdDays = settings.rules.thank_you_after_days ?? 3;
  const candidates: FollowUpCandidate[] = [];

  for (const donation of context.donations) {
    if (donation.voided_at) continue;
    if (donation.payment_status !== 'succeeded') continue;
    if (donation.thanked) continue;

    const ageDays = daysBetween(donation.donated_on, today);
    if (ageDays >= thresholdDays) {
      candidates.push({
        donor_id: context.donor.id,
        reason: 'thank_you_due',
        dedupe_key: `donor:${context.donor.id}|thank_you|${donation.id}`,
        due_on: toIsoDateString(today),
      });
    }
  }

  return candidates;
};

/**
 * Rule 2: failed_payment
 * A recurring donor's latest monthly payment has payment_status = 'failed' within N days of failure (default 7).
 */
export const ruleFailedPayment: RuleFn = (context, settings, today) => {
  const windowDays = settings.rules.failed_payment_window_days ?? 7;

  // Find the latest recurring donation
  const recurring = context.donations
    .filter((d) => d.is_recurring && !d.voided_at)
    .sort((a, b) => toIsoDateString(b.donated_on).localeCompare(toIsoDateString(a.donated_on)));

  if (recurring.length === 0) return [];

  const latest = recurring[0];
  if (latest.payment_status === 'failed') {
    const ageDays = daysBetween(latest.donated_on, today);
    if (ageDays >= 0 && ageDays <= windowDays) {
      return [
        {
          donor_id: context.donor.id,
          reason: 'failed_payment',
          dedupe_key: `donor:${context.donor.id}|failed_payment|${latest.id}`,
          due_on: toIsoDateString(today),
        },
      ];
    }
  }

  return [];
};

/**
 * Rule 3: key_date
 * A KEY_DATE is due within N days (default 30) and not completed.
 */
export const ruleKeyDate: RuleFn = (context, settings, today) => {
  const windowDays = settings.rules.key_date_window_days ?? 30;
  const candidates: FollowUpCandidate[] = [];

  for (const kd of context.key_dates) {
    if (kd.completed_at) continue;

    const daysUntilDue = daysBetween(today, kd.due_on);
    if (daysUntilDue <= windowDays) {
      candidates.push({
        donor_id: context.donor.id,
        reason: 'key_date',
        dedupe_key: `keydate:${kd.id}`,
        due_on: toIsoDateString(kd.due_on),
        key_date_id: kd.id,
      });
    }
  }

  return candidates;
};

/**
 * Rule 4: cadence_due
 * Days since last engagement >= the donor's tier cadence (going cold).
 */
export const ruleCadenceDue: RuleFn = (context, _settings, today) => {
  if (!context.summary) return [];

  const cadenceDays = context.summary.cadence_days;
  if (!cadenceDays || cadenceDays <= 0) return [];

  const rawLastTouch =
    context.summary.last_engaged_on ??
    context.summary.first_donation_on ??
    context.donor.created_at;

  const lastTouchDate = toIsoDateString(rawLastTouch);
  const daysSince = daysBetween(lastTouchDate, today);
  if (daysSince >= cadenceDays) {
    return [
      {
        donor_id: context.donor.id,
        reason: 'cadence_due',
        dedupe_key: `donor:${context.donor.id}|cadence|${lastTouchDate}`,
        due_on: toIsoDateString(today),
      },
    ];
  }

  return [];
};

/**
 * Rule 5: lapsed
 * Recurring donor with no successful donation for N days (default 45),
 * or one-off donor with none for M days (default 180).
 */
export const ruleLapsed: RuleFn = (context, settings, today) => {
  if (!context.summary?.last_donation_on) return [];

  const isRecurring = context.donations.some(
    (d) => d.is_recurring && !d.voided_at && d.payment_status === 'succeeded',
  );

  const threshold = isRecurring
    ? (settings.rules.lapsed_recurring_days ?? 45)
    : (settings.rules.lapsed_one_off_days ?? 180);

  const lastDonationDate = toIsoDateString(context.summary.last_donation_on);
  const daysSince = daysBetween(lastDonationDate, today);
  if (daysSince >= threshold) {
    const period = toIsoDateString(today).slice(0, 7); // YYYY-MM
    return [
      {
        donor_id: context.donor.id,
        reason: 'lapsed',
        dedupe_key: `donor:${context.donor.id}|lapsed|${period}`,
        due_on: toIsoDateString(today),
      },
    ];
  }

  return [];
};

/**
 * Rule 6: anniversary
 * First-donation anniversary within the next N days (default 7).
 */
export const ruleAnniversary: RuleFn = (context, settings, today) => {
  const firstDonationOn = context.summary?.first_donation_on;
  if (!firstDonationOn) return [];

  const windowDays = settings.rules.anniversary_window_days ?? 7;
  const firstDateStr = toIsoDateString(firstDonationOn);
  const todayStr = toIsoDateString(today);
  const firstYear = parseInt(firstDateStr.slice(0, 4), 10);
  const currentYear = parseInt(todayStr.slice(0, 4), 10);

  if (currentYear <= firstYear) return [];

  let monthDay = firstDateStr.slice(5, 10);
  if (monthDay === '02-29' && !isLeapYear(currentYear)) {
    monthDay = '02-28';
  }

  const anniversaryDate = `${currentYear}-${monthDay}`;
  const daysUntil = daysBetween(todayStr, anniversaryDate);

  if (daysUntil >= 0 && daysUntil <= windowDays) {
    return [
      {
        donor_id: context.donor.id,
        reason: 'anniversary',
        dedupe_key: `donor:${context.donor.id}|anniversary|${currentYear}`,
        due_on: anniversaryDate,
      },
    ];
  }

  return [];
};

/**
 * Rule 7: upgrade_candidate
 * Recurring at the same monthly amount for >= 12 months, not asked in the last 12 months.
 */
export const ruleUpgradeCandidate: RuleFn = (context, settings, today) => {
  const thresholdMonths = settings.rules.upgrade_same_amount_months ?? 12;
  const todayStr = toIsoDateString(today);

  const successfulRecurring = context.donations
    .filter((d) => d.is_recurring && !d.voided_at && d.payment_status === 'succeeded')
    .sort((a, b) => toIsoDateString(a.donated_on).localeCompare(toIsoDateString(b.donated_on))); // oldest first

  if (successfulRecurring.length === 0) return [];

  const earliestDate = toIsoDateString(successfulRecurring[0].donated_on);
  if (monthsBetween(earliestDate, todayStr) < thresholdMonths) return [];

  const cutoff = subtractMonths(todayStr, thresholdMonths);
  const recentGifts = successfulRecurring.filter((d) => toIsoDateString(d.donated_on) >= cutoff);
  if (recentGifts.length === 0) return [];

  const baseAmount = Number(recentGifts[0].monthly_amount_sgd ?? recentGifts[0].amount_sgd);
  const allSameAmount = recentGifts.every(
    (g) => Number(g.monthly_amount_sgd ?? g.amount_sgd) === baseAmount,
  );
  if (!allSameAmount) return [];

  // Check if asked in the last 12 months via follow_ups
  const askedRecently = context.follow_ups.some(
    (f) => f.reason === 'upgrade_candidate' && toIsoDateString(f.due_on) >= cutoff,
  );
  if (askedRecently) return [];

  // Check if asked via engagements
  const engagedUpgrade = context.engagements.some(
    (e) =>
      toIsoDateString(e.engaged_on) >= cutoff &&
      (e.campaign === 'upgrade' || (e.summary && /upgrade/i.test(e.summary))),
  );
  if (engagedUpgrade) return [];

  return [
    {
      donor_id: context.donor.id,
      reason: 'upgrade_candidate',
      dedupe_key: `donor:${context.donor.id}|upgrade|${todayStr.slice(0, 4)}`,
      due_on: todayStr,
    },
  ];
};

export const ALL_RULES: RuleFn[] = [
  ruleThankYouDue,
  ruleFailedPayment,
  ruleKeyDate,
  ruleCadenceDue,
  ruleLapsed,
  ruleAnniversary,
  ruleUpgradeCandidate,
];
