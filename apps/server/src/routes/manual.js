import crypto from 'node:crypto';
import { db } from '../database/index.js';
import { canEditObject, requireRole } from '../auth/index.js';
import {
  CAUSES, DECISIONS, QUALITY_CRITERIA, WORK_TYPES, isFriday, qualityScore, validateManualReport,
} from '../manual/manual-report.js';

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

function todayLocal() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function assertAccess(request, reply, objectId) {
  if (!Number.isInteger(objectId) || objectId < 1) {
    reply.code(400).send({ error: 'OBJECT_REQUIRED', message: 'Выберите объект.' });
    return false;
  }
  if (!canEditObject(request.currentUser, objectId)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'Нет права вносить данные этого объекта.' });
    return false;
  }
  return true;
}

function catalogs() {
  const custom = db.prepare('SELECT category, value FROM manual_dictionary_values ORDER BY value').all();
  const managedAll = db.prepare('SELECT category, value, is_active AS isActive FROM managed_dictionary_values ORDER BY value').all();
  const managed = managedAll.filter((item) => item.isActive);
  const recordWorks = db.prepare("SELECT DISTINCT work_type AS value FROM people_quality_records WHERE trim(work_type) <> ''").all();
  const recordCauses = db.prepare("SELECT DISTINCT cause AS value FROM people_quality_records WHERE trim(coalesce(cause, '')) <> ''").all();
  const recordContractors = db.prepare("SELECT DISTINCT contractor AS value FROM people_quality_records WHERE trim(contractor) <> ''").all();
  const recordDecisions = db.prepare("SELECT DISTINCT decision AS value FROM people_quality_records WHERE trim(coalesce(decision, '')) <> ''").all();
  const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  return {
    workTypes: unique(managedAll.some((x) => x.category === 'work_type') ? managed.filter((x) => x.category === 'work_type').map((x) => x.value) : [...WORK_TYPES, ...recordWorks.map((x) => x.value), ...custom.filter((x) => x.category === 'work_type').map((x) => x.value)]),
    causes: unique(managedAll.some((x) => x.category === 'cause') ? managed.filter((x) => x.category === 'cause').map((x) => x.value) : [...CAUSES, ...recordCauses.map((x) => x.value), ...custom.filter((x) => x.category === 'cause').map((x) => x.value)]),
    decisions: unique(managedAll.some((x) => x.category === 'decision') ? managed.filter((x) => x.category === 'decision').map((x) => x.value) : [...DECISIONS, ...recordDecisions.map((x) => x.value)]),
    contractors: unique(managedAll.some((x) => x.category === 'contractor') ? managed.filter((x) => x.category === 'contractor').map((x) => x.value) : recordContractors.map((x) => x.value)),
    qualityCriteria: QUALITY_CRITERIA.map(({ key, title, options }) => ({ key, title, options: options.map(([, text]) => text) })),
  };
}

function planRows(objectId, reportDate) {
  const current = db.prepare(`
    SELECT p.plan_row_id AS id, r.work_type AS workType, r.detail, r.contractor,
      r.plan_people AS planPeople, r.actual_people AS actualPeople, r.cause, r.decision,
      r.work_quality_fact AS workQualityFact, r.discipline_fact AS disciplineFact,
      r.people_count_fact AS peopleCountFact, r.productivity_fact AS productivityFact,
      r.cleanliness_fact AS cleanlinessFact, r.source_row AS sortOrder
    FROM people_quality_records r
    LEFT JOIN manual_plan_rows p ON p.object_id = r.object_id
      AND p.work_type = r.work_type AND p.detail = r.detail AND p.contractor = r.contractor
    WHERE r.object_id = ? AND r.report_date = ?
    ORDER BY r.source_row
  `).all(objectId, reportDate);
  if (current.length) return current;
  const saved = db.prepare(`
    SELECT plan_row_id AS id, work_type AS workType, detail, contractor,
      plan_people AS planPeople, sort_order AS sortOrder
    FROM manual_plan_rows WHERE object_id = ? AND is_active = 1
    ORDER BY sort_order, plan_row_id
  `).all(objectId);
  if (saved.length) return saved;
  return db.prepare(`
    SELECT NULL AS id, work_type AS workType, detail, contractor, plan_people AS planPeople,
      source_row AS sortOrder
    FROM people_quality_records
    WHERE object_id = ? AND report_date = (
      SELECT MAX(report_date) FROM people_quality_records WHERE object_id = ?
    ) ORDER BY source_row
  `).all(objectId, objectId);
}

function weekRange(reportDate) {
  const date = new Date(`${reportDate}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return { start: reportDate, end: reportDate };
  const day = date.getUTCDay() || 7;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - day + 1);
  return { start: start.toISOString().slice(0, 10), end: reportDate };
}

function weeklyContractors(objectId, reportDate) {
  const { start, end } = weekRange(reportDate);
  return db.prepare(`
    SELECT contractor, work_type AS workType,
      MIN(report_date) AS firstDate, MAX(report_date) AS lastDate,
      MAX(work_quality_fact) AS workQualityFact,
      MAX(discipline_fact) AS disciplineFact,
      MAX(people_count_fact) AS peopleCountFact,
      MAX(productivity_fact) AS productivityFact,
      MAX(cleanliness_fact) AS cleanlinessFact
    FROM people_quality_records
    WHERE object_id = ? AND report_date BETWEEN ? AND ?
      AND trim(contractor) <> '' AND lower(trim(work_type)) <> 'собственные силы'
      AND lower(trim(contractor)) <> 'собственные силы'
      AND actual_people > 0
    GROUP BY lower(trim(contractor)), lower(trim(work_type))
    ORDER BY contractor, work_type
  `).all(objectId, start, end);
}

export async function manualRoutes(app) {
  app.get('/api/manual/status', {
    preHandler: requireRole('administrator', 'project_manager'),
  }, async (request, reply) => {
    const objectId = Number(request.query.objectId);
    if (!assertAccess(request, reply, objectId)) return;
    const reportDate = String(request.query.reportDate || '');
    const stats = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN actual_people IS NOT NULL THEN 1 ELSE 0 END) AS filled,
      MAX(updated_at) AS updatedAt FROM people_quality_records WHERE object_id = ? AND report_date = ?`).get(objectId, reportDate);
    const author = db.prepare(`SELECT u.display_name AS name FROM imports i JOIN users u ON u.user_id = i.uploaded_by
      WHERE i.object_id = ? AND i.original_name = ? AND i.status = 'completed' ORDER BY i.imported_at DESC LIMIT 1`)
      .get(objectId, `Ручной отчёт за ${reportDate}`);
    const lock = db.prepare(`SELECT l.user_id AS userId, u.display_name AS userName FROM report_edit_locks l
      JOIN users u ON u.user_id = l.user_id WHERE l.object_id = ? AND l.report_date = ? AND l.expires_at > CURRENT_TIMESTAMP`).get(objectId, reportDate);
    const planCount = db.prepare('SELECT COUNT(*) AS count FROM manual_plan_rows WHERE object_id = ? AND is_active = 1').get(objectId).count;
    return { total: Number(stats.total || planCount || 0), filled: Number(stats.filled || 0), updatedAt: stats.updatedAt, author: author?.name || null,
      lockedBy: lock && Number(lock.userId) !== Number(request.currentUser.id) ? lock.userName : null, isToday: reportDate === todayLocal(), today: todayLocal() };
  });

  app.post('/api/manual/lock', { preHandler: requireRole('administrator', 'project_manager') }, async (request, reply) => {
    const objectId = Number(request.body?.objectId); if (!assertAccess(request, reply, objectId)) return;
    const reportDate = String(request.body?.reportDate || '');
    if (reportDate !== todayLocal()) return reply.code(403).send({ error: 'DATE_CLOSED', message: 'Редактировать можно только текущий день.' });
    db.prepare('DELETE FROM report_edit_locks WHERE expires_at <= CURRENT_TIMESTAMP').run();
    const current = db.prepare('SELECT l.user_id AS userId, u.display_name AS author FROM report_edit_locks l JOIN users u ON u.user_id=l.user_id WHERE object_id = ? AND report_date = ?').get(objectId, reportDate);
    if (current && Number(current.userId) !== Number(request.currentUser.id)) return reply.code(409).send({ error: 'REPORT_LOCKED', message: 'Отчёт уже редактирует коллега.', errors: [{ author: current.author }] });
    db.prepare(`INSERT INTO report_edit_locks (object_id, report_date, user_id, expires_at) VALUES (?, ?, ?, datetime('now','+15 minutes'))
      ON CONFLICT(object_id, report_date) DO UPDATE SET user_id=excluded.user_id, expires_at=excluded.expires_at, updated_at=CURRENT_TIMESTAMP`).run(objectId, reportDate, request.currentUser.id);
    return { locked: true };
  });

  app.delete('/api/manual/lock', { preHandler: requireRole('administrator', 'project_manager') }, async (request) => {
    db.prepare('DELETE FROM report_edit_locks WHERE object_id = ? AND report_date = ? AND user_id = ?').run(Number(request.body?.objectId), String(request.body?.reportDate || ''), request.currentUser.id);
    return { released: true };
  });
  app.get('/api/manual/catalogs', {
    preHandler: requireRole('administrator', 'project_manager'),
  }, async () => catalogs());

  app.get('/api/manual/form', {
    preHandler: requireRole('administrator', 'project_manager'),
  }, async (request, reply) => {
    const objectId = Number(request.query.objectId);
    if (!assertAccess(request, reply, objectId)) return;
    const reportDate = String(request.query.reportDate || '');
    return { rows: planRows(objectId, reportDate), weeklyContractors: weeklyContractors(objectId, reportDate), ...catalogs() };
  });

  app.post('/api/manual/reports', {
    preHandler: requireRole('administrator', 'project_manager'),
  }, async (request, reply) => {
    const objectId = Number(request.body?.objectId);
    if (!assertAccess(request, reply, objectId)) return;
    const reportDate = String(request.body?.reportDate || '');
    if (reportDate !== todayLocal()) {
      return reply.code(403).send({ error: 'HISTORICAL_EDIT_FORBIDDEN', message: 'Можно вносить и исправлять данные только за сегодняшний день.' });
    }
    const activeLock = db.prepare(`SELECT l.user_id AS userId, u.display_name AS author FROM report_edit_locks l JOIN users u ON u.user_id=l.user_id
      WHERE object_id = ? AND report_date = ? AND expires_at > CURRENT_TIMESTAMP`).get(objectId, reportDate);
    if (!activeLock || Number(activeLock.userId) !== Number(request.currentUser.id)) {
      return reply.code(409).send({ error: 'LOCK_LOST', message: 'Сеанс редактирования истёк или отчёт открыт другим пользователем.', errors: [{ author: activeLock?.author || 'другой пользователь' }] });
    }
    const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
    const weeklyQuality = Array.isArray(request.body?.weeklyQuality) ? request.body.weeklyQuality : [];
    const removedPlanRowIds = Array.isArray(request.body?.removedPlanRowIds)
      ? request.body.removedPlanRowIds.map(Number).filter(Number.isInteger) : [];
    if (!rows.length) return reply.code(400).send({ error: 'ROWS_REQUIRED', message: 'Добавьте хотя бы одну строку.' });

    const { start: weekStart } = weekRange(reportDate);
    const weeklyRows = db.prepare(`
      SELECT lower(trim(contractor)) AS contractor, SUM(actual_people) AS fact
      FROM people_quality_records
      WHERE object_id = ? AND report_date BETWEEN ? AND ? AND trim(contractor) <> ''
      GROUP BY lower(trim(contractor))
    `).all(objectId, weekStart, reportDate);
    const weeklyFacts = Object.fromEntries(weeklyRows.map((row) => [normalized(row.contractor), Number(row.fact || 0)]));
    const errors = validateManualReport({ reportDate, rows, weeklyFacts });
    if (isFriday(reportDate)) {
      const required = new Map();
      weeklyContractors(objectId, reportDate).forEach((item) => required.set(`${normalized(item.contractor)}\u001f${normalized(item.workType)}`, item));
      rows.filter((row) => Number(row.actualPeople) > 0 && String(row.contractor || '').trim() && normalized(row.workType) !== 'собственные силы')
        .forEach((row) => required.set(`${normalized(row.contractor)}\u001f${normalized(row.workType)}`, row));
      const ratings = new Map(weeklyQuality.map((item) => [`${normalized(item.contractor)}\u001f${normalized(item.workType)}`, item]));
      required.forEach((item, key) => {
        const rating = ratings.get(key);
        const filled = rating ? QUALITY_CRITERIA.filter((criterion) => String(rating[criterion.key] || '').trim()).length : 0;
        if (filled < QUALITY_CRITERIA.length) errors.push({ row: null, field: 'quality', message: `Заполните недельную оценку: ${item.contractor} — ${item.workType} (${filled} из 5).` });
      });
    }
    if (errors.length) return reply.code(422).send({ error: 'VALIDATION_FAILED', message: errors[0].message, errors });

    const submitted = rows.filter((row) => row.actualPeople !== null && row.actualPeople !== '');
    const save = db.transaction(() => {
      const saveDictionary = db.prepare(`
        INSERT INTO manual_dictionary_values (category, value, created_by)
        VALUES (?, ?, ?) ON CONFLICT(category, value) DO NOTHING
      `);
      const savePlan = db.prepare(`
        INSERT INTO manual_plan_rows (
          object_id, work_type, detail, contractor, plan_people, sort_order, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(object_id, work_type, detail, contractor) DO UPDATE SET
          plan_people = excluded.plan_people, sort_order = excluded.sort_order,
          is_active = 1, updated_at = CURRENT_TIMESTAMP
      `);
      const updatePlan = db.prepare(`
        UPDATE manual_plan_rows SET work_type = ?, detail = ?, contractor = ?, plan_people = ?,
          sort_order = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE plan_row_id = ? AND object_id = ?
      `);
      const deactivatePlan = db.prepare(`
        UPDATE manual_plan_rows SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE plan_row_id = ? AND object_id = ?
      `);
      const updateWeeklyQuality = db.prepare(`
        UPDATE people_quality_records SET
          quality_score = @quality_score,
          work_quality_fact = @work_quality_fact,
          discipline_fact = @discipline_fact,
          people_count_fact = @people_count_fact,
          productivity_fact = @productivity_fact,
          cleanliness_fact = @cleanliness_fact,
          source_import_id = @source_import_id,
          updated_at = CURRENT_TIMESTAMP
        WHERE object_id = @object_id AND report_date BETWEEN @week_start AND @report_date
          AND lower(trim(contractor)) = @contractor AND lower(trim(work_type)) = @work_type
      `);
      removedPlanRowIds.forEach((planRowId) => deactivatePlan.run(planRowId, objectId));
      rows.forEach((row, index) => {
        const workType = String(row.workType || '').trim();
        const cause = String(row.cause || '').trim();
        if (workType) saveDictionary.run('work_type', workType, request.currentUser.id);
        if (cause) saveDictionary.run('cause', cause, request.currentUser.id);
        const detail = String(row.detail || '').trim();
        const contractor = String(row.contractor || '').trim();
        if (Number.isInteger(Number(row.id)) && Number(row.id) > 0) updatePlan.run(workType, detail, contractor, Number(row.planPeople || 0), index, Number(row.id), objectId);
        else savePlan.run(objectId, workType, detail, contractor, Number(row.planPeople || 0), index, request.currentUser.id);
      });
      if (!submitted.length) return { saved: 0, inserted: 0, updated: 0 };

      const importRow = db.prepare(`
        INSERT INTO imports (object_id, uploaded_by, original_name, sha256)
        VALUES (?, ?, ?, ?)
      `).run(objectId, request.currentUser.id, `Ручной отчёт за ${reportDate}`, `manual:${crypto.randomUUID()}`);
      const importId = Number(importRow.lastInsertRowid);
      let inserted = 0;
      let updated = 0;
      submitted.forEach((row, index) => {
        const workType = String(row.workType || '').trim();
        const detail = String(row.detail || '').trim();
        const contractor = String(row.contractor || '').trim();
        const current = db.prepare(`
          SELECT * FROM people_quality_records
          WHERE object_id = ? AND report_date = ? AND work_type = ? AND detail = ? AND contractor = ?
        `).get(objectId, reportDate, workType, detail, contractor);
        const criteria = Object.fromEntries(QUALITY_CRITERIA.map((item) => [item.field, String(row[item.key] || '').trim() || null]));
        const payload = {
          report_date: reportDate, work_type: workType, detail, contractor,
          quality_score: qualityScore(row), plan_people: Number(row.planPeople || 0), actual_people: Number(row.actualPeople),
          cause: String(row.cause || '').trim() || null, decision: String(row.decision || '').trim() || null,
          ...criteria, source_import_id: importId, source_sheet: 'Ручной ввод', source_row: index + 1,
        };
        if (!current) {
          const columns = Object.keys(payload);
          const created = db.prepare(`INSERT INTO people_quality_records (object_id, ${columns.join(', ')}) VALUES (@object_id, ${columns.map((key) => `@${key}`).join(', ')})`)
            .run({ object_id: objectId, ...payload });
          const recordId = Number(created.lastInsertRowid);
          db.prepare(`INSERT INTO import_changes (import_id, record_id, change_type, previous_data_json, new_data_json) VALUES (?, ?, 'insert', NULL, ?)`)
            .run(importId, recordId, JSON.stringify({ object_id: objectId, ...payload }));
          inserted += 1;
        } else {
          const columns = Object.keys(payload);
          db.prepare(`UPDATE people_quality_records SET ${columns.map((key) => `${key} = @${key}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE record_id = @record_id`)
            .run({ record_id: current.record_id, ...payload });
          db.prepare(`INSERT INTO import_changes (import_id, record_id, change_type, previous_data_json, new_data_json) VALUES (?, ?, 'update', ?, ?)`)
            .run(importId, current.record_id, JSON.stringify(current), JSON.stringify(payload));
          updated += 1;
        }
      });
      weeklyQuality.forEach((rating) => {
        const row = Object.fromEntries(QUALITY_CRITERIA.map((item) => [item.key, String(rating[item.key] || '').trim()]));
        if (QUALITY_CRITERIA.some((item) => !row[item.key])) return;
        const updatePayload = {
          object_id: objectId, week_start: weekStart, report_date: reportDate,
          contractor: normalized(rating.contractor), work_type: normalized(rating.workType),
          quality_score: qualityScore(row),
          source_import_id: importId,
          ...Object.fromEntries(QUALITY_CRITERIA.map((item) => [item.field, row[item.key]])),
        };
        const affected = db.prepare(`SELECT * FROM people_quality_records
          WHERE object_id = ? AND report_date BETWEEN ? AND ?
            AND lower(trim(contractor)) = ? AND lower(trim(work_type)) = ?`)
          .all(objectId, weekStart, reportDate, updatePayload.contractor, updatePayload.work_type);
        updateWeeklyQuality.run(updatePayload);
        affected.forEach((previous) => {
          const next = { ...previous, quality_score: updatePayload.quality_score, source_import_id: importId,
            ...Object.fromEntries(QUALITY_CRITERIA.map((item) => [item.field, updatePayload[item.field]])) };
          db.prepare(`INSERT INTO import_changes (import_id, record_id, change_type, previous_data_json, new_data_json)
            VALUES (?, ?, 'update', ?, ?)`).run(importId, previous.record_id, JSON.stringify(previous), JSON.stringify(next));
        });
      });
      db.prepare(`UPDATE imports SET status = 'completed', inserted_count = ?, updated_count = ? WHERE import_id = ?`)
        .run(inserted, updated, importId);
      return { saved: submitted.length, inserted, updated, importId };
    });

    const result = save();
    db.prepare('DELETE FROM report_edit_locks WHERE object_id = ? AND report_date = ? AND user_id = ?').run(objectId, reportDate, request.currentUser.id);
    return reply.code(201).send(result);
  });
}
