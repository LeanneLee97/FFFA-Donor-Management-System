import type { Staff, Tier } from '../../shared/types.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import { logActivity } from './activity.ts';

export interface TierSetting {
  tier: Tier;
  min_12m_giving_sgd: number;
  cadence_days: number;
}

export interface Settings {
  /** Follow-up rule thresholds, e.g. thank_you_after_days (design section 4). */
  rules: Record<string, number>;
  /** Giving thresholds and contact cadence per tier, lowest first. */
  tiers: TierSetting[];
  /** Organisation values: impact unit, major-donor thresholds, signature. */
  org: Record<string, string>;
}

export interface SettingsPatch {
  rules?: Record<string, number>;
  tiers?: Partial<TierSetting>[];
  org?: Record<string, string>;
}

/** Org values that must be numbers, and their allowed minimum. */
const NUMERIC_ORG: Record<string, number> = {
  impact_unit_sgd: 0.01,
  major_min_12m_sgd: 0,
  major_min_years: 1,
};

export async function getSettings(db: Db): Promise<Settings> {
  const [rules, tiers, org] = await Promise.all([
    db.query<{ key: string; value: number }>('select key, value from rule_settings order by key'),
    db.query<TierSetting>('select tier, min_12m_giving_sgd, cadence_days from tier_settings order by min_12m_giving_sgd'),
    db.query<{ key: string; value: string }>('select key, value from org_settings order by key'),
  ]);
  return {
    rules: Object.fromEntries(rules.map((r) => [r.key, r.value])),
    tiers,
    org: Object.fromEntries(org.map((r) => [r.key, r.value])),
  };
}

const bad = (message: string) => new HttpError(400, 'INVALID_SETTINGS', message);

function validate(current: Settings, patch: SettingsPatch): void {
  for (const [key, value] of Object.entries(patch.rules ?? {})) {
    if (!(key in current.rules)) throw bad(`Unknown rule setting: ${key}`);
    if (!Number.isInteger(value) || value <= 0) throw bad(`${key} must be a whole number above 0`);
  }

  for (const t of patch.tiers ?? []) {
    if (!t.tier || !current.tiers.some((c) => c.tier === t.tier)) throw bad(`Unknown tier: ${t.tier}`);
    if (t.cadence_days !== undefined && (!Number.isInteger(t.cadence_days) || t.cadence_days <= 0)) {
      throw bad(`${t.tier}: cadence_days must be a whole number above 0`);
    }
    if (t.min_12m_giving_sgd !== undefined && !(Number(t.min_12m_giving_sgd) >= 0)) {
      throw bad(`${t.tier}: min_12m_giving_sgd must be 0 or more`);
    }
  }
  // Tiers must stay in order, and the lowest must start at 0 so every donor has a tier.
  const merged = current.tiers.map((c) => ({ ...c, ...(patch.tiers ?? []).find((t) => t.tier === c.tier) }));
  const order: Tier[] = ['bronze', 'silver', 'gold', 'diamond'];
  merged.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
  if (Number(merged[0].min_12m_giving_sgd) !== 0) throw bad('bronze must start at S$0 so every donor has a tier');
  for (let i = 1; i < merged.length; i++) {
    if (Number(merged[i].min_12m_giving_sgd) <= Number(merged[i - 1].min_12m_giving_sgd)) {
      throw bad(`${merged[i].tier} must need more giving than ${merged[i - 1].tier}`);
    }
  }

  for (const [key, value] of Object.entries(patch.org ?? {})) {
    if (!(key in current.org)) throw bad(`Unknown org setting: ${key}`);
    if (typeof value !== 'string' || !value.trim()) throw bad(`${key} cannot be empty`);
    if (key in NUMERIC_ORG && !(Number(value) >= NUMERIC_ORG[key])) {
      throw bad(`${key} must be a number of at least ${NUMERIC_ORG[key]}`);
    }
  }
}

/** Admin-only (design section 6). Unknown keys are rejected rather than created. */
export async function updateSettings(db: Db, staff: Staff, patch: SettingsPatch): Promise<Settings> {
  if (!patch || typeof patch !== 'object') throw bad('Send { rules?, tiers?, org? }');
  const current = await getSettings(db);
  validate(current, patch);

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(patch.rules ?? {})) {
      if (current.rules[key] === value) continue;
      await tx.query('update rule_settings set value = $2 where key = $1', [key, value]);
      changed[`rules.${key}`] = { from: current.rules[key], to: value };
    }
    for (const t of patch.tiers ?? []) {
      const before = current.tiers.find((c) => c.tier === t.tier)!;
      for (const field of ['min_12m_giving_sgd', 'cadence_days'] as const) {
        if (t[field] === undefined || Number(t[field]) === Number(before[field])) continue;
        await tx.query(`update tier_settings set ${field} = $2 where tier = $1`, [t.tier, t[field]]);
        changed[`tiers.${t.tier}.${field}`] = { from: before[field], to: Number(t[field]) };
      }
    }
    for (const [key, value] of Object.entries(patch.org ?? {})) {
      const trimmed = value.trim();
      if (current.org[key] === trimmed) continue;
      await tx.query('update org_settings set value = $2 where key = $1', [key, trimmed]);
      changed[`org.${key}`] = { from: current.org[key], to: trimmed };
    }
    if (Object.keys(changed).length) {
      await logActivity(tx, { actor: staff.id, action: 'settings.update', entityType: 'settings', entityId: null, diff: changed });
    }
  });
  return getSettings(db);
}
