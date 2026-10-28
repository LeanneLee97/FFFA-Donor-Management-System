import type { Db } from '../db.ts';
import { runRulesEngine } from '../services/rules/engine.ts';

/**
 * Fictional donors for demoing DM10 (AI drafting), one per follow-up reason.
 * Dev only: loaded by `npm run demo`. Lynn's full seed data set replaces this later.
 * All emails use the reserved demo domain so the rows are easy to find and remove.
 * The queue comes from the rules engine (not hand-made rows), so a later refresh never duplicates it.
 */
export const DEMO_DOMAIN = 'demo.fffa.test';

interface DemoDonor {
  key: string;
  donor: Record<string, unknown>;
  /** [days ago, amount SGD, extras] */
  gifts?: [number, number | null, Record<string, unknown>?][];
  notes?: string[];
  keyDate?: { kind: string; inDays: number; label: string };
  /** The follow-up this donor is here to demo; the rules engine raises it from the data above. */
  expects: string;
  pastMessage?: { daysAgo: number; subject: string; body: string };
}

const DONORS: DemoDonor[] = [
  {
    key: 'meiling',
    donor: { first_name: 'Mei Ling', last_name: 'Tan', programme_interest: ['RTE'], how_they_know_fffa: 'Volunteered at a festive food drive', also_volunteers: true },
    gifts: Array.from({ length: 14 }, (_, i) => [30 * i + 5, 30, { channel: 'giving_sg', is_recurring: true, monthly_amount_sgd: 30, programme: 'RTE', thanked: true }]),
    notes: ['Prefers email. Mentioned her mother benefited from RTE meals during COVID.'],
    expects: 'upgrade_candidate',
    pastMessage: { daysAgo: 60, subject: 'Thank you for a year of monthly support', body: 'Dear Mei Ling,\n\nThank you for a full year of giving S$30 every month...' },
  },
  {
    key: 'acme',
    donor: { donor_type: 'corporate', organisation_name: 'Acme Logistics Pte Ltd', first_name: 'Ravi', last_name: 'Kumar', contact_title: 'CSR Manager', programme_interest: ['Food Redistribution'] },
    gifts: [[120, 2000, { channel: 'bank', campaign: 'Steps for Meals', programme: 'Food Redistribution', thanked: true }]],
    keyDate: { kind: 'sponsorship_expiry', inDays: 21, label: 'Food Redistribution sponsorship renewal' },
    expects: 'key_date',
  },
  {
    key: 'hope',
    donor: { donor_type: 'grant_funder', organisation_name: 'Harbour Hope Foundation', first_name: 'Sarah', last_name: 'Lim', contact_title: 'Programme Officer', programme_interest: ['KidsLuvIt'] },
    gifts: [[150, 4000, { channel: 'bank', programme: 'KidsLuvIt', thanked: true }]],
    keyDate: { kind: 'grant_report', inDays: 14, label: 'KidsLuvIt Q4 grant report' },
    expects: 'key_date',
  },
  {
    key: 'daniel',
    donor: { first_name: 'Daniel', last_name: 'Wong', programme_interest: ['General'] },
    gifts: [[220, 50, { channel: 'give_asia', campaign: 'Steps for Meals', thanked: true }]],
    expects: 'lapsed',
  },
  {
    key: 'priya',
    donor: { first_name: 'Priya', last_name: 'Nair', programme_interest: ['KidsLuvIt'] },
    gifts: [
      [2, 20, { channel: 'give_asia', is_recurring: true, monthly_amount_sgd: 20, payment_status: 'failed' }],
      [32, 20, { channel: 'give_asia', is_recurring: true, monthly_amount_sgd: 20, thanked: true }],
      [62, 20, { channel: 'give_asia', is_recurring: true, monthly_amount_sgd: 20, thanked: true }],
    ],
    expects: 'failed_payment',
  },
  {
    key: 'ahmad',
    donor: { first_name: 'Ahmad', last_name: 'Rahman', preferred_name: 'Ahmad', programme_interest: ['RTE'] },
    gifts: [[4, 100, { channel: 'paynow', programme: 'RTE', thanked: false }]],
    // The phone number shows that contact details typed into notes never reach the AI.
    notes: ['First-time donor, heard about us from a Straits Times article. Call 9123 4567 if needed.'],
    expects: 'thank_you_due',
  },
  {
    key: 'grace',
    donor: { first_name: 'Grace', last_name: 'Lee', programme_interest: ['Food Redistribution'] },
    gifts: [[4, null, { kind: 'in_kind', in_kind_description: '200 packs of rice', estimated_value_sgd: 800, channel: 'in_person', thanked: false }]],
    expects: 'thank_you_due',
  },
  {
    key: 'boonhuat',
    donor: { first_name: 'Boon Huat', last_name: 'Tan', programme_interest: ['RTE', 'KidsLuvIt'] },
    gifts: [[40, 5000, { channel: 'bank', thanked: true }], [100, 3000, { channel: 'bank', thanked: true }]],
    expects: 'cadence_due',
  },
  {
    key: 'siti',
    donor: { first_name: 'Siti', last_name: 'Aminah', programme_interest: ['KidsLuvIt'] },
    gifts: [[25, 15, { channel: 'giving_sg', thanked: true }], [730 - 5, 15, { channel: 'giving_sg', thanked: true }]],
    expects: 'anniversary',
  },
];

/** Demo key (the email's local part) → the follow-up that donor should raise. */
export const DEMO_EXPECTS: Record<string, string> = Object.fromEntries(DONORS.map((d) => [d.key, d.expects]));

/** Inserts the demo donors once. Returns how many were added (0 if already present). */
export async function seedDemo(db: Db): Promise<number> {
  const [{ n }] = await db.query<{ n: number }>(
    `select count(*)::int as n from donors where email like '%@${DEMO_DOMAIN}'`,
  );
  if (n > 0) return 0;

  await db.transaction(async (tx) => {
    for (const d of DONORS) {
      const fields = { donor_type: 'individual', programme_interest: [], ...d.donor, email: `${d.key}@${DEMO_DOMAIN}` };
      const cols = Object.keys(fields);
      const [{ id }] = await tx.query<{ id: string }>(
        `insert into donors (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
        Object.values(fields),
      );

      for (const [daysAgo, amount, extra = {}] of d.gifts ?? []) {
        const g = { kind: 'cash', amount_sgd: amount, ...extra };
        const gCols = Object.keys(g);
        await tx.query(
          `insert into donations (donor_id, donated_on, ${gCols.join(', ')})
           values ($1, current_date - $2::int, ${gCols.map((_, i) => `$${i + 3}`).join(', ')})`,
          [id, daysAgo, ...Object.values(g)],
        );
      }
      for (const body of d.notes ?? []) {
        await tx.query('insert into notes (donor_id, body) values ($1, $2)', [id, body]);
      }

      if (d.keyDate) {
        await tx.query(
          `insert into key_dates (donor_id, kind, due_on, label) values ($1, $2, current_date + $3::int, $4)`,
          [id, d.keyDate.kind, d.keyDate.inDays, d.keyDate.label],
        );
      }
      if (d.pastMessage) {
        await tx.query(
          `insert into engagements (donor_id, engaged_on, channel, summary, message_subject, message_body)
           values ($1, current_date - $2::int, 'email', 'Sent follow-up', $3, $4)`,
          [id, d.pastMessage.daysAgo, d.pastMessage.subject, d.pastMessage.body],
        );
      }
    }
  });
  await runRulesEngine(db);
  return DONORS.length;
}
