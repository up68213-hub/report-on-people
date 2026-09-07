import { db } from '../database/index.js';
import { accessibleObjectIds, requireRole } from '../auth/index.js';

const RECORD_COLUMNS = [
  'report_date', 'work_type', 'detail', 'contractor', 'quality_score',
  'plan_people', 'actual_people', 'cause', 'decision', 'work_quality_fact',
  'discipline_fact', 'people_count_fact', 'productivity_fact',
  'cleanliness_fact', 'source_import_id', 'source_sheet', 'source_row',
];

function placeholders(items) {
  return items.map(() => '?').join(', ');
}

function revertEntry(entryId, userId) {
  const entry = db.prepare("SELECT * FROM imports WHERE import_id = ? AND sha256 LIKE 'manual:%'").get(entryId);
  if (!entry) {
    const error = new Error('Запись истории не найдена.');
    error.statusCode = 404;
    throw error;
  }
  if (entry.status !== 'completed') {
    const error = new Error('Отменить можно только завершённое внесение.');
    error.statusCode = 409;
    throw error;
  }

  const changes = db.prepare('SELECT * FROM import_changes WHERE import_id = ? ORDER BY change_id DESC').all(entryId);
  const hasConflict = changes.some((change) => {
    const current = db.prepare('SELECT source_import_id FROM people_quality_records WHERE record_id = ?').get(change.record_id);
    return !current || current.source_import_id !== entryId;
  });
  if (hasConflict) {
    const error = new Error('Сначала отмените более новые внесения, изменившие те же строки.');
    error.statusCode = 409;
    error.code = 'NEWER_ENTRY_DEPENDENCY';
    throw error;
  }

  db.transaction(() => {
    for (const change of changes) {
      if (change.change_type === 'insert') {
        db.prepare('DELETE FROM people_quality_records WHERE record_id = ?').run(change.record_id);
        continue;
      }
      const previous = JSON.parse(change.previous_data_json);
      db.prepare(`
        UPDATE people_quality_records SET
          ${RECORD_COLUMNS.map((column) => `${column} = @${column}`).join(', ')},
          updated_at = CURRENT_TIMESTAMP
        WHERE record_id = @record_id
      `).run({
        record_id: change.record_id,
        ...Object.fromEntries(RECORD_COLUMNS.map((column) => [column, previous[column] ?? null])),
      });
    }
    db.prepare(`
      UPDATE imports SET status = 'reverted', reverted_at = CURRENT_TIMESTAMP, reverted_by = ?
      WHERE import_id = ?
    `).run(userId, entryId);
  })();

  return { entryId, reverted: true, affectedRecords: changes.length };
}

export async function historyRoutes(app) {
  app.get('/api/manual/history', {
    preHandler: requireRole('administrator'),
  }, async (request) => {
    const user = request.currentUser;
    const ids = accessibleObjectIds(user);
    if (!ids.length && user.role !== 'administrator') return { entries: [] };
    const condition = user.role === 'administrator'
      ? "i.sha256 LIKE 'manual:%'"
      : `i.sha256 LIKE 'manual:%' AND i.object_id IN (${placeholders(ids)})`;
    const entries = db.prepare(`
      SELECT i.import_id AS id, i.object_id AS objectId, o.object_name AS objectName,
        i.original_name AS title, i.status, i.inserted_count AS inserted,
        i.updated_count AS updated, i.imported_at AS createdAt, i.reverted_at AS revertedAt,
        u.display_name AS createdBy,
        CASE WHEN EXISTS (
          SELECT 1 FROM import_changes c
          LEFT JOIN people_quality_records r ON r.record_id = c.record_id
          WHERE c.import_id = i.import_id
            AND (r.record_id IS NULL OR r.source_import_id <> i.import_id)
        ) THEN 0 ELSE 1 END AS canRevert
      FROM imports i
      LEFT JOIN objects o ON o.object_id = i.object_id
      JOIN users u ON u.user_id = i.uploaded_by
      WHERE ${condition}
      ORDER BY i.imported_at DESC, i.import_id DESC
    `).all(...(user.role === 'administrator' ? [] : ids));
    return { entries: entries.map((entry) => ({ ...entry, canRevert: Boolean(entry.canRevert) })) };
  });

  app.post('/api/manual/history/:id/revert', {
    preHandler: requireRole('administrator'),
  }, async (request) => revertEntry(Number(request.params.id), request.currentUser.id));
}
