import { db } from '../database/index.js';
import { config } from '../config.js';

function publicUser(row) {
  return {
    id: row.user_id,
    bitrixUserId: row.bitrix_user_id,
    name: row.display_name,
    email: row.email,
    role: row.global_role,
    isActive: Boolean(row.is_active),
  };
}

function devIdentity(request) {
  const requested = Number(request.headers['x-dev-user-id'] || config.devUserId);
  return Number.isInteger(requested) && requested > 0 ? requested : config.devUserId;
}

export async function authenticate(request, reply) {
  if (config.authMode !== 'dev') {
    return reply.code(501).send({
      error: 'BITRIX_AUTH_NOT_CONFIGURED',
      message: 'Авторизация Bitrix24 будет доступна после настройки портала.',
    });
  }

  const userId = devIdentity(request);
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!row || !row.is_active) {
    return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Пользователь не найден или отключён.' });
  }

  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(userId);
  request.currentUser = publicUser(row);
}

export function requireRole(...roles) {
  return async function roleGuard(request, reply) {
    if (!request.currentUser || !roles.includes(request.currentUser.role)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Недостаточно прав.' });
    }
  };
}

export function accessibleObjectIds(user) {
  if (user.role === 'administrator' || user.role === 'resource_manager') {
    return db.prepare('SELECT object_id FROM objects WHERE is_active = 1').all().map((x) => x.object_id);
  }
  return db.prepare(`
    SELECT o.object_id
    FROM user_object_access a
    JOIN objects o ON o.object_id = a.object_id
    WHERE a.user_id = ? AND o.is_active = 1
  `).all(user.id).map((x) => x.object_id);
}

export function canViewObject(user, objectId) {
  if (user.role === 'administrator' || user.role === 'resource_manager') return true;
  return Boolean(db.prepare(`
    SELECT 1 FROM user_object_access
    WHERE user_id = ? AND object_id = ?
  `).get(user.id, objectId));
}

export function canEditObject(user, objectId) {
  if (user.role === 'administrator') return true;
  return Boolean(db.prepare(`
    SELECT 1 FROM user_object_access
    WHERE user_id = ? AND object_id = ? AND object_role = 'project_manager'
  `).get(user.id, objectId));
}
