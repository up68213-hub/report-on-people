import { createConsistentBackup } from './backup.js';

const scoreCase = (column, pairs) => `CASE ${column} ${pairs.map(([text, score]) => `WHEN '${text.replaceAll("'", "''")}' THEN ${score}`).join(' ')} ELSE NULL END`;

const scores = {
  work_quality_fact: [['Замечаний и предписаний СК нет', 5], ['Несущественные замечания, устранены в срок', 4], ['Несущественные замечания, устраняются с задержкой', 3], ['Критическое замечание (брак) - впервые', 2], ['Критическое замечание - повторно', 1], ['Работы не приняты: неустранимый брак', 0]],
  discipline_fact: [['Все в СИЗ, нарушений ТБ нет', 5], ['Единичные нарушения (1–2 чел.), сразу устранены', 4], ['Регулярно нарушают 10–20% работников', 3], ['Более 30% без СИЗ или грубые нарушения ТБ', 2], ['Без СИЗ более половины бригады, работы остановлены', 1], ['Отказ соблюдать ТБ, работы запрещены', 0]],
  people_count_fact: [['Явка 90-100% от реальной потребности', 5], ['Явка 75–90%', 4], ['Явка 60–75%', 3], ['Явка 45–60%', 2], ['Явка 30–45%', 1], ['Явка менее 30%, срыв смены', 0]],
  productivity_fact: [['План выполнен на 90-100%', 5], ['Выполнено 75–90%', 4], ['Выполнено 60–75%', 3], ['Выполнено 45–60%', 2], ['Выполнено 30–45%', 1], ['Выполнено менее 30%, план провален', 0]],
  cleanliness_fact: [['Ежедневная уборка, замечаний нет', 5], ['Мелкий мусор, убирают после замечания', 4], ['Уборка не ежедневная, убирают после напоминания', 3], ['Убирают после нескольких напоминаний', 2], ['Уборка не производится, мусор не вывозится', 1], ['Захламлено, угроза безопасности', 0]],
};

const migrations = [
  {
    version: 1,
    name: 'versioned_schema_and_numeric_quality',
    up(db) {
      const recordColumns = new Set(db.prepare('PRAGMA table_info(people_quality_records)').all().map((item) => item.name));
      for (const name of ['work_quality_score', 'discipline_score', 'people_count_score', 'productivity_score', 'cleanliness_score']) {
        if (!recordColumns.has(name)) db.exec(`ALTER TABLE people_quality_records ADD COLUMN ${name} INTEGER CHECK (${name} IS NULL OR ${name} BETWEEN 0 AND 5)`);
      }
      const planColumns = new Set(db.prepare('PRAGMA table_info(manual_plan_rows)').all().map((item) => item.name));
      if (!planColumns.has('source_import_id')) db.exec('ALTER TABLE manual_plan_rows ADD COLUMN source_import_id INTEGER REFERENCES imports(import_id)');
      db.exec(`CREATE TABLE IF NOT EXISTS plan_changes (
        change_id INTEGER PRIMARY KEY, import_id INTEGER NOT NULL, plan_row_id INTEGER,
        change_type TEXT NOT NULL CHECK(change_type IN ('insert','update','deactivate')),
        previous_data_json TEXT, new_data_json TEXT NOT NULL,
        FOREIGN KEY(import_id) REFERENCES imports(import_id) ON DELETE CASCADE,
        FOREIGN KEY(plan_row_id) REFERENCES manual_plan_rows(plan_row_id) ON DELETE SET NULL,
        UNIQUE(import_id, plan_row_id)
      )`);
      db.exec(`UPDATE people_quality_records SET
        work_quality_score=${scoreCase('work_quality_fact', scores.work_quality_fact)},
        discipline_score=${scoreCase('discipline_fact', scores.discipline_fact)},
        people_count_score=${scoreCase('people_count_fact', scores.people_count_fact)},
        productivity_score=${scoreCase('productivity_fact', scores.productivity_fact)},
        cleanliness_score=${scoreCase('cleanliness_fact', scores.cleanliness_fact)}`);
      db.exec(`UPDATE people_quality_records SET quality_score=ROUND((work_quality_score+discipline_score+people_count_score+productivity_score+cleanliness_score)/5.0,1)
        WHERE work_quality_score IS NOT NULL AND discipline_score IS NOT NULL AND people_count_score IS NOT NULL AND productivity_score IS NOT NULL AND cleanliness_score IS NOT NULL`);
    },
  },
  {
    version: 2,
    name: 'record_foreign_keys',
    up(db) {
      const resourceColumns = new Set(db.prepare('PRAGMA table_info(resource_quality_work)').all().map((item) => item.name));
      if (!resourceColumns.has('record_id')) db.exec('ALTER TABLE resource_quality_work ADD COLUMN record_id INTEGER REFERENCES people_quality_records(record_id) ON DELETE CASCADE');
      db.exec(`UPDATE resource_quality_work SET record_id=(SELECT r.record_id FROM people_quality_records r
        WHERE r.object_id=resource_quality_work.object_id AND r.report_date=resource_quality_work.report_date
          AND r.work_type=resource_quality_work.work_type AND r.detail=resource_quality_work.detail AND r.contractor=resource_quality_work.contractor)
        WHERE record_id IS NULL`);
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_quality_record ON resource_quality_work(record_id) WHERE record_id IS NOT NULL');
      const importSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='import_changes'").get()?.sql || '';
      if (!/REFERENCES\s+people_quality_records/i.test(importSql)) {
        db.exec('PRAGMA foreign_keys=OFF');
        try {
          db.exec(`CREATE TABLE import_changes_new (
            change_id INTEGER PRIMARY KEY, import_id INTEGER NOT NULL, record_id INTEGER,
            change_type TEXT NOT NULL CHECK(change_type IN ('insert','update')),
            previous_data_json TEXT, new_data_json TEXT NOT NULL,
            FOREIGN KEY(import_id) REFERENCES imports(import_id) ON DELETE CASCADE,
            FOREIGN KEY(record_id) REFERENCES people_quality_records(record_id) ON DELETE SET NULL,
            UNIQUE(import_id, record_id)
          );
          INSERT INTO import_changes_new SELECT * FROM import_changes;
          DROP TABLE import_changes;
          ALTER TABLE import_changes_new RENAME TO import_changes;`);
        } finally { db.exec('PRAGMA foreign_keys=ON'); }
      }
    },
  },
  {
    version: 3,
    name: 'unified_dictionary',
    up(db) {
      const legacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='manual_dictionary_values'").get();
      if (!legacy) return;
      const admin = db.prepare("SELECT user_id FROM users WHERE global_role='administrator' ORDER BY user_id LIMIT 1").get();
      if (admin) db.prepare(`INSERT INTO managed_dictionary_values(category,value,created_by)
        SELECT category,value,? FROM manual_dictionary_values WHERE 1
        ON CONFLICT(category,value) DO NOTHING`).run(admin.user_id);
      db.exec('DROP TABLE IF EXISTS manual_dictionary_values');
    },
  },
  {
    version: 4,
    name: 'record_owned_resource_work_and_current_view',
    up(db) {
      const nullableRecord = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='resource_quality_work'").get()?.sql || '';
      if (!/record_id\s+INTEGER\s+NOT NULL/i.test(nullableRecord)) {
        db.exec(`CREATE TABLE resource_quality_work_new (
          quality_work_id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL UNIQUE,
          object_id INTEGER NOT NULL, report_date TEXT NOT NULL, work_type TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '', contractor TEXT NOT NULL DEFAULT '',
          is_resolved INTEGER NOT NULL DEFAULT 0 CHECK(is_resolved IN (0,1)),
          department_measure TEXT NOT NULL DEFAULT '', due_date TEXT, owner TEXT NOT NULL DEFAULT '',
          comment TEXT NOT NULL DEFAULT '', updated_by INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(record_id) REFERENCES people_quality_records(record_id) ON DELETE CASCADE,
          FOREIGN KEY(object_id) REFERENCES objects(object_id) ON DELETE CASCADE,
          FOREIGN KEY(updated_by) REFERENCES users(user_id)
        );
        INSERT INTO resource_quality_work_new SELECT quality_work_id,record_id,object_id,report_date,work_type,detail,contractor,
          is_resolved,department_measure,due_date,owner,comment,updated_by,created_at,updated_at
          FROM resource_quality_work WHERE record_id IS NOT NULL;
        DROP TABLE resource_quality_work;
        ALTER TABLE resource_quality_work_new RENAME TO resource_quality_work;`);
      }
      db.exec(`DROP VIEW IF EXISTS v_people_quality_all;
        CREATE VIEW v_people_quality_all AS SELECT r.*,o.object_name,
          CASE WHEN r.plan_people IS NOT NULL AND r.actual_people IS NOT NULL THEN r.actual_people-r.plan_people END AS deviation
        FROM people_quality_records r JOIN objects o ON o.object_id=r.object_id;`);
    },
  },
];

export function runMigrations(db, sqlite, databasePath) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((item) => item.version));
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  if (!pending.length) return [];
  createConsistentBackup(sqlite, databasePath, `before-v${pending.at(-1).version}`);
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(migration.version, migration.name);
    })();
  }
  return pending.map(({ version, name }) => ({ version, name }));
}
