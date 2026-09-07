import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { authenticate } from './auth/index.js';
import { sessionRoutes } from './routes/session.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { historyRoutes } from './routes/history.js';
import { adminRoutes } from './routes/admin.js';
import { manualRoutes } from './routes/manual.js';
import { feedbackRoutes } from './routes/feedback.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: config.authMode === 'dev' ? true : false,
  credentials: true,
});
app.get('/api/health', async () => ({ status: 'ok' }));

app.addHook('preHandler', async (request, reply) => {
  if (request.url.startsWith('/api/') && request.url !== '/api/health') {
    return authenticate(request, reply);
  }
});

await app.register(sessionRoutes);
await app.register(dashboardRoutes);
await app.register(historyRoutes);
await app.register(adminRoutes);
await app.register(manualRoutes);
await app.register(feedbackRoutes);

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.code(statusCode).send({
    error: error.code || 'SERVER_ERROR',
    message: statusCode === 500 ? 'Внутренняя ошибка сервера.' : error.message,
  });
});

if (fs.existsSync(config.webDistPath)) {
  await app.register(fastifyStatic, { root: config.webDistPath });
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'NOT_FOUND', message: 'Маршрут не найден.' });
  });
}

await app.listen({ host: config.host, port: config.port });
