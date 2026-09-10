import { db } from '../database/index.js';
import { canViewObject, requireRole } from '../auth/index.js';
import { QUALITY_CRITERIA, isIsoDate } from '../manual/manual-report.js';

function scoreForCriterion(field, value) {
  const criterion = QUALITY_CRITERIA.find((item) => item.field === field);
  return criterion?.options.find(([, text]) => text === value)?.[0] ?? null;
}

function consistentQualityScore(row) {
  const scores = QUALITY_CRITERIA.map((criterion) => scoreForCriterion(criterion.field, row[criterion.field]));
  return scores.every(Number.isFinite)
    ? Math.round(scores.reduce((sum, value, index) => sum + value * QUALITY_CRITERIA[index].weight, 0) * 10) / 10
    : row.qualityScore;
}

function identity(source) {
  return {
    objectId: Number(source?.objectId),
    reportDate: String(source?.reportDate || ''),
    workType: String(source?.workType || '').trim(),
    detail: String(source?.detail || '').trim(),
    contractor: String(source?.contractor || '').trim(),
  };
}

function validate(request, reply, data) {
  if (!Number.isInteger(data.objectId) || !canViewObject(request.currentUser, data.objectId)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'Нет доступа к выбранному объекту.' });
    return false;
  }
  if (!isIsoDate(data.reportDate) || !data.workType) {
    reply.code(400).send({ error: 'VALIDATION', message: 'Выберите детализацию отчёта.' });
    return false;
  }
  return true;
}

function resolveRecord(data) {
  return db.prepare(`SELECT record_id FROM people_quality_records
    WHERE object_id=? AND report_date=? AND work_type=? AND detail=? AND contractor=?`)
    .get(data.objectId, data.reportDate, data.workType, data.detail, data.contractor)?.record_id;
}

function saveQualityWork(item, userId) {
  const existing = db.prepare('SELECT quality_work_id FROM resource_quality_work WHERE record_id=?').get(item.recordId);
  if (existing) {
    db.prepare(`UPDATE resource_quality_work SET is_resolved=?,department_measure=?,due_date=?,owner=?,comment=?,updated_by=?,updated_at=CURRENT_TIMESTAMP
      WHERE record_id=?`).run(item.isResolved, item.measure, item.dueDate, item.owner, item.comment, userId, item.recordId);
  } else {
    db.prepare(`INSERT INTO resource_quality_work(record_id,object_id,report_date,work_type,detail,contractor,is_resolved,department_measure,due_date,owner,comment,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(item.recordId, item.objectId, item.reportDate, item.workType, item.detail,
      item.contractor, item.isResolved, item.measure, item.dueDate, item.owner, item.comment, userId);
  }
}

export async function feedbackRoutes(app) {
  const resourceEditors = { preHandler: requireRole('administrator', 'resource_manager') };
  app.post('/api/resource-measures', resourceEditors, async (request, reply) => {
    const value = String(request.body?.value || '').trim();
    if (!value || value.length > 500) return reply.code(400).send({ error: 'VALIDATION', message: 'Укажите корректное название меры.' });
    db.prepare(`INSERT INTO managed_dictionary_values (category, value, created_by)
      VALUES ('resource_measure', ?, ?) ON CONFLICT(category, value) DO UPDATE SET is_active=1, updated_at=CURRENT_TIMESTAMP`).run(value, request.currentUser.id);
    return reply.code(201).send({ value });
  });
  app.get('/api/resource-deviations', async (request) => {
    const ids = ['administrator', 'resource_manager'].includes(request.currentUser.role)
      ? db.prepare('SELECT object_id FROM objects WHERE is_active = 1').all().map((item) => item.object_id)
      : db.prepare(`SELECT o.object_id FROM user_object_access a JOIN objects o ON o.object_id=a.object_id
          WHERE a.user_id=? AND o.is_active=1`).all(request.currentUser.id).map((item) => item.object_id);
    if (!ids.length) return { rows: [] };
    const marks = ids.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT r.record_id AS id, r.object_id AS objectId, o.object_name AS object,
        r.report_date AS date, r.work_type AS work, r.detail AS det, r.contractor AS contr,
        r.plan_people AS plan, r.actual_people AS fact, r.quality_score AS qualityScore,
        r.work_quality_fact AS qualityFact, r.discipline_fact AS safetyFact,
        r.people_count_fact AS peopleFact, r.productivity_fact AS volumeFact,
        r.cleanliness_fact AS cleanFact, r.cause AS reason, r.decision,
        coalesce(q.department_measure, '') AS measure, coalesce(q.comment, '') AS comment,
        q.due_date AS due, coalesce(q.owner, '') AS owner, coalesce(q.is_resolved, 0) AS done,
        q.updated_at AS updatedAt, u.display_name AS updatedBy
      FROM people_quality_records r
      JOIN objects o ON o.object_id=r.object_id
      LEFT JOIN resource_quality_work q ON q.record_id=r.record_id
      LEFT JOIN users u ON u.user_id=q.updated_by
      WHERE r.object_id IN (${marks})
        AND lower(trim(r.work_type)) NOT IN ('собственные силы', 'собственный силы')
        AND lower(trim(r.contractor)) NOT IN ('собственные силы', 'собственный силы')
      ORDER BY r.report_date DESC, o.object_name, r.source_row
    `).all(...ids);
    const externalRows = rows.filter((row) => ![row.work, row.contr]
      .some((value) => String(value || '').trim().toLocaleLowerCase('ru-RU') === 'собственные силы'));
    const measures = db.prepare(`SELECT value FROM managed_dictionary_values
      WHERE category='resource_measure' AND is_active=1 ORDER BY value`).all().map((item) => item.value);
    return { rows: externalRows.map((row) => ({ ...row, done: Boolean(row.done), qualityScore: consistentQualityScore(row),
      qualityCriterionScore: scoreForCriterion('work_quality_fact', row.qualityFact),
      safetyCriterionScore: scoreForCriterion('discipline_fact', row.safetyFact),
      peopleCriterionScore: scoreForCriterion('people_count_fact', row.peopleFact),
      volumeCriterionScore: scoreForCriterion('productivity_fact', row.volumeFact),
      cleanCriterionScore: scoreForCriterion('cleanliness_fact', row.cleanFact),
    })), measures };
  });
  app.get('/api/resource-work', async (request, reply) => {
    const objectId = Number(request.query?.objectId);
    const reportDate = String(request.query?.reportDate || '');
    if (!Number.isInteger(objectId) || !canViewObject(request.currentUser, objectId)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Нет доступа к выбранному объекту.' });
    }
    if (!isIsoDate(reportDate)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Выберите дату отчёта.' });
    }
    const comments = db.prepare(`
      SELECT f.work_type AS workType, f.detail, f.contractor, f.comment, f.updated_at AS updatedAt, u.display_name AS updatedBy
      FROM resource_feedback f JOIN users u ON u.user_id=f.updated_by WHERE f.object_id = ? AND f.report_date = ?
    `).all(objectId, reportDate);
    const quality = db.prepare(`
      SELECT q.work_type AS workType, q.detail, q.contractor, q.is_resolved AS isResolved,
        q.department_measure AS measure, q.due_date AS dueDate, q.owner,
        q.comment, q.updated_at AS updatedAt, u.display_name AS updatedBy
      FROM resource_quality_work q JOIN users u ON u.user_id=q.updated_by WHERE q.object_id = ? AND q.report_date = ?
    `).all(objectId, reportDate).map((item) => ({ ...item, isResolved: Boolean(item.isResolved) }));
    return { comments, quality };
  });

  app.get('/api/feedback', async (request, reply) => {
    const data = identity(request.query);
    if (!validate(request, reply, data)) return;
    const feedback = db.prepare(`
      SELECT f.comment, f.updated_at AS updatedAt, u.display_name AS updatedBy
      FROM resource_feedback f JOIN users u ON u.user_id = f.updated_by
      WHERE object_id = ? AND report_date = ? AND work_type = ? AND detail = ? AND contractor = ?
    `).get(data.objectId, data.reportDate, data.workType, data.detail, data.contractor);
    return { feedback: feedback || null };
  });

  app.put('/api/feedback', resourceEditors, async (request, reply) => {
    const data = identity(request.body);
    if (!validate(request, reply, data)) return;
    const comment = String(request.body?.comment || '').trim();
    if (!comment) return reply.code(400).send({ error: 'VALIDATION', message: 'Введите комментарий.' });
    if (comment.length > 2000) return reply.code(400).send({ error: 'VALIDATION', message: 'Комментарий не должен превышать 2000 символов.' });
    db.prepare(`
      INSERT INTO resource_feedback (object_id, report_date, work_type, detail, contractor, comment, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_id, report_date, work_type, detail, contractor) DO UPDATE SET
        comment = excluded.comment, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
    `).run(data.objectId, data.reportDate, data.workType, data.detail, data.contractor, comment, request.currentUser.id);
    return { saved: true };
  });

  app.put('/api/resource-work/quality/batch', resourceEditors, async (request, reply) => {
    const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
    if (!rows.length || rows.length > 500) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Нет изменений для сохранения или строк слишком много.' });
    }
    const prepared = [];
    for (const source of rows) {
      const data = identity(source);
      if (!validate(request, reply, data)) return;
      const comment = String(source?.comment || '').trim();
      const measure = String(source?.measure || '').trim();
      const owner = String(source?.owner || '').trim();
      const dueDate = String(source?.dueDate || '').trim() || null;
      if (comment.length > 2000 || measure.length > 500 || owner.length > 300 || (dueDate && !isIsoDate(dueDate))) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Некорректные данные отработки подрядчика.' });
      }
      const recordId = resolveRecord(data);
      if (!recordId) return reply.code(404).send({ error: 'RECORD_NOT_FOUND', message: 'Исходная строка отчёта не найдена.' });
      prepared.push({ ...data, recordId, comment, measure, owner, dueDate, isResolved: Number(Boolean(source?.isResolved)) });
    }
    db.transaction((items) => items.forEach((item) => saveQualityWork(item, request.currentUser.id)))(prepared);
    return { saved: true, count: prepared.length };
  });

  app.put('/api/resource-work/quality', resourceEditors, async (request, reply) => {
    const data = identity(request.body);
    if (!validate(request, reply, data)) return;
    const comment = String(request.body?.comment || '').trim();
    const measure = String(request.body?.measure || '').trim();
    const owner = String(request.body?.owner || '').trim();
    const dueDate = String(request.body?.dueDate || '').trim() || null;
    const isResolved = Number(Boolean(request.body?.isResolved));
    if (comment.length > 2000) return reply.code(400).send({ error: 'VALIDATION', message: 'Комментарий не должен превышать 2000 символов.' });
    if (measure.length > 500 || owner.length > 300 || (dueDate && !isIsoDate(dueDate))) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Некорректные данные отработки отклонения.' });
    }
    const recordId = resolveRecord(data);
    if (!recordId) return reply.code(404).send({ error: 'RECORD_NOT_FOUND', message: 'Исходная строка отчёта не найдена.' });
    saveQualityWork({ ...data, recordId, isResolved, measure, dueDate, owner, comment }, request.currentUser.id);
    return { saved: true };
  });
}
