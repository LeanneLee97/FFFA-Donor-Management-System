import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Donor, FollowUp, QueueItem } from '../../shared/types.ts';
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

describe('follow-ups queue API (DM4 & DM9)', () => {
  it('POST /api/follow-ups/refresh runs rules engine and wakes up expired snoozes', async () => {
    const app = admin();

    // Setup a donor with an unthanked donation from 4 days ago
    const [donor] = await db.query<Donor>(
      `insert into donors (first_name, last_name, email) values ('Snooze', 'Test', 'snooze@test.fffa') returning *`,
    );
    await db.query(
      `insert into donations (donor_id, donated_on, amount_sgd, thanked) values ($1, '2026-10-24', 100, false)`,
      [donor.id],
    );

    // Also manually insert a snoozed follow-up whose snooze expired yesterday
    await db.query(
      `insert into follow_ups (donor_id, reason, dedupe_key, status, snoozed_until)
       values ($1, 'cadence_due', 'donor:test|cadence|old', 'snoozed', '2026-10-27')`,
      [donor.id],
    );

    const res = await request(app)
      .post('/api/follow-ups/refresh')
      .send({ today: '2026-10-28' })
      .expect(200);

    expect(res.body.evaluated).toBe(1);
    expect(res.body.created).toBe(1); // the thank_you_due follow up
    expect(res.body.awakened).toBe(1); // the expired snoozed follow up was woken to pending

    // Both should now be pending
    const { body: queue } = await request(app).get('/api/follow-ups?status=pending').expect(200);
    expect(queue).toHaveLength(2);
    expect(queue.map((q: QueueItem) => q.reason).sort()).toEqual(['cadence_due', 'thank_you_due']);

    // Refresh action is logged
    const [log] = await db.query<{ action: string; diff: { awakened: number; created: number } }>(
      'select action, diff from activity_log where action = $1',
      ['followup.refresh'],
    );
    expect(log.action).toBe('followup.refresh');
    expect(log.diff.awakened).toBe(1);
    expect(log.diff.created).toBe(1);
  });

  it('POST /api/follow-ups/:id/complete marks done, logs engagement, and marks donation thanked', async () => {
    const app = admin();

    const [donor] = await db.query<Donor>(
      `insert into donors (first_name, last_name) values ('Thank', 'You') returning *`,
    );
    const [donation] = await db.query<{ id: string }>(
      `insert into donations (donor_id, donated_on, amount_sgd, thanked) values ($1, '2026-10-20', 50, false) returning id`,
      [donor.id],
    );

    const [followUp] = await db.query<FollowUp>(
      `insert into follow_ups (donor_id, reason, dedupe_key, status)
       values ($1, 'thank_you_due', $2, 'pending') returning *`,
      [donor.id, `donor:${donor.id}|thank_you|${donation.id}`],
    );

    const res = await request(app)
      .post(`/api/follow-ups/${followUp.id}/complete`)
      .send({
        channel: 'whatsapp',
        summary: 'Sent thank you message via WhatsApp',
        message_subject: 'Thank you for your generous gift!',
      })
      .expect(200);

    expect(res.body.follow_up.status).toBe('done');
    expect(res.body.follow_up.completed_by).not.toBeNull();
    expect(res.body.engagement.channel).toBe('whatsapp');
    expect(res.body.engagement.summary).toBe('Sent thank you message via WhatsApp');

    // Donation thanked flag is updated
    const [updatedDonation] = await db.query<{ thanked: boolean }>(
      'select thanked from donations where id = $1',
      [donation.id],
    );
    expect(updatedDonation.thanked).toBe(true);

    // Profile reflects new engagement touchpoint
    const { body: profile } = await request(app).get(`/api/donors/${donor.id}`).expect(200);
    expect(profile.engagements).toHaveLength(1);
    expect(profile.summary.last_engagement_channel).toBe('whatsapp');

    // Cannot re-complete
    await request(app).post(`/api/follow-ups/${followUp.id}/complete`).expect(400);

    // Activity log recorded
    const [log] = await db.query<{ action: string }>(
      'select action from activity_log where action = $1',
      ['followup.complete'],
    );
    expect(log.action).toBe('followup.complete');
  });

  it('POST /api/follow-ups/:id/complete marks linked key_dates done', async () => {
    const app = admin();

    const [donor] = await db.query<Donor>(
      `insert into donors (donor_type, organisation_name) values ('grant_funder', 'SBF Foundation') returning *`,
    );
    const [kd] = await db.query<{ id: string; completed_at: string | null }>(
      `insert into key_dates (donor_id, kind, due_on, label) values ($1, 'grant_report', '2026-11-01', 'Q4 Report') returning *`,
      [donor.id],
    );

    const [followUp] = await db.query<FollowUp>(
      `insert into follow_ups (donor_id, reason, dedupe_key, key_date_id, status)
       values ($1, 'key_date', 'keydate:sbf-1', $2, 'pending') returning *`,
      [donor.id, kd.id],
    );

    await request(app)
      .post(`/api/follow-ups/${followUp.id}/complete`)
      .send({ channel: 'email', summary: 'Submitted report' })
      .expect(200);

    const [updatedKd] = await db.query<{ completed_at: string | null }>(
      'select completed_at from key_dates where id = $1',
      [kd.id],
    );
    expect(updatedKd.completed_at).not.toBeNull();
  });

  it('POST /api/follow-ups/:id/snooze updates snoozed_until date and rejects invalid/past dates', async () => {
    const app = admin();

    const [donor] = await db.query<Donor>(`insert into donors (first_name) values ('Snoozer') returning *`);
    const [followUp] = await db.query<FollowUp>(
      `insert into follow_ups (donor_id, reason, dedupe_key, status)
       values ($1, 'cadence_due', 'donor:snooze|cadence', 'pending') returning *`,
      [donor.id],
    );

    // Reject missing date
    await request(app).post(`/api/follow-ups/${followUp.id}/snooze`).send({}).expect(400);

    // Reject past date
    await request(app)
      .post(`/api/follow-ups/${followUp.id}/snooze`)
      .send({ until: '2020-01-01' })
      .expect(400);

    // Accept future date
    const res = await request(app)
      .post(`/api/follow-ups/${followUp.id}/snooze`)
      .send({ until: '2028-12-01' })
      .expect(200);

    expect(res.body.status).toBe('snoozed');
    expect(res.body.snoozed_until).toBe('2028-12-01');

    // Activity log recorded
    const [log] = await db.query<{ action: string }>(
      'select action from activity_log where action = $1',
      ['followup.snooze'],
    );
    expect(log.action).toBe('followup.snooze');
  });

  it('POST /api/follow-ups/:id/dismiss transitions follow-up to dismissed', async () => {
    const app = admin();

    const [donor] = await db.query<Donor>(`insert into donors (first_name) values ('DismissMe') returning *`);
    const [followUp] = await db.query<FollowUp>(
      `insert into follow_ups (donor_id, reason, dedupe_key, status)
       values ($1, 'anniversary', 'donor:d|anniv|2026', 'pending') returning *`,
      [donor.id],
    );

    const res = await request(app)
      .post(`/api/follow-ups/${followUp.id}/dismiss`)
      .send({ reason: 'Donor requested no anniversary greetings' })
      .expect(200);

    expect(res.body.status).toBe('dismissed');

    // Cannot snooze a dismissed follow-up
    await request(app)
      .post(`/api/follow-ups/${followUp.id}/snooze`)
      .send({ until: '2028-01-01' })
      .expect(400);

    // Activity log recorded
    const [log] = await db.query<{ action: string; diff: { reason: string } }>(
      'select action, diff from activity_log where action = $1',
      ['followup.dismiss'],
    );
    expect(log.diff.reason).toBe('Donor requested no anniversary greetings');
  });
});
