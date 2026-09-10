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

const managedDictionarySql = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='managed_dictionary_values'").get()?.sql || '';
if (managedDictionarySql && !managedDictionarySql.includes('resource_measure')) {
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    db.exec(`
      ALTER TABLE managed_dictionary_values RENAME TO managed_dictionary_values_old;
      CREATE TABLE managed_dictionary_values (
        dictionary_id INTEGER PRIMARY KEY,
        category TEXT NOT NULL CHECK (category IN ('work_type','cause','decision','contractor','resource_measure')),
        value TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(user_id),
        UNIQUE (category, value)
      );
      INSERT INTO managed_dictionary_values SELECT * FROM managed_dictionary_values_old;
      DROP TABLE managed_dictionary_values_old;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  } catch (error) {
    db.exec('ROLLBACK; PRAGMA foreign_keys = ON;');
    throw error;
  }
}

// Lightweight forward migrations for installations created before these columns existed.
const qualityWorkColumns = new Set(db.prepare('PRAGMA table_info(resource_quality_work)').all().map((column) => column.name));
if (!qualityWorkColumns.has('department_measure')) db.exec("ALTER TABLE resource_quality_work ADD COLUMN department_measure TEXT NOT NULL DEFAULT ''");
if (!qualityWorkColumns.has('due_date')) db.exec('ALTER TABLE resource_quality_work ADD COLUMN due_date TEXT');
if (!qualityWorkColumns.has('owner')) db.exec("ALTER TABLE resource_quality_work ADD COLUMN owner TEXT NOT NULL DEFAULT ''");

const seedDevUsers = db.transaction(() => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO users (display_name, email, global_role)
    VALUES (?, ?, ?)
  `);
  insert.run('Администратор', 'admin@example.local', 'administrator');
  insert.run('Руководитель проекта', 'manager@example.local', 'project_manager');
  insert.run('Сотрудник Деп. ресурсов', 'resources@example.local', 'resource_manager');
  insert.run('Наблюдатель', 'observer@example.local', 'observer');
});

if (config.authMode === 'dev') {
  seedDevUsers();
  db.prepare(`INSERT INTO users (display_name, email, global_role)
    SELECT 'Сотрудник Деп. ресурсов', 'resources@example.local', 'resource_manager'
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE global_role = 'resource_manager')`).run();
  db.prepare(`
    INSERT OR IGNORE INTO user_object_access (user_id, object_id, object_role)
    SELECT u.user_id, o.object_id, 'project_manager'
    FROM users u CROSS JOIN objects o
    WHERE u.global_role = 'project_manager' AND o.is_active = 1
  `).run();
}

export function closeDatabase() {
  db.close();
}
