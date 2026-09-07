import { db } from '../database/index.js';
import { canViewObject, requireRole } from '../auth/index.js';

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.reportDate) || !data.workType) {
    reply.code(400).send({ error: 'VALIDATION', message: 'Выберите детализацию отчёта.' });
    return false;
  }
  return true;
}

export async function feedbackRoutes(app) {
  const resourceEditors = { preHandler: requireRole('administrator', 'resource_manager') };
  app.get('/api/resource-work', async (request, reply) => {
    const objectId = Number(request.query?.objectId);
    const reportDate = String(request.query?.reportDate || '');
    if (!Number.isInteger(objectId) || !canViewObject(request.currentUser, objectId)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Нет доступа к выбранному объекту.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Выберите дату отчёта.' });
    }
    const comments = db.prepare(`
      SELECT f.work_type AS workType, f.detail, f.contractor, f.comment, f.updated_at AS updatedAt, u.display_name AS updatedBy
      FROM resource_feedback f JOIN users u ON u.user_id=f.updated_by WHERE f.object_id = ? AND f.report_date = ?
    `).all(objectId, reportDate);
    const quality = db.prepare(`
      SELECT q.work_type AS workType, q.detail, q.contractor, q.is_resolved AS isResolved,
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

  app.put('/api/resource-work/quality', resourceEditors, async (request, reply) => {
    const data = identity(request.body);
    if (!validate(request, reply, data)) return;
    const comment = String(request.body?.comment || '').trim();
    const isResolved = Number(Boolean(request.body?.isResolved));
    if (comment.length > 2000) return reply.code(400).send({ error: 'VALIDATION', message: 'Комментарий не должен превышать 2000 символов.' });
    db.prepare(`
      INSERT INTO resource_quality_work (object_id, report_date, work_type, detail, contractor, is_resolved, comment, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_id, report_date, work_type, detail, contractor) DO UPDATE SET
        is_resolved = excluded.is_resolved, comment = excluded.comment,
        updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
    `).run(data.objectId, data.reportDate, data.workType, data.detail, data.contractor, isResolved, comment, request.currentUser.id);
    return { saved: true };
  });
}
