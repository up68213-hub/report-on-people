import { config } from '../config.js';

export async function sessionRoutes(app) {
  app.get('/api/session', async (request) => ({
    user: request.currentUser,
    authMode: config.authMode,
  }));
}
