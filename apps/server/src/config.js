import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

function resolveFromRoot(value, fallback) {
  return path.resolve(root, value || fallback);
}

export const config = {
  root,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  authMode: process.env.AUTH_MODE || 'dev',
  devUserId: Number(process.env.DEV_USER_ID || 1),
  databasePath: resolveFromRoot(process.env.DATABASE_PATH, 'data/report.sqlite'),
  webDistPath: path.resolve(root, 'apps/web/dist'),
  bitrix: {
    allowedHost: process.env.BITRIX_ALLOWED_HOST || '',
    clientId: process.env.BITRIX_CLIENT_ID || '',
    clientSecret: process.env.BITRIX_CLIENT_SECRET || '',
  },
};
