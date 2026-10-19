import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createDb, migrate, type Db } from '../db.ts';
import { devStaffResolver } from '../middleware/auth.ts';
import type { AiClient } from '../services/ai/client.ts';

let db: Db;

beforeEach(async () => {
  db = await createDb(); // in-memory PGlite
  await migrate(db);
});
afterEach(() => db.close());

const fakeAi = (impl: AiClient['generateDraft']): AiClient => ({ model: 'fake-model', generateDraft: impl });

function app(ai: AiClient | null) {
  return createApp({ db, ai, resolveStaff: devStaffResolver(db) });
}

async function seedFollowUp(opts: { giving?: number; reason?: string } = {}) {
  const [donor] = await db.query<{ id: string }>(
    `insert into donors (first_name, email, mobile) values ('Mei Ling', 'ml@example.com', '91234567') returning id`,
  );
  await db.query(
    `insert into donations (donor_id, donated_on, amount_sgd, is_recurring, monthly_amount_sgd, programme)
     values ($1, current_date - 5, $2, true, $2, 'RTE')`,
    [donor.id, opts.giving ?? 30],
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
    expect(log[0].diff).toMatchObject({ source: 'ai', model: 'fake-model', prompt_version: 'dm10-v1' });
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

  it('refuses AI drafts for personal-outreach donors', async () => {
    const ai = fakeAi(async () => ({ subject: 's', body: 'b' }));
    const { followUpId } = await seedFollowUp({ giving: 25000 }); // diamond tier
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
});
