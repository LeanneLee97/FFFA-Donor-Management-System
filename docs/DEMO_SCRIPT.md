# FFFA Demo: 20-minute script

Story to tell: *"Your donor list lives in spreadsheets and memory. In 20 minutes you'll see it become one place that tells your team who to talk to today, and helps write the message, while a person always reviews and sends."*

All data is fictional (`example.org` emails). Run it locally on your laptop.

---

## Before the demo (do this the day before, then again 30 minutes before)

```bash
cd FFFA-Donor-Management-System
npm install --legacy-peer-deps      # first time only
npm run lint && npm test            # both should pass; fix before demoing
npm run demo:files                  # creates docs/samples/fffa-demo-donors.xlsx and fffa-demo-update.xlsx
```

Re-run `npm run demo:files` **on the day**: dates in the files are relative to today, which is what makes the thank-you, lapsed, key-date and anniversary follow-ups fire.

### Remove the old seed (start from an empty app)
The earlier `npm run demo` loaded 9 built-in donors. To remove them:

1. Stop the app (Ctrl+C in the terminal that is running it).
2. `npm run demo:reset` (deletes the local database in `.data/`).
3. `npm run dev` (**not** `npm run demo`, which would load the seed again).
4. Open http://localhost:3000. Donors, Follow-ups and Dashboard should all be empty.

### Optional: real AI drafts
Paste a Gemini key after `GEMINI_API_KEY=` in `.env`, restart. Without a key, drafts come from templates, and the header says "AI: templates only". Say this out loud if you skip the key; the flow is identical. Don't put a key on screen.

### Open these before you start
- Tab 1: http://localhost:3000
- Tab 2: http://localhost:3000/api/activity (the audit log, used at 18:00)
- File manager open at `docs/samples/`

---

## Run of show

| Time | Tab | What you do | What they see / what to say |
|---|---|---|---|
| **0:00–1:30** | Follow-ups | Show the empty app. | "This is Free Food For All's data home. Today it's empty, like a new install. Everything you see next is fictional." |
| **1:30–5:00** | **Import** | Click **Download template**, open it briefly (Instructions sheet, three sheets, dropdowns). Then **Choose Excel file** → `fffa-demo-donors.xlsx`. | Preview: **12 new donors, 30 donations, 3 key dates, 0 errors**. "Nothing is saved yet. Every row says what will happen." Click **Import 12 donors…**. |
| **5:00–7:30** | **Donors** | Search "tan", filter by Corporates. Click **Boon Huat Tan**, then **Acme Logistics**. | "Major" badge on Boon Huat (S$8,000 in 12 months), Wei Lim (3+ years) and Jasmine Ong (tagged by staff). Acme shows the contact person and role. "Tier is internal, never sent to the AI or shown to donors." |
| **7:30–9:30** | **Follow-ups** | Press the refresh icon (top of the list). | The queue fills (17 items): thank-you due (Ahmad, Grace, Michelle), failed payment (Priya), key dates (Acme, Harbour Hope), lapsed (Daniel, Acme), anniversary (Siti), upgrade (Mei Ling), going cold (most). "These came from rules you agreed, not from someone's memory." Note: most show "going cold" because the import has no contact history yet. |
| **9:30–15:00** | Follow-ups | **Ahmad Rahman** (thank-you): *Generate draft* → edit one line → *Approve* → *Copy* → pick "email" → **Mark as sent**. Then **Priya Nair** (failed payment): generate, point out the no-guilt tone. Then click **Boon Huat Tan**. | Message mentions what he gave and meals (S$10 = 1 meal) calculated by the system, not the AI. "Nothing sends from the system. Your team sends it, then marks it sent, and the exact message is kept on his history." Boon Huat: **AI disabled, personal outreach**. "Your rule: major donors get a human." |
| **15:00–16:30** | **Donors** | Open **Ahmad Rahman** → *Conversation history* is on the drafting screen; here use **Log a donation**: cash S$50, channel paynow, campaign "Steps for Meals". Add a note. | The 12-month total, last gift date and tier update immediately. "One gift or one in-kind drop (Grace's rice) takes 20 seconds." |
| **16:30–18:00** | **Import** | Upload `fffa-demo-update.xlsx`. | Shows the safety net: Mei Ling **matched** by email; Ahmad Rahman with a different email = **"Needs your decision"** (pick "No, create a new donor" or the existing one); a repeated Giving.sg/GIVE.asia reference = **Already there**; a bad date, a missing organisation and a gift for an unknown donor = **Fix in Excel**. Import. "Re-uploading never double counts, and nothing is half-saved." |
| **18:00–19:00** | Tab 2 + **Dashboard** | Show the `/api/activity` JSON, then the Dashboard. | "Every import, draft, approval and send is logged: who, what, when, no personal details." Dashboard shows totals, tiers, pending follow-ups, monthly giving. |
| **19:00–19:40** | **Settings** / **Donors** | Settings: show "Remind to thank after (days)" and the major-donor threshold. Donors: **Export to Excel**. | "You own the rules; change them without us." "Your data always comes back out as the same Excel format." |
| **19:40–20:00** | | Close. | "Next: hosting, real login, and your first real-data import after a privacy review." Hand over `docs/FFFA_DISCLAIMERS.md`. |

**If you are running late:** drop the Priya draft and the log-a-donation step (together 4 minutes). Never drop the import preview or the major-donor block; they carry the story.

---

## Expected numbers (check during rehearsal)

After `fffa-demo-donors.xlsx` (dates relative to today):

| Donor | Tier | Major? | Follow-ups you should see |
|---|---|---|---|
| Mei Ling Tan | Bronze | | Upgrade ask, going cold |
| Acme Logistics | Silver | | Key date (sponsorship renewal in 21 days), lapsed, going cold |
| Harbour Hope Foundation | Silver | | Key date (grant report in 14 days), going cold |
| Daniel Wong | Bronze | | Lapsed, going cold |
| Priya Nair | Bronze | | Failed payment |
| Ahmad Rahman | Bronze | | Thank-you due |
| Grace Lee | Bronze | | Thank-you due (in-kind rice) |
| Boon Huat Tan | Gold | Yes (S$5,000+ a year) | Going cold, personal outreach |
| Siti Aminah | Bronze | | Anniversary (in 5 days), going cold |
| Wei Lim | Bronze | Yes (3+ years) | Going cold, personal outreach |
| Jasmine Ong | Bronze | Yes (tagged) | None |
| Sunrise Bakery | Bronze | | Thank-you due (in-kind bread) |

After `fffa-demo-update.xlsx`: 1 new donor (Nurul Huda), 1 matched (Mei Ling), 1 needs a decision (Ahmad), 1 new donation, 1 duplicate, **3 rows to fix**.

If a number differs, the likeliest cause is that the app was not reset, or the files were not regenerated today.

## Rehearsal checklist

- [ ] Reset, regenerate files, run the whole table above once end to end with a timer.
- [ ] Run it a second time without reading this page. Target 18 minutes, leaving 2 for questions.
- [ ] Decide AI key or templates, and say which one.
- [ ] Check the browser zoom is readable on the shared screen; close notifications.
- [ ] Keep `docs/samples/` and a backup copy of both `.xlsx` files on a USB stick.
- [ ] Have the fallback ready: if the app misbehaves, stop, `npm run demo:reset`, `npm run dev`, re-import (2 minutes).

## What not to claim
- It does not send email or WhatsApp. Staff send.
- It is not online. Login for a hosted version is not built yet.
- Follow-ups refresh when someone presses the refresh icon; the automatic daily run is not scheduled yet.
- No tax-receipt (IRAS) support yet, and no NRIC/UEN stored.
