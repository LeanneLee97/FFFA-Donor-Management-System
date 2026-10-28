import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Donor, DonorListItem, Staff } from '../../shared/types.ts';
import { createApp } from '../app.ts';
import { createDb, migrate, type Db } from '../db.ts';
import { devStaffResolver } from '../middleware/auth.ts';

let db: Db;

beforeAll(async () => {
  db = await createDb();
});

beforeEach(async () => {
  await db.exec('drop schema public cascade; create schema public;');
  await migrate(db);
});

afterAll(() => db.close());

const admin = () => createApp({ db, ai: null, resolveStaff: devStaffResolver(db) });

async function staffApp(name = 'Volunteer', email = 'vol@fffa.test') {
  const [staff] = await db.query<Staff>(
    `insert into staff (name, email, role) values ($1, $2, 'staff') returning id, name, email, role, active`,
    [name, email],
  );
  return { app: createApp({ db, ai: null, resolveStaff: async () => staff }), staff };
}

describe('donors API', () => {
  it('creates an individual donor and records activity log', async () => {
    const res = await request(admin())
      .post('/api/donors')
      .send({
        donor_type: 'individual',
        first_name: 'Ahmad',
        last_name: 'Ibrahim',
        email: 'ahmad@example.sg',
        mobile: '91234567',
        programme_interest: ['RTE', 'KidsLuvIt'],
      })
      .expect(201);

    expect(res.body).toMatchObject({
      first_name: 'Ahmad',
      last_name: 'Ibrahim',
      email: 'ahmad@example.sg',
      mobile: '91234567',
      donor_type: 'individual',
      programme_interest: ['RTE', 'KidsLuvIt'],
      archived_at: null,
    });

    const [log] = await db.query<{ action: string; entity_type: string; entity_id: string }>(
      'select action, entity_type, entity_id from activity_log where entity_type = $1',
      ['donor'],
    );
    expect(log.action).toBe('donor.create');
    expect(log.entity_id).toBe(res.body.id);
  });

  it('creates a corporate donor with organisation name and contact person', async () => {
    const res = await request(admin())
      .post('/api/donors')
      .send({
        donor_type: 'corporate',
        organisation_name: 'Temasek Foundation',
        first_name: 'Grace',
        last_name: 'Tan',
        contact_title: 'Director of CSR',
        email: 'grace@temasek.test',
      })
      .expect(201);

    expect(res.body.organisation_name).toBe('Temasek Foundation');
    expect(res.body.contact_title).toBe('Director of CSR');
    expect(res.body.donor_type).toBe('corporate');
  });

  it('validates required name and organisation for corporates', async () => {
    const noName = await request(admin()).post('/api/donors').send({ donor_type: 'individual' }).expect(400);
    expect(noName.body.code).toBe('INVALID_DONOR');

    const noOrg = await request(admin())
      .post('/api/donors')
      .send({ donor_type: 'corporate', first_name: 'Grace' })
      .expect(400);
    expect(noOrg.body.code).toBe('INVALID_DONOR');
    expect(noOrg.body.error).toContain('Organisation name is required');
  });

  it('lists donors and filters by query, type, tier, lastDonationBefore, and owner', async () => {
    const app = admin();
    const [owner1] = await db.query<Staff>(
      `insert into staff (name, email) values ('Staff 1', 's1@fffa.test') returning *`,
    );

    const { body: d1 } = await request(app).post('/api/donors').send({
      first_name: 'Tan',
      last_name: 'Ah Kow',
      preferred_name: 'Uncle Tan',
      email: 'tan@example.com',
      relationship_owner: owner1.id,
    });

    const { body: d2 } = await request(app).post('/api/donors').send({
      donor_type: 'corporate',
      organisation_name: 'Acme Corp',
      first_name: 'John',
      last_name: 'Doe',
    });

    // Tan donates cash S$6,000 (Gold tier)
    await request(app).post(`/api/donors/${d1.id}/donations`).send({
      donated_on: '2026-05-01',
      kind: 'cash',
      amount_sgd: 6000,
      channel: 'paynow',
    });

    // Acme donates S$500 (Bronze tier) on 2025-01-01
    await request(app).post(`/api/donors/${d2.id}/donations`).send({
      donated_on: '2025-01-01',
      kind: 'cash',
      amount_sgd: 500,
      channel: 'bank',
    });

    // 1. List all
    const { body: all } = await request(app).get('/api/donors').expect(200);
    expect(all).toHaveLength(2);
    expect(all.map((d: DonorListItem) => d.donor_name)).toContain('Tan Ah Kow');
    expect(all.map((d: DonorListItem) => d.organisation_name)).toContain('Acme Corp');

    // 2. Query filter
    const { body: queryMatch } = await request(app).get('/api/donors?query=kow').expect(200);
    expect(queryMatch).toHaveLength(1);
    expect(queryMatch[0].id).toBe(d1.id);

    // 3. Type filter
    const { body: corpOnly } = await request(app).get('/api/donors?type=corporate').expect(200);
    expect(corpOnly).toHaveLength(1);
    expect(corpOnly[0].id).toBe(d2.id);

    // 4. Tier filter
    const { body: goldOnly } = await request(app).get('/api/donors?tier=gold').expect(200);
    expect(goldOnly).toHaveLength(1);
    expect(goldOnly[0].id).toBe(d1.id);

    // 5. Owner filter
    const { body: ownerOnly } = await request(app).get(`/api/donors?owner=${owner1.id}`).expect(200);
    expect(ownerOnly).toHaveLength(1);
    expect(ownerOnly[0].id).toBe(d1.id);

    // 6. lastDonationBefore filter
    const { body: oldDonors } = await request(app).get('/api/donors?lastDonationBefore=2026-01-01').expect(200);
    expect(oldDonors).toHaveLength(1);
    expect(oldDonors[0].id).toBe(d2.id);
  });

  it('updates donor and logs diff', async () => {
    const { body: donor } = await request(admin())
      .post('/api/donors')
      .send({ first_name: 'Initial', last_name: 'Name' });

    const { body: updated } = await request(admin())
      .patch(`/api/donors/${donor.id}`)
      .send({ first_name: 'Updated', major_override: true })
      .expect(200);

    expect(updated.first_name).toBe('Updated');
    expect(updated.major_override).toBe(true);

    const [log] = await db.query<{ action: string; diff: Record<string, { from: unknown; to: unknown }> }>(
      'select action, diff from activity_log where action = $1',
      ['donor.update'],
    );
    expect(log.diff.first_name).toEqual({ from: 'Initial', to: 'Updated' });
    expect(log.diff.major_override).toEqual({ from: false, to: true });
  });

  it('archives donor and hides from donor listings', async () => {
    const { body: donor } = await request(admin())
      .post('/api/donors')
      .send({ first_name: 'To', last_name: 'Archive' });

    await request(admin()).post(`/api/donors/${donor.id}/archive`).expect(200);

    const { body: list } = await request(admin()).get('/api/donors').expect(200);
    expect(list.find((d: Donor) => d.id === donor.id)).toBeUndefined();

    // Archiving is logged
    const [log] = await db.query<{ action: string }>('select action from activity_log where action = $1', ['donor.archive']);
    expect(log.action).toBe('donor.archive');
  });

  it('hard-deletes donor for PDPA requests (admin only)', async () => {
    const { body: donor } = await request(admin())
      .post('/api/donors')
      .send({ first_name: 'PDPA', last_name: 'Removal' });

    // Non-admin rejected
    const { app: sApp } = await staffApp();
    await request(sApp).delete(`/api/donors/${donor.id}`).expect(403);

    // Admin allowed
    await request(admin()).delete(`/api/donors/${donor.id}`).expect(200);

    const check = await db.query('select * from donors where id = $1', [donor.id]);
    expect(check).toHaveLength(0);

    const [log] = await db.query<{ action: string }>('select action from activity_log where action = $1', ['donor.delete']);
    expect(log.action).toBe('donor.delete');
  });
});

describe('donations API', () => {
  it('creates cash and in-kind donations and updates computed summary', async () => {
    const { body: donor } = await request(admin())
      .post('/api/donors')
      .send({ first_name: 'Generous', last_name: 'Giver' });

    // Cash donation
    const { body: cash } = await request(admin())
      .post(`/api/donors/${donor.id}/donations`)
      .send({
        donated_on: '2026-10-15',
        kind: 'cash',
        amount_sgd: 100,
        channel: 'paynow',
        campaign: 'Steps for Meals',
      })
      .expect(201);

    expect(Number(cash.amount_sgd)).toBe(100);
    expect(cash.kind).toBe('cash');

    // In-kind donation
    const { body: inKind } = await request(admin())
      .post(`/api/donors/${donor.id}/donations`)
      .send({
        donated_on: '2026-10-20',
        kind: 'in_kind',
        in_kind_description: '50 packs of rice and cooking oil',
        estimated_value_sgd: 250,
      })
      .expect(201);

    expect(inKind.in_kind_description).toBe('50 packs of rice and cooking oil');
    expect(inKind.kind).toBe('in_kind');

    // Check profile
    const { body: profile } = await request(admin()).get(`/api/donors/${donor.id}`).expect(200);
    expect(profile.donations).toHaveLength(2);
    expect(profile.summary.donation_count).toBe(1); // cash only
    expect(profile.summary.in_kind_count).toBe(1);
    expect(Number(profile.summary.giving_12m_sgd)).toBe(100);
  });

  it('rejects duplicate external_ref on the same channel', async () => {
    const { body: donor } = await request(admin())
      .post('/api/donors')
      .send({ first_name: 'GivingSg', last_name: 'User' });

    await request(admin())
      .post(`/api/donors/${donor.id}/donations`)
      .send({
        donated_on: '2026-10-01',
        amount_sgd: 50,
        channel: 'giving_sg',
        external_ref: 'TXN-12345',
      })
      .expect(201);

    const dup = await request(admin())
      .post(`/api/donors/${donor.id}/donations`)
      .send({
        donated_on: '2026-10-01',
        amount_sgd: 50,
        channel: 'giving_sg',
        external_ref: 'TXN-12345',
      })
      .expect(409);

    expect(dup.body.code).toBe('DUPLICATE_DONATION');
  });

  it('voids donation with a reason and updates donor summary', async () => {
    const { body: donor } = await request(admin())
      .post('/api/donors')
      .send({ first_name: 'Mistake', last_name: 'Entry' });

    const { body: donation } = await request(admin())
      .post(`/api/donors/${donor.id}/donations`)
      .send({
        donated_on: '2026-10-01',
        amount_sgd: 1000,
      });

    // Void without reason rejected
    await request(admin()).post(`/api/donations/${donation.id}/void`).send({}).expect(400);

    // Void with reason
    const { body: voided } = await request(admin())
      .post(`/api/donations/${donation.id}/void`)
      .send({ reason: 'Entered wrong account by mistake' })
      .expect(200);

    expect(voided.void_reason).toBe('Entered wrong account by mistake');
    expect(voided.voided_at).not.toBeNull();

    // Re-voiding rejected
    await request(admin())
      .post(`/api/donations/${donation.id}/void`)
      .send({ reason: 'Try again' })
      .expect(400);

    // Check summary: voided donation is excluded from calculations
    const { body: profile } = await request(admin()).get(`/api/donors/${donor.id}`).expect(200);
    expect(Number(profile.summary.giving_12m_sgd)).toBe(0);
    expect(profile.summary.donation_count).toBe(0);
  });
});

describe('notes and engagements API', () => {
  it('adds and soft-deletes relationship notes', async () => {
    const { body: donor } = await request(admin())
      .post('/api/donors')
      .send({ first_name: 'Notes', last_name: 'Test' });

    const { body: note } = await request(admin())
      .post(`/api/donors/${donor.id}/notes`)
      .send({ body: 'Met at gala dinner, very interested in RTE program.' })
      .expect(201);

    expect(note.body).toContain('Met at gala dinner');

    // Other non-admin staff cannot delete note
    const { app: otherStaff } = await staffApp('Other', 'other@fffa.test');
    await request(otherStaff).delete(`/api/notes/${note.id}`).expect(403);

    // Admin can delete note
    await request(admin()).delete(`/api/notes/${note.id}`).expect(200);

    // Check profile: deleted note is excluded
    const { body: profile } = await request(admin()).get(`/api/donors/${donor.id}`).expect(200);
    expect(profile.notes).toHaveLength(0);
  });

  it('manually logs an engagement and records activity', async () => {
    const { body: donor } = await request(admin())
      .post('/api/donors')
      .send({ first_name: 'Engagement', last_name: 'Test' });

    const { body: engagement } = await request(admin())
      .post(`/api/donors/${donor.id}/engagements`)
      .send({
        channel: 'call',
        engaged_on: '2026-10-25',
        summary: 'Followed up regarding annual sponsorship renewal',
        message_subject: 'Annual sponsorship follow-up',
      })
      .expect(201);

    expect(engagement.channel).toBe('call');
    expect(engagement.summary).toContain('Followed up regarding');

    const { body: profile } = await request(admin()).get(`/api/donors/${donor.id}`).expect(200);
    expect(profile.engagements).toHaveLength(1);
    expect(profile.summary.last_engagement_channel).toBe('call');
  });
});

describe('key dates API', () => {
  it('manages key dates and marks them complete', async () => {
    const { body: donor } = await request(admin())
      .post('/api/donors')
      .send({ donor_type: 'grant_funder', organisation_name: 'Lee Foundation' });

    const { body: keyDate } = await request(admin())
      .post(`/api/donors/${donor.id}/key-dates`)
      .send({
        kind: 'grant_report',
        due_on: '2026-11-30',
        label: 'Q4 Financial and Impact Report',
      })
      .expect(201);

    expect(keyDate.kind).toBe('grant_report');
    expect(keyDate.due_on).toBe('2026-11-30');
    expect(keyDate.completed_at).toBeNull();

    // List key dates
    const { body: list } = await request(admin()).get(`/api/donors/${donor.id}/key-dates`).expect(200);
    expect(list).toHaveLength(1);

    // Patch key date to completed
    const { body: updated } = await request(admin())
      .patch(`/api/key-dates/${keyDate.id}`)
      .send({ completed: true })
      .expect(200);

    expect(updated.completed_at).not.toBeNull();
  });
});
