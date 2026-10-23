import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Staff } from '../../shared/types.ts';
import { createApp } from '../app.ts';
import { createDb, migrate, type Db } from '../db.ts';
import { DEMO_DOMAIN, seedDemo } from '../dev/demoSeed.ts';
import { devStaffResolver } from '../middleware/auth.ts';
import type { AiClient } from '../services/ai/client.ts';

let db: Db;

// One in-memory Postgres per file, reset before each test (see README conventions).
beforeAll(async () => {
  db = await createDb();
});
beforeEach(async () => {
  await db.exec('drop schema public cascade; create schema public;');
  await migrate(db);
});
afterAll(() => db.close());

const admin = () => createApp({ db, ai: null, resolveStaff: devStaffResolver(db) });

async function staffApp() {
  const [staff] = await db.query<Staff>(
    `insert into staff (name, email, role) values ('Volunteer', 'vol@fffa.test', 'staff') returning id, name, email, role, active`,
  );
  return createApp({ db, ai: null, resolveStaff: async () => staff });
}

describe('settings API', () => {
  it('returns rules, tiers and org settings with FFFA defaults', async () => {
    const { body } = await request(admin()).get('/api/settings').expect(200);
    expect(body.rules).toMatchObject({ thank_you_after_days: 3, lapsed_one_off_days: 180, failed_payment_window_days: 7 });
    expect(body.tiers.map((t: { tier: string }) => t.tier)).toEqual(['bronze', 'silver', 'gold', 'diamond']);
    expect(body.org).toMatchObject({ impact_unit_sgd: '10', major_min_12m_sgd: '5000', major_min_years: '3' });
  });

  it('is admin-only', async () => {
    const app = await staffApp();
    await request(app).get('/api/settings').expect(403);
    await request(app).patch('/api/settings').send({ rules: { thank_you_after_days: 2 } }).expect(403);
  });

  it('updates values, logs only what changed, and affects the computed summary', async () => {
    const res = await request(admin())
      .patch('/api/settings')
      .send({ rules: { thank_you_after_days: 2, lapsed_recurring_days: 45 }, tiers: [{ tier: 'gold', cadence_days: 30 }], org: { major_min_12m_sgd: '3000' } })
      .expect(200);
    expect(res.body.rules.thank_you_after_days).toBe(2);
    expect(res.body.tiers.find((t: { tier: string }) => t.tier === 'gold').cadence_days).toBe(30);

    const [log] = await db.query<{ action: string; diff: Record<string, unknown> }>(`select action, diff from activity_log`);
    expect(log.action).toBe('settings.update');
    expect(Object.keys(log.diff).sort()).toEqual(['org.major_min_12m_sgd', 'rules.thank_you_after_days', 'tiers.gold.cadence_days']);

    const [d] = await db.query<{ id: string }>(`insert into donors (first_name) values ('Test') returning id`);
    await db.query(`insert into donations (donor_id, donated_on, amount_sgd) values ($1, current_date - 3, 3500)`, [d.id]);
    const [s] = await db.query<{ is_major: boolean }>(`select is_major from donor_summary where donor_id = $1`, [d.id]);
    expect(s.is_major).toBe(true); // S$3,500 now clears the lowered S$3,000 threshold
  });

  it.each([
    [{ rules: { made_up: 5 } }, 'Unknown rule setting'],
    [{ rules: { thank_you_after_days: 0 } }, 'whole number above 0'],
    [{ tiers: [{ tier: 'platinum', cadence_days: 10 }] }, 'Unknown tier'],
    [{ tiers: [{ tier: 'silver', min_12m_giving_sgd: 9000 }] }, 'gold must need more giving than silver'],
    [{ tiers: [{ tier: 'bronze', min_12m_giving_sgd: 10 }] }, 'bronze must start at S$0'],
    [{ org: { impact_unit_sgd: 'ten' } }, 'impact_unit_sgd must be a number'],
    [{ org: { signature: '   ' } }, 'cannot be empty'],
  ])('rejects invalid changes without saving anything: %j', async (patch, message) => {
    const res = await request(admin()).patch('/api/settings').send(patch).expect(400);
    expect(res.body.code).toBe('INVALID_SETTINGS');
    expect(res.body.error).toContain(message);
    expect(await db.query(`select id from activity_log`)).toHaveLength(0);
  });
});

describe('read endpoints for the drafting screen', () => {
  it('lists open follow-ups with donor name, major flag and any open draft', async () => {
    await seedDemo(db);
    const { body: queue } = await request(admin()).get('/api/follow-ups').expect(200);
    expect(queue).toHaveLength(9);
    const acme = queue.find((q: { organisation_name: string }) => q.organisation_name === 'Acme Logistics Pte Ltd');
    expect(acme).toMatchObject({ reason: 'key_date', donor_name: 'Ravi Kumar', key_date_label: 'Food Redistribution sponsorship renewal', open_draft: null });
    expect(queue.find((q: { donor_name: string }) => q.donor_name === 'Boon Huat Tan').is_major).toBe(true);

    const { body: draft } = await request(admin()).post(`/api/follow-ups/${acme.id}/draft`).expect(201);
    const { body: after } = await request(admin()).get('/api/follow-ups').expect(200);
    expect(after.find((q: { id: string }) => q.id === acme.id).open_draft.id).toBe(draft.id);

    await request(admin()).get('/api/follow-ups?status=done').expect(200);
    await request(admin()).get('/api/follow-ups?status=bogus').expect(400);
  });

  it('returns a donor profile with summary, history and key dates', async () => {
    await seedDemo(db);
    const [priya] = await db.query<{ id: string }>(`select id from donors where email = $1`, [`priya@${DEMO_DOMAIN}`]);
    const { body } = await request(admin()).get(`/api/donors/${priya.id}`).expect(200);
    expect(body.donor.first_name).toBe('Priya');
    expect(body.donations).toHaveLength(3);
    expect(body.donations[0].payment_status).toBe('failed');
    expect(body.summary.donation_count).toBe(2); // the failed payment doesn't count
    expect(body.follow_ups[0].reason).toBe('failed_payment');

    await request(admin()).get('/api/donors/00000000-0000-0000-0000-000000000000').expect(404);
  });
});

describe('demo data', () => {
  it('loads once and drafts every follow-up without leaking contact details', async () => {
    expect(await seedDemo(db)).toBe(9);
    expect(await seedDemo(db)).toBe(0);

    const prompts: string[] = [];
    const ai: AiClient = {
      model: 'fake',
      generateDraft: async ({ prompt }) => {
        prompts.push(prompt);
        return { subject: 'Hello', body: 'Draft body' };
      },
    };
    const app = createApp({ db, ai, resolveStaff: devStaffResolver(db) });
    const { body: queue } = await request(app).get('/api/follow-ups').expect(200);

    for (const item of queue) {
      const res = await request(app).post(`/api/follow-ups/${item.id}/draft`);
      expect(res.status).toBe(item.is_major ? 422 : 201);
    }
    expect(prompts).toHaveLength(8); // everyone except the major donor
    const all = prompts.join('\n');
    expect(all).not.toContain(DEMO_DOMAIN);
    expect(all).not.toContain('9123 4567');
    expect(all).toContain('[number removed]');
    expect(all).toContain('200 packs of rice');
    expect(all).toContain('"platform": "GIVE.asia"');
  });
});
