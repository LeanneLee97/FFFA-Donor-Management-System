# FFFA Donor Management: Prompt Guide

*Version 1 · 28 October 2026 · prompt version `dm10-v2`*

This guide explains how the system drafts follow-up messages: what the AI is allowed to see, the instructions it follows, the standard templates it falls back to, and how staff check and approve every message. It's for staff who send messages and for whoever maintains the system.

**The principle:** the AI drafts, a person decides. Nothing is sent by the system. A staff member reads, edits, approves and sends every message themselves.

---

## 1. Approved context: what the AI sees

For each draft, the system builds a small, fixed set of facts about one donor. Only these go to the AI (Google Gemini, paid tier, so FFFA's data is not used to train Google's models).

| Sent to the AI | Detail |
|---|---|
| Why we're writing | The follow-up type (thank-you, failed payment, key date, …) |
| Who we're greeting | Preferred or first name. For companies and grant funders, the contact person's name and the organisation name. |
| Donor type | Individual, corporate or grant funder |
| Relationship | Months with FFFA, number of gifts, whether they also volunteer, how they know FFFA |
| Recent gifts | Last 3 gifts: date, amount (or item, for goods), campaign, programme |
| Monthly giving | Monthly amount and for how long, if they give monthly |
| Failed payment | Date, amount and platform (Giving.sg / GIVE.asia), only for failed-payment follow-ups |
| Interests | Programmes they care about (e.g. RTE, KidsLuvIt) |
| Key date | Type, date and label, only for key-date follow-ups |
| Notes | Latest 3 notes, cleaned (below), up to 300 characters each |
| Impact figures | Worked out by the system, e.g. "your S$50 provides around 5 meals for elderly people" |
| Upgrade suggestion | Current and suggested monthly amount (+50%, rounded up to S$5), only for upgrade asks |
| FFFA's name and sign-off | From settings |

**Never sent to the AI:** email addresses, mobile numbers, NRIC/FIN/UEN, tiers, internal flags, staff names, other donors. Before notes are sent, anything that looks like an email becomes `[email removed]`, phone numbers become `[number removed]` and NRIC/FIN numbers become `[id removed]`.

**Major donors are never drafted by AI.** S$5,000+ in 12 months, 3+ years with FFFA, or tagged by staff means personal outreach only.

---

## 2. The instructions the AI follows

Every draft uses the same fixed instructions (the "system prompt", in `server/services/ai/prompts.ts`). In plain English:

- **Voice:** warm, sincere and specific, like a staff member who knows this supporter. Simple Singapore English. No jargon, no corporate tone, no emojis, no piles of exclamation marks.
- **Facts:** use only the facts given. Never invent amounts, dates, programmes, events, stories or statistics. Use impact figures exactly as given, with no new calculations.
- **Organisations:** greet the contact person by name and thank the organisation.
- **Gifts of goods:** thank them for the specific items; never put a dollar value on them.
- **No pressure:** no guilt, urgency or comparisons. Never mention tiers or what others give.
- **At most one ask**, and only when the follow-up type calls for it.
- **Length:** 80–150 words, a subject under 70 characters, ending with FFFA's sign-off exactly.

**Extra guidance per follow-up type**

| Type | The AI is told to… | Ask? |
|---|---|---|
| Thank-you due | Thank them for the latest gift, say what it supports, using the impact figure | No |
| Failed payment | Thank them for monthly support, mention kindly that the payment didn't go through (e.g. an expired card), ask them to update details on that platform | Update details only |
| Going cold | Friendly check-in, appreciation, mention the programme they care about | No |
| Lapsed | Light "we miss your support", refer to what they gave before, always welcome back | No |
| Anniversary | Celebrate how long they've supported FFFA and what it meant | No |
| Key date | Sponsorship/grant renewal: thank them and invite a conversation. Grant report: say FFFA is preparing it and offer anything they need. | Conversation only |
| Upgrade ask | Thank them first, then one modest invitation to move to the suggested amount, using the extra impact. Easy to say no. | One, gentle |

---

## 3. Message templates

When there's no AI key, or the AI doesn't respond within 20 seconds, the system uses these standard templates instead. The draft shows **"Template"**. Staff check and edit them the same way. `{…}` is filled in from the donor's record.

**Thank-you due.** Subject: *Thank you for supporting Free Food For All*
> Dear {name}, Thank you so much for your recent donation. Your gift of S${amount} provides around {n} meals for elderly people. *(Goods: "Your gift of {items} goes straight to the families we serve.")* We are truly grateful to have you with us.

**Failed payment.** Subject: *A quick note about your monthly gift*
> Dear {name}, Thank you for your monthly support of Free Food For All. We noticed that your S${amount} monthly gift on {platform} didn't go through this time. This sometimes happens when a card expires. When convenient, you can update your payment details there. Thank you for being with us.

**Lapsed.** Subject: *We miss you at Free Food For All*
> Dear {name}, We wanted to say thank you again for the support you have given Free Food For All. It made a real difference to the families we serve. Whenever you'd like to be part of it again, you are always welcome.

**Anniversary.** Subject: *{n} years with Free Food For All*
> Dear {name}, It has been {n} years since you first supported Free Food For All. Thank you for standing with us and with the families we serve.

**Key date.** Subject: *{label}: a note from Free Food For All*
> Dear {name}, A quick note that {label} is due on {date}. Thank you for {organisation}'s partnership with Free Food For All, and do let us know if there is anything we can help with.

**Upgrade ask.** Subject: *Thank you for your monthly support*
> Dear {name}, Thank you for giving S${current} every month. Your steady support keeps our programmes going. If you are ever able to, moving to S${suggested} a month would provide around {n} more meals for elderly people each month. Either way, we are grateful to have you with us.

**Going cold / check-in.** Subject: *A note of thanks from Free Food For All*
> Dear {name}, We wanted to reach out and thank you for your support of Free Food For All. It means a lot to our team and to the families we serve. We hope you are keeping well.

Every template ends with the sign-off from settings (default *"Warm regards, The Free Food For All team"*).

---

## 4. Verification: check before you approve

Read the draft next to the donor's profile and tick every line:

- [ ] **Right person:** the name and greeting are correct. For organisations, it's the contact person's name.
- [ ] **Right facts:** every amount, date, programme, campaign and item matches the profile. Nothing is there that isn't on the profile.
- [ ] **Right numbers:** the impact line matches S$10 = 1 meal. No other statistics.
- [ ] **Right ask:** no ask unless the type calls for one, and never more than one.
- [ ] **Right tone:** warm, simple, no pressure or guilt, no tiers or comparisons, sounds like FFFA.
- [ ] **Right timing:** the donor hasn't been contacted about this in the last few days (check Conversation history).
- [ ] **Nothing private:** no internal notes, other donors or sensitive details copied into the message.

If any line fails, **edit it**, or **Regenerate** for a fresh version. If the AI made something up, don't send it, and report it (section 6).

---

## 5. Staff approval and record

1. **Approve.** This locks in your final wording and records who approved it and when.
2. **Send it yourself** with **Copy** or **Open in email**, from your own email or WhatsApp.
3. **Mark as sent**, choosing the channel. The exact message is saved on the donor's profile, the follow-up closes, and the "last contact" date resets.

Every step (generated, approved, edited or not, sent, discarded) is recorded in the activity log, along with whether the draft came from AI or a template and which prompt version was used.

---

## 6. Looking after the prompts (for whoever maintains the system)

- **Where things live:** the instructions and per-type guidance are in `server/services/ai/prompts.ts`, the templates in `server/services/ai/fallback.ts`, and what the AI sees in `server/services/ai/context.ts`.
- **Changing wording:** edit the file, then **bump `PROMPT_VERSION`** (e.g. `dm10-v2` → `dm10-v3`) so drafts from before and after can be compared. Run `npm test`. Generate a draft for each of the 9 practice donors (`npm run demo`) and check them against section 4 before merging.
- **Never** add contact details, ID numbers or tiers to the context, and keep major donors blocked. The tests check contact details and the major-donor block, and must keep passing.
- **When staff report a bad draft:** note the follow-up type and what was wrong, add a line to the relevant guidance or a rule to the instructions, bump the version, and re-check.
- **Monthly quality check:** read 5 sent messages (Staff Operating Guide, section 2). If staff keep rewriting the same thing, fix it in the prompt or template rather than by hand each time.
- **Model:** set with `GEMINI_MODEL` (default `gemini-3.6-flash`). When changing models, re-run the check above before using it for real donors.
