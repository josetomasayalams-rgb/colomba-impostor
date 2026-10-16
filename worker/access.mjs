export function frontendUrl(env, requestUrl) {
  const url = new URL(env.FRONTEND_URL || `${requestUrl.origin}/`);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new Error('Invalid FRONTEND_URL');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
export function allowedOrigin(request, env) {
  const origin = request.headers.get('origin'), url = new URL(request.url);
  return !origin || origin === url.origin || origin === frontendUrl(env, url).origin;
}
export function bearerMode(request, env) {
  const origin = request.headers.get('origin');
  return Boolean(origin && allowedOrigin(request, env) && request.headers.get('x-colomba-session') === 'token');
}
export function sessionToken(request, code) {
  const auth = request.headers.get('authorization');
  if (auth !== null) return /^Bearer ([a-f0-9]{64})$/.exec(auth)?.[1];
  const key = `colomba_${code}=`;
  return (request.headers.get('cookie') ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(key))?.slice(key.length);
}
export function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigin(request, env)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Colomba-Intent, X-Colomba-Session, X-CSRF-Token', 'Access-Control-Max-Age': '600' };
}
export function validPreflight(request) {
  const method = request.headers.get('access-control-request-method');
  const allowed = new Set(['authorization', 'content-type', 'x-colomba-intent', 'x-colomba-session', 'x-csrf-token']);
  const headers = (request.headers.get('access-control-request-headers') || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  return ['GET', 'POST'].includes(method) && headers.every(x => allowed.has(x));
}
