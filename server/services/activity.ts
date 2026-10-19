import type { Uuid } from '../../shared/types.ts';
import type { Db } from '../db.ts';

export interface ActivityEntry {
  actor: Uuid | null;
  action: string; // e.g. 'ai.generate', 'donation.void'
  entityType: string;
  entityId: Uuid | null;
  /** Changed fields or small metadata only. Never a full record with contact details. */
  diff?: Record<string, unknown>;
}

/**
 * Append-only audit trail (DM7). Every write in the API should call this.
 * Owner: Swaraj (design section 10). The read endpoint and richer diffs build on top of this.
 */
export async function logActivity(db: Db, entry: ActivityEntry): Promise<void> {
  await db.query(
    `insert into activity_log (actor, action, entity_type, entity_id, diff)
     values ($1, $2, $3, $4, $5)`,
    [entry.actor, entry.action, entry.entityType, entry.entityId, entry.diff ?? null],
  );
}
