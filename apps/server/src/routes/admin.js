import { db } from '../database/index.js';
import { requireRole } from '../auth/index.js';
import { CAUSES, DECISIONS, WORK_TYPES } from '../manual/manual-report.js';

const ROLES = new Set(['administrator', 'project_manager', 'resource_manager', 'observer']);
const OBJECT_ROLES = new Set(['project_manager', 'observer']);
const DICTIONARY_CATEGORIES = new Set(['work_type', 'cause', 'decision', 'contractor', 'resource_measure']);
const RESOURCE_MEASURES = [
  'Переговоры с подрядчиком', 'Уведомление со сроком вывода', 'Претензия',
  'Удержание по договору', 'План корректирующих действий',
  'Перераспределение с другого объекта', 'Инициирован тендер',
  'Привлечён второй подрядчик', 'Ускорено оформление пропусков',
  'Замена подрядчика', 'Вопрос вынесен на штаб', 'Мера не требуется',
];

function ensureDictionaryValues(userId) {
  const insert = db.prepare(`
    INSERT INTO managed_dictionary_values (category, value, created_by)
    VALUES (?, ?, ?) ON CONFLICT(category, value) DO NOTHING
  `);
  WORK_TYPES.forEach((value) => insert.run('work_type', value, userId));
  CAUSES.forEach((value) => insert.run('cause', value, userId));
  DECISIONS.forEach((value) => insert.run('decision', value, userId));
  RESOURCE_MEASURES.forEach((value) => insert.run('resource_measure', value, userId));
  db.prepare("SELECT DISTINCT contractor AS value FROM people_quality_records WHERE trim(contractor) <> ''").all()
    .forEach(({ value }) => insert.run('contractor', value, userId));
  db.prepare("SELECT category, value FROM manual_dictionary_values WHERE category IN ('work_type', 'cause')").all()
    .forEach(({ category, value }) => insert.run(category, value, userId));
}

export async function adminRoutes(app) {
  const adminOnly = { preHandler: requireRole('administrator') };
  const seedUser = db.prepare("SELECT user_id FROM users WHERE global_role='administrator' ORDER BY user_id LIMIT 1").get();
  if (seedUser) ensureDictionaryValues(seedUser.user_id);

  app.get('/api/admin/users', adminOnly, async () => {
    const users = db.prepare(`
      SELECT user_id AS id, display_name AS name, email, global_role AS role,
        is_active AS isActive, bitrix_user_id AS bitrixUserId, last_login_at AS lastLoginAt
      FROM users ORDER BY display_name
    `).all();
    const access = db.prepare(`
      SELECT user_id AS userId, object_id AS objectId, object_role AS role
      FROM user_object_access ORDER BY user_id, object_id
    `).all();
    return { users: users.map((u) => ({ ...u, isActive: Boolean(u.isActive) })), access };
  });

  app.get('/api/admin/objects', adminOnly, async () => ({
    objects: db.prepare(`
      SELECT object_id AS id, object_name AS name, is_active AS isActive
      FROM objects ORDER BY object_name
    `).all().map((o) => ({ ...o, isActive: Boolean(o.isActive) })),
  }));

  app.get('/api/admin/access-requests', adminOnly, async () => ({ requests: db.prepare(`
    SELECT r.request_id AS id, r.user_id AS userId, r.object_id AS objectId,
      u.display_name AS userName, o.object_name AS objectName, r.created_at AS createdAt
    FROM object_access_requests r JOIN users u ON u.user_id=r.user_id JOIN objects o ON o.object_id=r.object_id
    WHERE r.status='pending' ORDER BY r.created_at
  `).all() }));

  app.patch('/api/admin/access-requests/:id', adminOnly, async (request, reply) => {
    const id = Number(request.params.id); const status = request.body?.status;
    if (!['approved', 'rejected'].includes(status)) return reply.code(400).send({ error: 'VALIDATION', message: 'Некорректное решение.' });
    const item = db.prepare("SELECT * FROM object_access_requests WHERE request_id=? AND status='pending'").get(id);
    if (!item) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Запрос уже обработан или не найден.' });
    const resolve = db.transaction(() => {
      if (status === 'approved') db.prepare(`INSERT INTO user_object_access (user_id, object_id, object_role) VALUES (?, ?, 'observer')
        ON CONFLICT(user_id, object_id) DO UPDATE SET object_role=excluded.object_role`).run(item.user_id, item.object_id);
      db.prepare("UPDATE object_access_requests SET status=?, resolved_at=CURRENT_TIMESTAMP, resolved_by=? WHERE request_id=?").run(status, request.currentUser.id, id);
    }); resolve();
    return { updated: true };
  });

  app.post('/api/admin/objects', adminOnly, async (request, reply) => {
    const name = String(request.body?.name || '').trim();
    if (!name) return reply.code(400).send({ error: 'VALIDATION', message: 'Укажите название объекта.' });
    try {
      const result = db.prepare('INSERT INTO objects (object_name) VALUES (?)').run(name);
      return reply.code(201).send({ id: Number(result.lastInsertRowid), name });
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
        return reply.code(409).send({ error: 'DUPLICATE', message: 'Такой объект уже существует.' });
      }
      throw error;
    }
  });

  app.patch('/api/admin/objects/:id', adminOnly, async (request, reply) => {
    const objectId = Number(request.params.id);
    const current = db.prepare('SELECT * FROM objects WHERE object_id = ?').get(objectId);
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Объект не найден.' });
    const name = String(request.body?.name ?? current.object_name).trim();
    const isActive = request.body?.isActive === undefined ? current.is_active : Number(Boolean(request.body.isActive));
    if (!name) return reply.code(400).send({ error: 'VALIDATION', message: 'Укажите название объекта.' });
    try {
      db.prepare('UPDATE objects SET object_name = ?, is_active = ? WHERE object_id = ?').run(name, isActive, objectId);
      return { updated: true };
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) return reply.code(409).send({ error: 'DUPLICATE', message: 'Такой объект уже существует.' });
      throw error;
    }
  });

  app.get('/api/admin/dictionaries', adminOnly, async (request) => {
    ensureDictionaryValues(request.currentUser.id);
    return { values: db.prepare(`
      SELECT dictionary_id AS id, category, value, is_active AS isActive
      FROM managed_dictionary_values ORDER BY category, value
    `).all().map((item) => ({ ...item, isActive: Boolean(item.isActive) })) };
  });

  app.post('/api/admin/dictionaries', adminOnly, async (request, reply) => {
    const category = String(request.body?.category || '');
    const value = String(request.body?.value || '').trim();
    if (!DICTIONARY_CATEGORIES.has(category) || !value) return reply.code(400).send({ error: 'VALIDATION', message: 'Выберите список и укажите значение.' });
    try {
      const result = db.prepare('INSERT INTO managed_dictionary_values (category, value, created_by) VALUES (?, ?, ?)').run(category, value, request.currentUser.id);
      return reply.code(201).send({ id: Number(result.lastInsertRowid), category, value });
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) return reply.code(409).send({ error: 'DUPLICATE', message: 'Такое значение уже есть в списке.' });
      throw error;
    }
  });

  app.patch('/api/admin/dictionaries/:id', adminOnly, async (request, reply) => {
    const id = Number(request.params.id);
    const current = db.prepare('SELECT * FROM managed_dictionary_values WHERE dictionary_id = ?').get(id);
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Значение справочника не найдено.' });
    const value = String(request.body?.value ?? current.value).trim();
    const isActive = request.body?.isActive === undefined ? current.is_active : Number(Boolean(request.body.isActive));
    if (!value) return reply.code(400).send({ error: 'VALIDATION', message: 'Значение не может быть пустым.' });
    db.prepare('UPDATE managed_dictionary_values SET value = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE dictionary_id = ?').run(value, isActive, id);
    return { updated: true };
  });

  app.patch('/api/admin/users/:id', adminOnly, async (request, reply) => {
    const userId = Number(request.params.id);
    const current = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден.' });

    const role = request.body?.role ?? current.global_role;
    const name = String(request.body?.name ?? current.display_name).trim();
    const isActive = request.body?.isActive === undefined ? current.is_active : Number(Boolean(request.body.isActive));
    if (!ROLES.has(role) || !name) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Некорректные данные пользователя.' });
    }
    if (userId === request.currentUser.id && (!isActive || role !== 'administrator')) {
      return reply.code(409).send({ error: 'SELF_LOCKOUT', message: 'Нельзя отключить себя или снять собственную роль администратора.' });
    }
    db.prepare(`
      UPDATE users SET display_name = ?, global_role = ?, is_active = ? WHERE user_id = ?
    `).run(name, role, isActive, userId);
    return { updated: true };
  });

  app.put('/api/admin/users/:userId/access/:objectId', adminOnly, async (request, reply) => {
    const userId = Number(request.params.userId);
    const objectId = Number(request.params.objectId);
    const role = request.body?.role;
    if (role === null || role === 'none') {
      db.prepare('DELETE FROM user_object_access WHERE user_id = ? AND object_id = ?').run(userId, objectId);
      return { updated: true };
    }
    if (!OBJECT_ROLES.has(role)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Некорректная роль на объекте.' });
    }
    db.prepare(`
      INSERT INTO user_object_access (user_id, object_id, object_role)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, object_id) DO UPDATE SET object_role = excluded.object_role
    `).run(userId, objectId, role);
    return { updated: true };
  });
}
