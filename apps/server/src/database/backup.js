import fs from 'node:fs';
import path from 'node:path';

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function createConsistentBackup(sqlite, databasePath, reason = 'manual') {
  if (!fs.existsSync(databasePath)) return null;
  const backupDir = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeReason = String(reason).replace(/[^a-zA-Z0-9_-]/g, '_');
  const target = path.join(backupDir, `report-${stamp}-${safeReason}.sqlite`);
  sqlite.exec(`VACUUM INTO ${sqlString(target)}`);
  return target;
}
