import { config } from '../config.js';
import { db } from '../database/index.js';

export async function sessionRoutes(app) {
  app.get('/api/session', async (request) => ({
    user: request.currentUser,
    authMode: config.authMode,
    devUsers: config.authMode === 'dev' ? db.prepare('SELECT user_id AS id, display_name AS name, global_role AS role FROM users WHERE is_active = 1 ORDER BY user_id').all() : undefined,
  }));
}
