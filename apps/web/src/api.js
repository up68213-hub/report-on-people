const DEV_USER_KEY = 'people-report-dev-user-id';

export function getDevUserId() {
  return localStorage.getItem(DEV_USER_KEY) || import.meta.env.VITE_DEV_USER_ID || '1';
}

export function setDevUserId(id) {
  localStorage.setItem(DEV_USER_KEY, String(id));
  window.location.reload();
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-dev-user-id', getDevUserId());
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : await response.blob();
  if (!response.ok) {
    const error = new Error(body?.message || `Ошибка HTTP ${response.status}`);
    error.code = body?.error;
    error.status = response.status;
    error.details = body?.errors || [];
    throw error;
  }
  return body;
}
