# FFFA Donor Management MVP

A staff-facing donor management system for **Free Food For All**, built in the Empact × FFFA AI Impact Sprint (7–28 Oct 2026). Phase 1 gives FFFA one place to keep every donor relationship, surfaces follow-ups automatically, and drafts personal follow-up messages with AI for staff to edit and approve.

- **Requirements:** PRD v2 (shared Drive)
- **Design:** [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) (also as PDF)

## Run it locally

```bash
npm install --legacy-peer-deps
npm run dev
```

Open http://localhost:3000. No setup needed: it uses an embedded Postgres (PGlite) stored in `.data/pglite`, signs you in as a dev admin, and drafts with templates until you add a `GEMINI_API_KEY` to `.env` (see [.env.example](.env.example)).

To try the AI drafting screen with 9 fictional donors (one per follow-up type):

```bash
npm run demo
```

```bash
npm test        # API + service tests (in-memory database)
npm run lint    # type-check
```

Reset your local database any time with `rm -rf .data`.

## Stack

React 19 + Vite + TypeScript + Tailwind (frontend) · Express API · Postgres (Supabase in production, PGlite locally) · Supabase Auth · Gemini via `@google/genai`.

## Structure

```
server/
  index.ts            # entry: DB, migrations, auth mode, Vite in dev
  app.ts              # Express app (testable without a server)
  db.ts               # Postgres / PGlite + migration runner
  migrations/         # SQL schema, run in filename order
  middleware/auth.ts  # requireStaff, requireAdmin, auth resolvers
  routes/             # one router per slice
  services/
    activity.ts       # audit log (DM7)
    ai/               # DM10: context, prompts, fallbacks, Gemini client, drafting
shared/types.ts       # domain types used by API and frontend
src/                  # React app
docs/                 # system design
```

## Phase 1 status

| Slice | PRD | Owner | Status |
|---|---|---|---|
| Platform: schema (001 + 002 FFFA feedback), DB layer with transactions, auth hook, activity log hook, shared types | DM7 | Ghanashyam | Done |
| AI drafting: draft → edit → approve → mark as sent (message saved on profile), major-donor block, template fallback, drafting screen + demo data | DM10 | Ghanashyam | Done (live Gemini test pending an API key) |
| Settings API (admin): follow-up rules, tiers, impact unit, major thresholds | DM9, DM10 | Ghanashyam | Done (Settings screen: Chris) |
| Read-only follow-up queue and donor profile endpoints (used by the drafting screen) | DM2, DM3, DM9 | Ghanashyam | Done; writes and filters: Swaraj |
| Donors, donations (cash + in-kind), notes, engagements, key dates: create / update / archive | DM1–DM3, DM8 | Swaraj | Done (API) |
| Follow-up rules engine (incl. key dates, failed payments) + queue API | DM4, DM9 | Swaraj | Done (API) |
| Supabase Auth + all screens except dashboard | DM7, UI | Chris | To do |
| CSV import with Giving.sg + GIVE.asia matching (`/api/import/preview`, `/commit`), dashboard API + screen, activity log endpoint | DM5, DM6, DM7 | Lynn | Done (Import screen: Chris; sample files in `docs/samples/`) |

## Conventions

- Add a new migration file for schema changes (`002_…sql`); never edit one that has been merged.
- Wrap async routes in `asyncRoute` and log every write with `logActivity`.
- Throw `HttpError(status, code, message)` (server/lib/errors.ts) for expected errors; the app turns it into `{ error, code }`.
- Use `db.transaction(async (tx) => …)` when one action writes several tables (see `markDraftSent`).
- In tests, share one in-memory database per file and reset the schema in `beforeEach` (see `drafts.test.ts`); a new PGlite per test stalls after about a dozen.
- Use dummy or de-identified data only. Never commit real donor data or `.env`.
- Every pull request gets one review from a teammate.

The previous AI Studio prototype is preserved on the `legacy/ai-studio-demo` branch.
