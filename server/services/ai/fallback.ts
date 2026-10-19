import type { DraftContext } from './context.ts';

export interface DraftText {
  subject: string;
  body: string;
}

const sgd = (n: number) => `S$${Number.isInteger(n) ? n : n.toFixed(2)}`;

function impactLine(ctx: DraftContext): string {
  const last = ctx.recentDonations[0];
  if (!last) return '';
  const units = ctx.impact.lastDonationUnits;
  return units && units > 0
    ? ` Your gift of ${sgd(last.amountSgd)} provides around ${units} ${ctx.impact.unitLabel}${units === 1 ? '' : 's'} for families who need them.`
    : ` Your gift of ${sgd(last.amountSgd)} goes straight into our programmes.`;
}

/**
 * Plain templates used when the AI is unavailable or fails, so staff are never blocked (DM10).
 * Staff edit these the same way they edit AI drafts.
 */
export function fallbackDraft(ctx: DraftContext): DraftText {
  const hi = `Dear ${ctx.donorName},`;
  const sign = `\n\n${ctx.signature}`;
  const years = ctx.tenureMonths && ctx.tenureMonths >= 12 ? Math.floor(ctx.tenureMonths / 12) : null;

  switch (ctx.reason) {
    case 'thank_you_due':
      return {
        subject: `Thank you for supporting ${ctx.orgName}`,
        body: `${hi}\n\nThank you so much for your recent donation.${impactLine(ctx)} We are truly grateful to have you with us.${sign}`,
      };
    case 'lapsed':
      return {
        subject: 'We miss you at Free Food For All',
        body: `${hi}\n\nWe wanted to say thank you again for the support you have given ${ctx.orgName}. It made a real difference to the families we serve. Whenever you'd like to be part of it again, you are always welcome.${sign}`,
      };
    case 'anniversary':
      return {
        subject: years ? `${years} year${years === 1 ? '' : 's'} with Free Food For All` : 'Thank you for being with us',
        body: `${hi}\n\n${years ? `It has been ${years} year${years === 1 ? '' : 's'} since you first supported ${ctx.orgName}. ` : ''}Thank you for standing with us and with the families we serve.${sign}`,
      };
    case 'key_date':
      return {
        subject: `${ctx.keyDate?.label ?? 'An upcoming date'}: a quick note from ${ctx.orgName}`,
        body: `${hi}\n\nA quick note that ${ctx.keyDate ? `${ctx.keyDate.label.toLowerCase()} is on ${ctx.keyDate.date}` : 'an important date is coming up'}. Thank you for your partnership, and do let us know if there is anything we can help with.${sign}`,
      };
    case 'upgrade_candidate':
      if (ctx.upgrade) {
        const extra = ctx.upgrade.extraUnitsPerMonth;
        return {
          subject: `Thank you for your monthly support`,
          body: `${hi}\n\nThank you for giving ${sgd(ctx.upgrade.currentMonthlySgd)} every month. Your steady support keeps our programmes going.\n\nIf you are ever able to, moving to ${sgd(ctx.upgrade.suggestedMonthlySgd)} a month would${extra > 0 ? ` provide around ${extra} more ${ctx.impact.unitLabel}${extra === 1 ? '' : 's'} each month` : ' help us reach more families'}. Either way, we are grateful to have you with us.${sign}`,
        };
      }
      return fallbackDraft({ ...ctx, reason: 'manual' });
    case 'cadence_due':
    case 'manual':
    default:
      return {
        subject: `A note of thanks from ${ctx.orgName}`,
        body: `${hi}\n\nWe wanted to reach out and thank you for your support of ${ctx.orgName}. It means a lot to our team and to the families we serve. We hope you are keeping well.${sign}`,
      };
  }
}
