import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'people-report-'));
process.env.NODE_ENV = 'test';
process.env.AUTH_MODE = 'dev';
process.env.DATABASE_PATH = path.join(testRoot, 'report.sqlite');
process.env.REPORT_TODAY = '2026-09-11';

const [{ buildApp }, { db, closeDatabase }, { QUALITY_CRITERIA }] = await Promise.all([
  import('../src/server.js'), import('../src/database/index.js'), import('../src/manual/manual-report.js'),
]);
const app = await buildApp({ logger: false });
const objectId = Number(db.prepare("INSERT INTO objects(object_name) VALUES('Интеграционный объект')").run().lastInsertRowid);
db.prepare("INSERT INTO user_object_access(user_id,object_id,object_role) VALUES(2,?,'project_manager')").run(objectId);
const headers = (userId) => ({ 'x-dev-user-id': String(userId), 'content-type': 'application/json' });

test.after(async () => {
  await app.close();
  closeDatabase();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('enforces RBAC and an exclusive report lock', async () => {
  const forbidden = await app.inject({ method: 'POST', url: '/api/manual/lock', headers: headers(4),
    payload: { objectId, reportDate: '2026-09-11' } });
  assert.equal(forbidden.statusCode, 403);
  const acquired = await app.inject({ method: 'POST', url: '/api/manual/lock', headers: headers(2),
    payload: { objectId, reportDate: '2026-09-11' } });
  assert.equal(acquired.statusCode, 200);
  const conflict = await app.inject({ method: 'POST', url: '/api/manual/lock', headers: headers(1),
    payload: { objectId, reportDate: '2026-09-11' } });
  assert.equal(conflict.statusCode, 409);
});

test('saves Friday once per record, audits the plan, and reverts both', async () => {
  const quality = Object.fromEntries(QUALITY_CRITERIA.map((criterion) => [criterion.key, criterion.options[2][1]]));
  const row = { workType: 'Отделка', detail: 'Этаж 1', contractor: 'Подрядчик', planPeople: 10,
    actualPeople: 7, cause: 'нет материалов', ...quality };
  const response = await app.inject({ method: 'POST', url: '/api/manual/reports', headers: headers(2),
    payload: { objectId, reportDate: '2026-09-11', rows: [row], weeklyQuality: [{ contractor: row.contractor, workType: row.workType, ...quality }] } });
  assert.equal(response.statusCode, 201, response.body);
  const { importId } = response.json();
  assert.equal(db.prepare('SELECT COUNT(*) count FROM import_changes WHERE import_id=?').get(importId).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_changes WHERE import_id=?').get(importId).count, 1);
  const record = db.prepare('SELECT * FROM people_quality_records WHERE source_import_id=?').get(importId);
  assert.equal(record.quality_score, 3);
  assert.deepEqual([record.work_quality_score, record.discipline_score, record.people_count_score,
    record.productivity_score, record.cleanliness_score], [3, 3, 3, 3, 3]);

  const reverted = await app.inject({ method: 'POST', url: `/api/manual/history/${importId}/revert`, headers: headers(1), payload: {} });
  assert.equal(reverted.statusCode, 200, reverted.body);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM people_quality_records WHERE source_import_id=?').get(importId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM manual_plan_rows WHERE source_import_id=?').get(importId).count, 0);
});
