import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Same JSON-friendly values from both engines: `date` stays 'YYYY-MM-DD' (no timezone shift),
// `numeric` becomes a number (amounts are well inside float precision).
const DATE_OID = 1082;
const NUMERIC_OID = 1700;
const parsers = {
  [DATE_OID]: (v: string) => v,
  [NUMERIC_OID]: (v: string) => Number(v),
};
pg.types.setTypeParser(DATE_OID, parsers[DATE_OID]);
pg.types.setTypeParser(NUMERIC_OID, parsers[NUMERIC_OID]);

/** The one database interface every service uses, whatever the engine underneath. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run several statements with no parameters (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Production: real Postgres (Supabase) via DATABASE_URL.
 * Local dev and tests: PGlite, an embedded Postgres, so nobody needs Docker or a Supabase project.
 * Pass dataDir ':memory:' for a throwaway database.
 */
export async function createDb(opts: { databaseUrl?: string; dataDir?: string } = {}): Promise<Db> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl });
    return {
      async query(sql, params) {
        return (await pool.query(sql, params as unknown[])).rows;
      },
      async exec(sql) {
        await pool.query(sql);
      },
      close: () => pool.end(),
    };
  }

  const persistent = opts.dataDir && opts.dataDir !== ':memory:';
  if (persistent) await mkdir(path.dirname(opts.dataDir!), { recursive: true });
  const lite = persistent ? new PGlite(opts.dataDir, { parsers }) : new PGlite({ parsers });
  await lite.waitReady;
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return (await lite.query<T>(sql, params)).rows;
    },
    async exec(sql) {
      await lite.exec(sql);
    },
    close: () => lite.close(),
  };
}

/** Applies any migrations in server/migrations that haven't run yet, in filename order. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set(
    (await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec(`begin;\n${sql}\ninsert into schema_migrations (name) values ('${file}');\ncommit;`);
    ran.push(file);
  }
  return ran;
}
