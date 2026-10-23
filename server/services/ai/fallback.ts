import type { DraftContext } from './context.ts';

export interface DraftText {
  subject: string;
  body: string;
}

const sgd = (n: number) => `S$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** '2026-11-14' → '14 November 2026', so dates in messages read naturally. */
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function units(ctx: DraftContext, n: number): string {
  return `${n} ${n === 1 ? ctx.impact.unitSingular : ctx.impact.unitPlural}`;
}

function impactLine(ctx: DraftContext): string {
  const last = ctx.recentDonations[0];
  if (!last) return '';
  if (last.kind === 'in_kind') return ` Your gift of ${last.inKindItem} goes straight to the families we serve.`;
  const n = ctx.impact.lastDonationUnits;
  return n && n > 0
    ? ` Your gift of ${sgd(last.amountSgd!)} provides around ${units(ctx, n)}.`
    : ` Your gift of ${sgd(last.amountSgd!)} goes straight into our programmes.`;
}

/**
 * Plain templates used when the AI is unavailable or fails, so staff are never blocked (DM10).
 * Staff edit these the same way they edit AI drafts.
 */
export function fallbackDraft(ctx: DraftContext): DraftText {
  const hi = `Dear ${ctx.donorName},`;
  const you = ctx.organisationName ? `${ctx.organisationName}'s` : 'your';
  const sign = `\n\n${ctx.signature}`;
  const years = ctx.tenureMonths && ctx.tenureMonths >= 12 ? Math.floor(ctx.tenureMonths / 12) : null;

  switch (ctx.reason) {
    case 'thank_you_due':
      return {
        subject: `Thank you for supporting ${ctx.orgName}`,
        body: `${hi}\n\nThank you so much for ${you} recent donation.${impactLine(ctx)} We are truly grateful to have you with us.${sign}`,
      };
    case 'failed_payment': {
      const f = ctx.failedPayment;
      return {
        subject: 'A quick note about your monthly gift',
        body: `${hi}\n\nThank you for your monthly support of ${ctx.orgName}. We noticed that your ${f?.monthlySgd ? `${sgd(f.monthlySgd)} ` : ''}monthly gift${f ? ` on ${f.platform}` : ''} didn't go through this time. This sometimes happens when a card expires. When convenient, you can update your payment details there. Thank you for being with us.${sign}`,
      };
    }
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
        subject: `${ctx.keyDate?.label ?? 'An upcoming date'}: a note from ${ctx.orgName}`,
        body: `${hi}\n\nA quick note that ${ctx.keyDate ? `${ctx.keyDate.label} is due on ${longDate(ctx.keyDate.date)}` : 'an important date is coming up'}. Thank you for ${you} partnership with ${ctx.orgName}, and do let us know if there is anything we can help with.${sign}`,
      };
    case 'upgrade_candidate':
      if (ctx.upgrade) {
        const extra = ctx.upgrade.extraUnitsPerMonth;
        const more = extra > 0 ? `provide around ${extra} more ${extra === 1 ? ctx.impact.unitSingular : ctx.impact.unitPlural} each month` : 'help us reach more families';
        return {
          subject: `Thank you for your monthly support`,
          body: `${hi}\n\nThank you for giving ${sgd(ctx.upgrade.currentMonthlySgd)} every month. Your steady support keeps our programmes going.\n\nIf you are ever able to, moving to ${sgd(ctx.upgrade.suggestedMonthlySgd)} a month would ${more}. Either way, we are grateful to have you with us.${sign}`,
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
