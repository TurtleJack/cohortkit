import pg from 'pg';
import type { SQLInputValue } from 'node:sqlite';
import { migrations, pgDdl, now } from './db';

// Translate the portable SQL used by CohortKit (SQLite dialect) to Postgres:
// positional ? params become $1..$n and BEGIN IMMEDIATE becomes BEGIN.
// Never construct SQL from untrusted input.
export function toPg(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`).replace(/BEGIN IMMEDIATE/g, 'BEGIN');
}

export type SqlValues = SQLInputValue[];

export interface PgTx {
  get<T>(sql: string, ...params: SqlValues): Promise<T | undefined>;
  all<T>(sql: string, ...params: SqlValues): Promise<T[]>;
  run(sql: string, ...params: SqlValues): Promise<{ changes: number }>;
}

// Async Postgres store with the same schema and migrations as the SQLite store.
// The application server currently runs on the synchronous SQLite store; this
// driver validates the schema, migrations, and SQL translation so the data
// layer can move to Postgres behind the same repository in a future release.
export class PgStore {
  private pool: pg.Pool;
  private constructor(pool: pg.Pool) { this.pool = pool; }

  static async open(url: string): Promise<PgStore> {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const store = new PgStore(pool);
    await pool.query(pgDdl);
    const row = await pool.query('SELECT max(version) version FROM schema_versions');
    const applied = row.rows[0]?.version ?? 0;
    for (let v = applied + 1; v <= migrations.length + 1; v++) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(toPg(migrations[v - 2]));
        await client.query('INSERT INTO schema_versions VALUES($1,$2)', [v, now()]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }
    return store;
  }

  async get<T>(sql: string, ...params: SqlValues): Promise<T | undefined> {
    const result = await this.pool.query(toPg(sql), params as unknown[]);
    return result.rows[0] as T | undefined;
  }
  async all<T>(sql: string, ...params: SqlValues): Promise<T[]> {
    const result = await this.pool.query(toPg(sql), params as unknown[]);
    return result.rows as T[];
  }
  async run(sql: string, ...params: SqlValues): Promise<{ changes: number }> {
    const result = await this.pool.query(toPg(sql), params as unknown[]);
    return { changes: result.rowCount ?? 0 };
  }
  async transaction<T>(fn: (tx: PgTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: PgTx = {
      get: async <R>(sql: string, ...p: SqlValues) => { const r = await client.query(toPg(sql), p as unknown[]); return r.rows[0] as R | undefined; },
      all: async <R>(sql: string, ...p: SqlValues) => { const r = await client.query(toPg(sql), p as unknown[]); return r.rows as R[]; },
      run: async (sql: string, ...p: SqlValues) => { const r = await client.query(toPg(sql), p as unknown[]); return { changes: r.rowCount ?? 0 }; },
    };
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async close() { await this.pool.end(); }
}