import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createDb, migrate, type Db } from '../db.ts';
import { devStaffResolver } from '../middleware/auth.ts';
import type { AiClient } from '../services/ai/client.ts';

let db: Db;

// One in-memory Postgres per file, reset before each test. Starting a fresh PGlite per test
// leaks WebAssembly memory and stalls after about a dozen instances.
beforeAll(async () => {
  db = await createDb();
});
beforeEach(async () => {
  await db.exec('drop schema public cascade; create schema public;');
  await migrate(db);
});
afterAll(() => db.close());

const fakeAi = (impl: AiClient['generateDraft']): AiClient => ({ model: 'fake-model', generateDraft: impl });

function app(ai: AiClient | null) {
  return createApp({ db, ai, resolveStaff: devStaffResolver(db) });
}

async function seedFollowUp(opts: { giving?: number; reason?: string; firstGiftDaysAgo?: number; major?: boolean } = {}) {
  const [donor] = await db.query<{ id: string }>(
    `insert into donors (first_name, email, mobile, major_override)
     values ('Mei Ling', 'ml@example.com', '91234567', $1) returning id`,
    [opts.major ?? false],
  );
  await db.query(
    `insert into donations (donor_id, donated_on, amount_sgd, is_recurring, monthly_amount_sgd, programme)
     values ($1, current_date - $3::int, $2, true, $2, 'RTE')`,
    [donor.id, opts.giving ?? 30, opts.firstGiftDaysAgo ?? 5],
  );
  const [followUp] = await db.query<{ id: string }>(
    `insert into follow_ups (donor_id, reason, dedupe_key) values ($1, $2, $3) returning id`,
    [donor.id, opts.reason ?? 'thank_you_due', `${donor.id}|test`],
  );
  return { donorId: donor.id, followUpId: followUp.id };
}

describe('DM10 AI drafting API', () => {
  it('drafts with AI, then approves with edits, logging both steps', async () => {
    let promptSeen = '';
    const ai = fakeAi(async ({ prompt }) => {
      promptSeen = prompt;
      return { subject: 'Thank you, Mei Ling', body: 'AI body' };
    });
    const { followUpId } = await seedFollowUp();

    const created = await request(app(ai)).post(`/api/follow-ups/${followUpId}/draft`).expect(201);
    expect(created.body).toMatchObject({ source: 'ai', status: 'draft', body_generated: 'AI body' });
    expect(promptSeen).not.toContain('ml@example.com');
    expect(promptSeen).not.toContain('91234567');

    const approved = await request(app(ai))
      .post(`/api/drafts/${created.body.id}/approve`)
      .send({ body: 'Edited by staff' })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', body_final: 'Edited by staff' });
    expect(approved.body.approved_by).toBeTruthy();

    const log = await db.query<{ action: string; diff: Record<string, unknown> }>(
      `select action, diff from activity_log order by id`,
    );
    expect(log.map((l) => l.action)).toEqual(['ai.generate', 'ai.approve']);
    expect(log[0].diff).toMatchObject({ source: 'ai', model: 'fake-model', prompt_version: 'dm10-v2' });
    expect(log[1].diff).toEqual({ edited: true });
  });

  it('falls back to a template when the AI fails, so staff are never blocked', async () => {
    const ai = fakeAi(async () => {
      throw new Error('quota exceeded');
    });
    const { followUpId } = await seedFollowUp();
    const res = await request(app(ai)).post(`/api/follow-ups/${followUpId}/draft`).expect(201);
    expect(res.body.source).toBe('template_fallback');
    expect(res.body.body_generated).toContain('Dear Mei Ling,');

    const [entry] = await db.query<{ diff: Record<string, unknown> }>(`select diff from activity_log`);
    expect(entry.diff.ai_error).toBe('quota exceeded');
  });

  it('uses templates when no AI key is configured', async () => {
    const { followUpId } = await seedFollowUp();
    const res = await request(app(null)).post(`/api/follow-ups/${followUpId}/draft`).expect(201);
    expect(res.body.source).toBe('template_fallback');
  });

  it.each([
    ['S$5,000+ in 12 months', { giving: 6000 }],
    ['3+ years with FFFA', { firstGiftDaysAgo: 3 * 366 }],
    ['tagged major by staff', { major: true }],
  ])('refuses AI drafts for major donors (%s)', async (_label, opts) => {
    const ai = fakeAi(async () => ({ subject: 's', body: 'b' }));
    const { followUpId } = await seedFollowUp(opts);
    const res = await request(app(ai)).post(`/api/follow-ups/${followUpId}/draft`).expect(422);
    expect(res.body.code).toBe('PERSONAL_OUTREACH');
  });

  it('cannot approve twice or approve an empty body', async () => {
    const { followUpId } = await seedFollowUp();
    const { body: draft } = await request(app(null)).post(`/api/follow-ups/${followUpId}/draft`).expect(201);
    await request(app(null)).post(`/api/drafts/${draft.id}/approve`).send({ body: '  ' }).expect(400);
    await request(app(null)).post(`/api/drafts/${draft.id}/approve`).send({ body: 'ok' }).expect(200);
    const again = await request(app(null)).post(`/api/drafts/${draft.id}/approve`).send({ body: 'ok' }).expect(409);
    expect(again.body.code).toBe('DRAFT_CLOSED');
  });

  it('discards drafts and refuses closed follow-ups', async () => {
    const { followUpId } = await seedFollowUp();
    const { body: draft } = await request(app(null)).post(`/api/follow-ups/${followUpId}/draft`).expect(201);
    const discarded = await request(app(null)).post(`/api/drafts/${draft.id}/discard`).expect(200);
    expect(discarded.body.status).toBe('discarded');

    await db.query(`update follow_ups set status = 'done' where id = $1`, [followUpId]);
    const res = await request(app(null)).post(`/api/follow-ups/${followUpId}/draft`).expect(409);
    expect(res.body.code).toBe('FOLLOW_UP_CLOSED');
  });

  it('returns 404 for unknown or malformed ids', async () => {
    await request(app(null)).post('/api/follow-ups/00000000-0000-0000-0000-000000000000/draft').expect(404);
    await request(app(null)).post('/api/follow-ups/not-a-uuid/draft').expect(404);
  });

  it('marks an approved draft as sent: message saved on the profile, follow-up done, logged', async () => {
    const { donorId, followUpId } = await seedFollowUp();
    const { body: draft } = await request(app(null)).post(`/api/follow-ups/${followUpId}/draft`).expect(201);
    await request(app(null)).post(`/api/drafts/${draft.id}/approve`).send({ subject: 'Thanks!', body: 'Final text' }).expect(200);

    const res = await request(app(null)).post(`/api/drafts/${draft.id}/mark-sent`).send({ channel: 'email' }).expect(200);
    expect(res.body.draft).toMatchObject({ status: 'sent' });
    expect(res.body.draft.sent_at).toBeTruthy();
    expect(res.body.engagement).toMatchObject({
      donor_id: donorId,
      follow_up_id: followUpId,
      ai_draft_id: draft.id,
      channel: 'email',
      message_subject: 'Thanks!',
      message_body: 'Final text',
    });

    const [fu] = await db.query<{ status: string }>(`select status from follow_ups where id = $1`, [followUpId]);
    expect(fu.status).toBe('done');
    const [summary] = await db.query<{ days_since_engagement: number }>(
      `select days_since_engagement from donor_summary where donor_id = $1`,
      [donorId],
    );
    expect(summary.days_since_engagement).toBe(0); // cadence clock reset
    const actions = (await db.query<{ action: string }>(`select action from activity_log order by id`)).map((r) => r.action);
    expect(actions).toEqual(['ai.generate', 'ai.approve', 'ai.sent']);
  });

  it('only approved drafts can be marked as sent, once', async () => {
    const { followUpId } = await seedFollowUp();
    const { body: draft } = await request(app(null)).post(`/api/follow-ups/${followUpId}/draft`).expect(201);
    const early = await request(app(null)).post(`/api/drafts/${draft.id}/mark-sent`).expect(409);
    expect(early.body.code).toBe('NOT_APPROVED');

    await request(app(null)).post(`/api/drafts/${draft.id}/approve`).send({ body: 'ok' }).expect(200);
    await request(app(null)).post(`/api/drafts/${draft.id}/mark-sent`).send({ channel: 'fax' }).expect(400);
    await request(app(null)).post(`/api/drafts/${draft.id}/mark-sent`).expect(200);
    await request(app(null)).post(`/api/drafts/${draft.id}/mark-sent`).expect(409);
    const engagements = await db.query(`select id from engagements`);
    expect(engagements).toHaveLength(1);
  });

  it('rolls back mark-as-sent completely if any step fails', async () => {
    const { followUpId } = await seedFollowUp();
    const { body: draft } = await request(app(null)).post(`/api/follow-ups/${followUpId}/draft`).expect(201);
    await request(app(null)).post(`/api/drafts/${draft.id}/approve`).send({ body: 'ok' }).expect(200);
    // Break the last step (activity log) so the transaction must undo the earlier writes.
    await db.exec(`alter table activity_log add constraint no_sent check (action <> 'ai.sent')`);

    await request(app(null)).post(`/api/drafts/${draft.id}/mark-sent`).expect(500);
    const [d] = await db.query<{ status: string }>(`select status from ai_drafts where id = $1`, [draft.id]);
    const [fu] = await db.query<{ status: string }>(`select status from follow_ups where id = $1`, [followUpId]);
    expect(d.status).toBe('approved');
    expect(fu.status).toBe('pending');
    expect(await db.query(`select id from engagements`)).toHaveLength(0);
  });

  it('drafts failed-payment follow-ups from the latest failed payment', async () => {
    const { donorId, followUpId } = await seedFollowUp({ reason: 'failed_payment' });
    await db.query(
      `insert into donations (donor_id, donated_on, amount_sgd, channel, is_recurring, monthly_amount_sgd, payment_status)
       values ($1, current_date - 1, 30, 'give_asia', true, 30, 'failed')`,
      [donorId],
    );
    const res = await request(app(null)).post(`/api/follow-ups/${followUpId}/draft`).expect(201);
    expect(res.body.body_generated).toContain('monthly gift on GIVE.asia');
  });
});
