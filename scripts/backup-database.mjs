import { DatabaseSync } from 'node:sqlite';
import { config } from '../apps/server/src/config.js';
import { createConsistentBackup } from '../apps/server/src/database/backup.js';

const sqlite = new DatabaseSync(config.databasePath);
try {
  sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA wal_checkpoint(PASSIVE)');
  const target = createConsistentBackup(sqlite, config.databasePath, 'manual');
  console.log(target || 'Database does not exist; backup was not created.');
} finally {
  sqlite.close();
}
