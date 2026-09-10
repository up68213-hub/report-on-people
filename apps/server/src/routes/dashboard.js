import { db } from '../database/index.js';
import { accessibleObjectIds, canViewObject } from '../auth/index.js';
import { QUALITY_CRITERIA, qualityScore } from '../manual/manual-report.js';

function consistentQualityScore(row) {
  const values = Object.fromEntries(QUALITY_CRITERIA.map((criterion) => [criterion.key, row[criterion.field]]));
  return QUALITY_CRITERIA.every((criterion) => String(values[criterion.key] || '').trim())
    ? qualityScore(values) : row.quality_score;
}

function placeholders(items) {
  return items.map(() => '?').join(', ');
}

export async function dashboardRoutes(app) {
  app.get('/api/object-options', async (request) => {
    const ids = new Set(accessibleObjectIds(request.currentUser));
    return { objects: db.prepare('SELECT object_id AS id, object_name AS name FROM objects WHERE is_active = 1 ORDER BY object_name').all()
      .map((object) => ({ ...object, hasAccess: ids.has(object.id) })) };
  });

  app.post('/api/access-requests', async (request, reply) => {
    const objectId = Number(request.body?.objectId);
    if (!Number.isInteger(objectId) || !db.prepare('SELECT 1 FROM objects WHERE object_id = ? AND is_active = 1').get(objectId)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Выберите действующий объект.' });
    }
    if (canViewObject(request.currentUser, objectId)) return { requested: false, hasAccess: true };
    db.prepare(`INSERT INTO object_access_requests (user_id, object_id) VALUES (?, ?)
      ON CONFLICT(user_id, object_id) WHERE status = 'pending' DO NOTHING`).run(request.currentUser.id, objectId);
    return reply.code(201).send({ requested: true });
  });

  app.get('/api/objects', async (request) => {
    const ids = accessibleObjectIds(request.currentUser);
    if (!ids.length) return { objects: [] };
    const rows = db.prepare(`
      SELECT o.object_id AS id, o.object_name AS name,
        MAX(r.report_date) AS latestDate,
        COUNT(r.record_id) AS recordCount
      FROM objects o
      LEFT JOIN people_quality_records r ON r.object_id = o.object_id
      WHERE o.object_id IN (${placeholders(ids)}) AND o.is_active = 1
      GROUP BY o.object_id ORDER BY o.object_name
    `).all(...ids);
    return { objects: rows };
  });

  app.get('/api/records', async (request, reply) => {
    const requested = request.query.objectId || 'all';
    let ids = accessibleObjectIds(request.currentUser);
    if (requested !== 'all') {
      const objectId = Number(requested);
      if (!canViewObject(request.currentUser, objectId)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Нет доступа к объекту.' });
      }
      ids = [objectId];
    }
    if (!ids.length) return { records: [], availableDates: [] };

    const date = request.query.date || null;
    const params = [...ids];
    let dateClause = '';
    if (date) {
      dateClause = ' AND report_date = ?';
      params.push(date);
    }
    const records = db.prepare(`
      SELECT v.*, i.imported_at AS updated_at, u.display_name AS updated_by
      FROM v_people_quality_all v
      LEFT JOIN imports i ON i.import_id = v.source_import_id
      LEFT JOIN users u ON u.user_id = i.uploaded_by
      WHERE v.object_id IN (${placeholders(ids)})${dateClause.replace('report_date', 'v.report_date')}
      ORDER BY report_date, object_name, source_row
    `).all(...params).map((row) => ({ ...row, quality_score: consistentQualityScore(row) }));
    const availableDates = db.prepare(`
      SELECT DISTINCT report_date AS date FROM people_quality_records
      WHERE object_id IN (${placeholders(ids)}) ORDER BY report_date
    `).all(...ids).map((row) => row.date);
    return { records, availableDates };
  });
}
