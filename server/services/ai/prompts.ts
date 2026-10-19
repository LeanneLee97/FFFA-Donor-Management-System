import type { FollowUpReason } from '../../../shared/types.ts';
import type { DraftContext } from './context.ts';

/** Bump whenever the system prompt or any reason guidance changes, so drafts can be compared. */
export const PROMPT_VERSION = 'dm10-v1';

export const SYSTEM_PROMPT = `You write short, personal follow-up emails for Free Food For All (FFFA), a Singapore charity that provides Ready-To-Eat meals, food redistribution and the KidsLuvIt children's programme.

Voice: warm, sincere and specific, like a staff member who knows this supporter. Simple Singapore English. No jargon, no corporate tone, no exclamation-mark overload, no emojis.

Hard rules:
- Use only facts given in the context. Never invent amounts, dates, programmes, events, stories or statistics.
- Use the impact figures exactly as given; do not calculate new ones.
- No guilt, pressure or urgency. Never mention tiers, rankings or how much others give.
- At most one ask, and only if the guidance says so.
- 80 to 150 words in the body. End with the signature exactly as given.
- Return JSON with "subject" (under 70 characters) and "body".`;

const REASON_GUIDANCE: Record<FollowUpReason, string> = {
  thank_you_due:
    'Thank them for their most recent donation. Say what it supports, using the impact figure if given. No ask.',
  cadence_due:
    'A friendly check-in after a while without contact. Share appreciation for their support so far and mention the programme they care about. No ask.',
  lapsed:
    'A light "we miss your support" note. Thank them for what they gave before (refer to it specifically) and say they are always welcome back. No pressure, no guilt.',
  anniversary:
    'Celebrate their giving anniversary with FFFA: how long they have supported and what that support has meant. No ask.',
  key_date:
    'A courteous reminder that the key date in the context is coming up (for example a sponsorship renewal or a report due), with appreciation for the partnership. Offer to help with anything they need.',
  upgrade_candidate:
    'Thank them for their steady monthly support first. Then make one modest, specific invitation to increase from the current to the suggested monthly amount, using the extra impact figure given. Make it easy to say no.',
  manual: 'A warm, personal check-in thanking them for their support. No ask.',
};

export function buildUserPrompt(ctx: DraftContext): string {
  return [
    `Write a follow-up email. Purpose: ${REASON_GUIDANCE[ctx.reason]}`,
    '',
    'Context (JSON):',
    JSON.stringify(ctx, null, 2),
  ].join('\n');
}

/** JSON schema the model must follow. */
export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
} as const;
