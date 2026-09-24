import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL, platform_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, plan TEXT NOT NULL, subscription_status TEXT NOT NULL, trial_ends_at TEXT NOT NULL, modules TEXT NOT NULL, stripe_customer_id TEXT UNIQUE, stripe_subscription_id TEXT UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (org_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('owner','admin','committee','reviewer')), PRIMARY KEY(org_id,user_id));
      CREATE TABLE IF NOT EXISTS cohorts (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), slug TEXT NOT NULL, config TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(org_id,slug), UNIQUE(org_id,id));
      CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, cohort_id TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','submitted')), email TEXT NOT NULL COLLATE NOCASE, stage_id TEXT NOT NULL, pool TEXT NOT NULL DEFAULT 'unassigned', scrubbed_at TEXT, scrub_notes TEXT NOT NULL DEFAULT '', brief TEXT, outcome TEXT CHECK(outcome IN ('accepted','waitlist','rejected')), decision_notes TEXT NOT NULL DEFAULT '', interview TEXT NOT NULL DEFAULT '{"status":"none","scheduledAt":"","notes":""}', token_hash TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, submitted_at TEXT, FOREIGN KEY(org_id,cohort_id) REFERENCES cohorts(org_id,id), UNIQUE(cohort_id,email), UNIQUE(org_id,id));
      CREATE TABLE IF NOT EXISTS assignments (org_id TEXT NOT NULL, app_id TEXT NOT NULL, reviewer_id TEXT NOT NULL, stage_id TEXT NOT NULL, recused INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY(app_id,reviewer_id,stage_id), FOREIGN KEY(org_id,app_id) REFERENCES applications(org_id,id), FOREIGN KEY(org_id,reviewer_id) REFERENCES memberships(org_id,user_id));
      CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, app_id TEXT NOT NULL, reviewer_id TEXT NOT NULL, stage_id TEXT NOT NULL, scores TEXT NOT NULL, recommendation TEXT NOT NULL CHECK(recommendation IN ('advance','waitlist','reject')), champion INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL, overall REAL NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(app_id,reviewer_id,stage_id), FOREIGN KEY(org_id,app_id) REFERENCES applications(org_id,id), FOREIGN KEY(org_id,reviewer_id) REFERENCES memberships(org_id,user_id));
      CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), email TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','committee','reviewer','founder')), cohort_id TEXT, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, accepted_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(org_id,cohort_id) REFERENCES cohorts(org_id,id));
      CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), actor TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS applications_cohort ON applications(org_id,cohort_id,status);
      CREATE INDEX IF NOT EXISTS reviews_app ON reviews(org_id,app_id,stage_id);
      CREATE INDEX IF NOT EXISTS assignments_reviewer ON assignments(org_id,reviewer_id,stage_id);
      INSERT OR IGNORE INTO schema_versions VALUES(1,datetime('now'));
    `);
    this.migrate();
  }
  // Additive, numbered migrations. Never edit an applied migration; append a new one.
  migrate() {
    const migrations: ((db: DatabaseSync) => void)[] = [
      // v1 is the baseline schema above.
      db => db.exec(`ALTER TABLE organizations ADD COLUMN branding TEXT NOT NULL DEFAULT '{"accent":"#285d4e","footer":"Better decisions. Stronger cohorts.","senderName":"","logoUrl":""}';`),
      db => db.exec(`CREATE TABLE emails (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email_to TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sent','failed')), provider TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0, dedupe_key TEXT, created_at TEXT NOT NULL, sent_at TEXT, FOREIGN KEY(org_id) REFERENCES organizations(id));
        CREATE UNIQUE INDEX emails_dedupe ON emails(dedupe_key) WHERE dedupe_key IS NOT NULL;`),
      db => db.exec(`CREATE TABLE status_access (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, app_id TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(org_id,app_id) REFERENCES applications(org_id,id));`),
      db => db.exec(`ALTER TABLE applications ADD COLUMN feedback TEXT;`),
    ];
    const row = this.get<{ version: number }>('SELECT max(version) version FROM schema_versions');
    for (let v = (row?.version || 0) + 1; v <= migrations.length; v++) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        migrations[v - 1](this.db);
        this.db.prepare('INSERT INTO schema_versions VALUES(?,?)').run(v, now());
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
  }
  get<T>(sql: string, ...params: SQLInputValue[]): T|undefined { return this.db.prepare(sql).get(...params) as T|undefined; }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] { return this.db.prepare(sql).all(...params) as T[]; }
  run(sql: string, ...params: SQLInputValue[]) { return this.db.prepare(sql).run(...params); }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result=fn(); this.db.exec('COMMIT'); return result; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  audit(orgId: string, actor: string, action: string, targetId: string, detail = '') { this.run('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?)',id(),orgId,actor,action,targetId,detail,now()); }
}
