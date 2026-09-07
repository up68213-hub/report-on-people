import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const sqlite = new DatabaseSync(config.databasePath);

const usersSql = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
if (usersSql && !usersSql.includes('resource_manager')) {
  sqlite.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    sqlite.exec(`
      CREATE TABLE users_new (
        user_id INTEGER PRIMARY KEY, bitrix_member_id TEXT, bitrix_user_id TEXT,
        display_name TEXT NOT NULL, email TEXT,
        global_role TEXT NOT NULL DEFAULT 'observer' CHECK (global_role IN ('administrator','project_manager','resource_manager','observer')),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT,
        UNIQUE (bitrix_member_id, bitrix_user_id)
      );
      INSERT INTO users_new SELECT * FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  } catch (error) {
    sqlite.exec('ROLLBACK; PRAGMA foreign_keys = ON;');
    throw error;
  }
}

export const db = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    statement.setAllowBareNamedParameters(true);
    return statement;
  },
  exec(sql) {
    return sqlite.exec(sql);
  },
  transaction(fn) {
    return (...args) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    };
  },
  close() {
    sqlite.close();
  },
};

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const schemaPath = path.join(import.meta.dirname, 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

const seedDevUsers = db.transaction(() => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO users (display_name, email, global_role)
    VALUES (?, ?, ?)
  `);
  insert.run('Администратор', 'admin@example.local', 'administrator');
  insert.run('Руководитель проекта', 'manager@example.local', 'project_manager');
  insert.run('Наблюдатель', 'observer@example.local', 'observer');
});

if (config.authMode === 'dev') seedDevUsers();

export function closeDatabase() {
  db.close();
}
