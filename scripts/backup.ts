// Offline backup of the CohortKit database using SQLite's VACUUM INTO,
// which produces a consistent snapshot while the server keeps running.
// Usage: npm run backup [destination.db]
// Restore: stop the server, move the backup over the live database file, start the server.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve(process.env.DATABASE_PATH || './data/cohortkit.db');
const destination = resolve(process.argv[2] || `./data/backups/cohortkit-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

mkdirSync(dirname(destination), { recursive: true });
const db = new DatabaseSync(source);
try {
  db.exec(`VACUUM INTO ${quote(destination)}`);
  console.log(`Backup written: ${destination}`);
} finally {
  db.close();
}