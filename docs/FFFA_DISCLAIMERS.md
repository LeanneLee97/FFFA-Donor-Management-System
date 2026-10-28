# Read before using this system: notes for FFFA

*Prepared by the Empact × FFFA Systems team. This is project guidance, not legal advice. Please have FFFA's own advisers confirm anything marked "check".*

## 1. What you are looking at
A **working prototype (MVP)** built in three weeks. It runs on our laptop with fictional data. It is **not yet a live, hosted system** and should not hold real donor information.

## 2. Before any real donor data goes in
All of these should be done first.

| # | Item | Status |
|---|---|---|
| 1 | **Real staff login.** The demo signs everyone in automatically as an admin. Hosted use needs proper sign-in (Supabase Auth), a list of approved staff, and an admin-only role for settings and exports. | **Not built** |
| 2 | **Hosting decided.** Who hosts it, in which country, and who pays. We recommend a Singapore region. | **Open** |
| 3 | **Privacy review (PDPA).** Names, emails, mobiles and giving history are personal data. FFFA should confirm its consent wording, purpose, retention period, how people can ask for their data to be corrected or removed, and who is the data protection contact. The system supports removing a donor on request (admin only). | **FFFA to do** |
| 4 | **Backups and recovery.** Confirm the database plan includes automatic backups and test a restore once. Free plans may not. | **Check** |
| 5 | **A named owner.** Someone at FFFA (or a partner) who looks after logins, updates and costs after handover. | **Open** |

## 3. Deploying it: what to know
- **Recommended set-up:** the app as one container on a managed host (for example Google Cloud Run or Render), with a managed Postgres database (Supabase) and Supabase login. The code is portable, so FFFA is not locked to one provider.
- **Secrets** (database address, AI key) are set as environment variables on the host, never typed into the app or committed to code.
- **Never use the demo mode online.** It signs in everyone as admin. The app refuses to start in production with it, and that must stay.
- **Ongoing work is real work:** security updates to the software, rotating keys, adding and removing staff (there is no screen for staff accounts yet; it is done in the database), and watching costs.
- **Automatic daily follow-up check is not scheduled yet.** Today a person presses refresh. A scheduled job must be added when hosted.
- **Dates use UTC.** Before 8am Singapore time, "today" can be off by one day. To be fixed before launch.

## 4. The AI drafting feature
- **A person always reviews and sends.** The system never emails or messages donors.
- If you switch on AI drafts, the donor's **display name, gift amounts and dates, campaign, in-kind descriptions, tenure and short relationship notes** are sent to Google's Gemini service. **Email, mobile, tier and tax IDs are never sent.** Staff should still avoid typing sensitive details into notes.
- Data going to Google means it leaves Singapore. **Check** Google's terms for the plan you use (free-tier terms can allow use of content for product improvement; paid terms generally do not) and whether FFFA's donor consent covers it.
- AI can make mistakes. Drafts can be wrong, awkward or off-tone, so they are always editable and must be read before sending.
- **Major donors get no AI drafts** by design (S$5,000+ in 12 months, 3+ years with FFFA, or tagged by staff).
- Without an AI key the system uses fixed templates and everything else works.

## 5. Your data
- **Exports contain personal data.** "Export to Excel" is admin-only and logged, but the downloaded file is outside the system's control. Store it securely, share it only as needed and delete old copies.
- **Do not add NRIC, FIN, UEN, or sensitive details** (age, income, ethnicity, health) to any field or note. The system is not designed to protect them. Tax-deductible receipts (IRAS) are **not supported yet**; adding identifiers later needs a separate, encrypted, admin-only design.
- **Imports:** the Excel and Giving.sg / GIVE.asia imports skip rows with errors and never duplicate a gift with the same platform reference, but they depend on the file being correct. Spot-check the first real import.
- **Audit log:** imports, edits, drafts, approvals and exports are recorded (who, what, when) without personal details. There is no screen for it yet; admins can view it through the system's activity feed.
- **Deleting vs hiding:** donors are archived by default; donations are voided (never deleted) for financial records; permanent deletion is admin-only.

## 6. Known limitations at handover
- Only part of the screens are polished; no mobile layout.
- No automatic email/WhatsApp sending or newsletters, by design.
- Follow-up rules are sensible defaults you confirmed (editable in Settings), but have only been tested on fictional data. Expect to adjust after the first month.
- Most imported donors will show as "going cold" until contact history is logged, because the system measures time since the last logged contact.
- Concurrent edits by many staff at once have not been load-tested.

## 7. What we need from FFFA to go live
1. A decision on hosting and the post-handover owner.
2. PDPA sign-off for storing donor data and for using the AI service.
3. The list of staff and their roles.
4. A sample (not full) real export to test the import against.
