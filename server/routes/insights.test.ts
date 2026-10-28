import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createDb, migrate, type Db } from '../db.ts';
import { seedDemo } from '../dev/demoSeed.ts';
import { devStaffResolver } from '../middleware/auth.ts';
import { normMobile, parseCsv } from '../services/importer.ts';

let db: Db;
beforeAll(async () => {
  db = await createDb();
});
beforeEach(async () => {
  await db.exec('drop schema public cascade; create schema public;');
  await migrate(db);
});
afterAll(() => db.close());

const app = () => createApp({ db, ai: null, resolveStaff: devStaffResolver(db) });
const sample = (name: string) => readFileSync(new URL(`../../docs/samples/${name}`, import.meta.url), 'utf8');

describe('CSV import (DM6)', () => {
  it('parses quoted cells and normalises Singapore mobiles', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(normMobile('+65 9123 4567')).toBe('91234567');
    expect(normMobile('9123-4567')).toBe('91234567');
  });

  it('previews without writing, then imports matching across both platforms', async () => {
    await seedDemo(db);
    const donorsBefore = (await db.query('select id from donors')).length;

    const { body: preview } = await request(app())
      .post('/api/import/preview')
      .send({ platform: 'giving_sg', csv: sample('giving_sg_sample.csv') })
      .expect(200);
    expect(preview.rows.map((r: { status: string }) => r.status)).toEqual(['matched', 'new_donor', 'new_donor', 'review', 'error']);
    expect(preview.rows[0].matched_on).toBe('email');
    expect(await db.query('select id from donors')).toHaveLength(donorsBefore);

    const { body: gsg } = await request(app())
      .post('/api/import/commit')
      .send({ platform: 'giving_sg', csv: sample('giving_sg_sample.csv') })
      .expect(200);
    expect(gsg).toMatchObject({ donations_added: 3, donors_added: 2 });
    expect(gsg.follow_ups_created).toBeGreaterThan(0); // thank-yous for the new gifts

    // Same donor on GIVE.asia: Kelvin matches by email (any case), Farhan's second row by mobile.
    const { body: ga } = await request(app())
      .post('/api/import/commit')
      .send({ platform: 'give_asia', csv: sample('give_asia_sample.csv') })
      .expect(200);
    expect(ga.rows.map((r: { status: string }) => r.status)).toEqual(['matched', 'matched', 'new_donor', 'matched']);
    expect(ga).toMatchObject({ donations_added: 4, donors_added: 1 });
    const [kelvin] = await db.query<{ channels: string[] }>(
      `select array_agg(distinct x.channel order by x.channel) as channels
       from donations x join donors d on d.id = x.donor_id where d.email = 'kelvin.ong@demo.fffa.test'`,
    );
    expect(kelvin.channels).toEqual(['give_asia', 'giving_sg']);
    const [farhan] = await db.query<{ n: number }>(
      `select count(*)::int as n from donations x join donors d on d.id = x.donor_id where d.first_name = 'Farhan'`,
    );
    expect(farhan.n).toBe(2);
    const [failed] = await db.query<{ payment_status: string }>(
      `select payment_status from donations where external_ref = 'GA-55002'`,
    );
    expect(failed.payment_status).toBe('failed');

    // Re-importing the same file never double-counts.
    const { body: again } = await request(app())
      .post('/api/import/commit')
      .send({ platform: 'give_asia', csv: sample('give_asia_sample.csv') })
      .expect(200);
    expect(again).toMatchObject({ donations_added: 0, counts: { duplicate: 4 } });

    const [log] = await db.query<{ diff: Record<string, unknown> }>(
      `select diff from activity_log where action = 'import.run' order by id limit 1`,
    );
    expect(log.diff).toMatchObject({ platform: 'giving_sg', donations_added: 3, review: 1, error: 1 });
  });

  it('rejects files without the needed columns or an unknown platform', async () => {
    const bad = await request(app()).post('/api/import/preview').send({ platform: 'giving_sg', csv: 'foo,bar\n1,2' }).expect(400);
    expect(bad.body.code).toBe('MISSING_COLUMNS');
    await request(app()).post('/api/import/preview').send({ platform: 'paypal', csv: sample('give_asia_sample.csv') }).expect(400);
    await request(app()).post('/api/import/preview').send({ platform: 'giving_sg' }).expect(400);
  });
});

describe('dashboard (DM5) and activity log (DM7)', () => {
  it('returns aggregates only, with 12 months of series', async () => {
    await seedDemo(db);
    const { body } = await request(app()).get('/api/dashboard').expect(200);
    expect(body.donors).toMatchObject({ total: 9, major: 1 });
    expect(body.giving_12m_sgd).toBeGreaterThan(0);
    expect(body.monthly_recurring_sgd).toBe(50); // Mei Ling 30 + Priya 20 (last good payment 32 days ago)
    expect(body.months).toHaveLength(12);
    expect(body.follow_ups.find((f: { reason: string }) => f.reason === 'key_date').pending).toBe(2);
    expect(JSON.stringify(body)).not.toContain('demo.fffa.test');
  });

  it('lists recent activity for admins, newest first', async () => {
    await seedDemo(db);
    await request(app()).post('/api/import/commit').send({ platform: 'give_asia', csv: sample('give_asia_sample.csv') }).expect(200);
    const { body } = await request(app()).get('/api/activity?entity=import').expect(200);
    expect(body[0]).toMatchObject({ action: 'import.run', actor_name: expect.any(String) });
  });
});
