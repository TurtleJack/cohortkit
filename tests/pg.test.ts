import { describe, it, expect } from 'vitest';
import { PgStore } from '../server/pg';
import { now } from '../server/db';

// Runs only when DATABASE_URL is provided (CI postgres service job, or locally).
const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

run('postgres driver', () => {
  it('applies the baseline schema and all migrations', async () => {
    const store = await PgStore.open(url!);
    try {
      const versions = await store.all<{ version: number }>('SELECT version FROM schema_versions ORDER BY version');
      expect(versions.map(v => v.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally { await store.close(); }
  });

  it('translates parameterized SQL and enforces constraints', async () => {
    const store = await PgStore.open(url!);
    try {
      await store.run('DELETE FROM applications WHERE org_id=?', 'pg-org');
      await store.run('DELETE FROM organizations WHERE id=?', 'pg-org');
      await store.run("DELETE FROM emails WHERE org_id='pg-org'");
      const t = now();
      await store.run('INSERT INTO organizations (id,slug,name,plan,subscription_status,trial_ends_at,modules,branding,created_at) VALUES(?,?,?,?,?,?,?,?,?)', 'pg-org', 'pg-test', 'PG Test', 'starter', 'trialing', t, '["intake","review","ai"]', '{"accent":"#123456","footer":"","senderName":"","logoUrl":""}', t);
      const org = await store.get<{ name: string }>('SELECT name FROM organizations WHERE id=? AND slug=?', 'pg-org', 'pg-test');
      expect(org?.name).toBe('PG Test');

      // Partial unique dedupe index: a second row with the same key must be rejected.
      await store.run("INSERT INTO emails (id,org_id,email_to,subject,status,provider,error,attempts,dedupe_key,created_at,sent_at,html,body_text) VALUES('e1','pg-org','a@x.test','S','pending','','',0,'k1',?::text,null,'','')", t);
      await expect(store.run("INSERT INTO emails (id,org_id,email_to,subject,status,provider,error,attempts,dedupe_key,created_at,sent_at,html,body_text) VALUES('e2','pg-org','b@x.test','S','pending','','',0,'k1',?::text,null,'','')", t)).rejects.toThrow();

      // Conflict handling used by the review path.
      await store.run("INSERT INTO emails (id,org_id,email_to,subject,status,provider,error,attempts,dedupe_key,created_at,sent_at,html,body_text) VALUES('e2','pg-org','b@x.test','S','pending','','',0,'k2',?::text,null,'','') ON CONFLICT(id) DO NOTHING", t);

      // Transactions roll back on error.
      await store.transaction(async tx => {
        await tx.run('INSERT INTO users (id,email,name,password,platform_admin,created_at) VALUES(?,?,?,?,?,?)', 'pg-user', 'u@x.test', 'U', 'p', 0, t);
        throw new Error('forced rollback');
      }).catch(() => {});
      expect(await store.get('SELECT id FROM users WHERE id=?', 'pg-user')).toBeUndefined();

      // Foreign keys are enforced.
      await expect(store.run("INSERT INTO status_access (id,org_id,app_id,created_at) VALUES('sa1','pg-org','missing-app',?::text)", t)).rejects.toThrow();
    } finally { await store.close(); }
  });
});