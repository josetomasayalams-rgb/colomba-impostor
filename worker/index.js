import { GameEngineCore, GameError } from '../server/engine-core.mjs';
import { RoomStore } from './store.mjs';
import { hash } from '../server/portable.mjs';
import QR from 'qrcode/lib/core/qrcode.js';
import SVG from 'qrcode/lib/renderer/svg-tag.js';
import { assets } from './assets.generated.mjs';
import { allowedOrigin, bearerMode, sessionToken as tokenOf, corsHeaders, validPreflight, frontendUrl } from './access.mjs';

const security = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Strict-Transport-Security': 'max-age=31536000',
};
function response(value, status = 200, headers = {}) {
  return new Response(value === null || typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value), {
    status, headers: { ...security, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
function cookie(code, token, secure) { return `colomba_${code}=${token}; Path=/api/rooms/${code}; HttpOnly; SameSite=Strict; Max-Age=${token ? 86400 : 0}${secure ? '; Secure' : ''}`; }
function equal(a, b) { if (typeof a !== 'string' || typeof b !== 'string') return false; const ah = hash(a), bh = hash(b); let result = 0; for (let i = 0; i < ah.length; i++) result |= ah.charCodeAt(i) ^ bh.charCodeAt(i); return result === 0; }
async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new GameError(415, 'La solicitud debe enviarse como JSON.');
  if (Number(request.headers.get('content-length')) > 65536) throw new GameError(413, 'La solicitud es demasiado grande.');
  const reader = request.body?.getReader(); let raw = '', bytes = 0; const decoder = new TextDecoder();
  if (reader) try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 65536) { await reader.cancel(); throw new GameError(413, 'La solicitud es demasiado grande.'); } raw += decoder.decode(value, { stream: true }); } raw += decoder.decode(); } finally { reader.releaseLock(); }
  try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new GameError(400, 'No pudimos leer la solicitud.'); }
}
async function rate(db, request, category, max, period) {
  // CF-Connecting-IP is set by the hosting edge; client-supplied forwarding headers are ignored.
  const key = `${category}:${hash(request.headers.get('cf-connecting-ip') ?? 'local-preview')}`, now = Date.now();
  const row = await db.prepare(`INSERT INTO limits(key, n, until) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET n = CASE WHEN until <= ? THEN 1 ELSE n + 1 END,
    until = CASE WHEN until <= ? THEN excluded.until ELSE until END RETURNING n`).bind(key, now + period, now, now).first();
  if (row.n > max) throw new GameError(429, 'Vas muy rápido. Espera un momento e inténtalo otra vez.', 'RATE_LIMIT');
}
function snapshot(engine, code, auth, origin, connected) {
  const state = engine.state(code, auth.member.id, id => connected.has(id));
  state.me.csrf = auth.csrf; state.shareUrl = `${origin}?sala=${code}`; state.transport = 'poll';
  return state;
}
async function presence(db, code, id, now) {
  await db.prepare(`INSERT INTO presence(code, member_id, last_seen) VALUES (?, ?, ?)
    ON CONFLICT(code, member_id) DO UPDATE SET last_seen = excluded.last_seen WHERE last_seen < ?`).bind(code, id, now, now - 12000).run();
  const rows = await db.prepare('SELECT member_id FROM presence WHERE code = ? AND last_seen > ?').bind(code, now - 40000).all();
  return new Set(rows.results.map(row => row.member_id));
}
async function createRoom(db, body, origin, secure, tokenMode) {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM rooms WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM limits WHERE until <= ?').bind(now),
    db.prepare('DELETE FROM presence WHERE last_seen < ?').bind(now - 120000),
  ]);
  for (let attempt = 0; attempt < 5; attempt++) {
    const store = new RoomStore(), engine = new GameEngineCore({ store, recover: false });
    const session = engine.create(body), row = store.record(session.code);
    const result = await db.prepare(`INSERT OR IGNORE INTO rooms(code, data, sessions, expires_at, version)
      SELECT ?, ?, ?, ?, 1 WHERE (SELECT count(*) FROM rooms) < 1000`).bind(session.code, row.data, row.sessions, row.expires_at).run();
    if (!result.meta.changes) {
      const count = await db.prepare('SELECT count(*) AS n FROM rooms').first();
      if (count.n >= 1000) throw new GameError(503, 'Hay muchas salas abiertas. Inténtalo más tarde.');
      continue;
    }
    const connected = await presence(db, session.code, session.memberId, now);
    const state = snapshot(engine, session.code, { member: { id: session.memberId }, csrf: session.csrf }, origin, connected);
    if (tokenMode) state.sessionToken = session.token;
    return response(state, 201, tokenMode ? {} : { 'Set-Cookie': cookie(session.code, session.token, secure) });
  }
  throw new GameError(503, 'No pudimos crear la sala. Inténtalo nuevamente.');
}
async function roomRequest(request, db, code, action, body, url, env) {
  // A single conditional UPDATE commits room state and token hashes together.
  // Conflicts reload the authoritative row and revalidate all permissions and rules.
  for (let attempt = 0; attempt < 40; attempt++) {
    const row = await db.prepare('SELECT data, sessions, expires_at, version FROM rooms WHERE code = ?').bind(code).first();
    const store = new RoomStore(code, row), engine = new GameEngineCore({ store, recover: false });
    if (action === 'info' && request.method === 'GET') return response(engine.info(code));
    let auth, session, value, left = false;
    if (action === 'join' && request.method === 'POST') {
      try { auth = engine.auth(code, tokenOf(request, code)); } catch (e) { if (e.status !== 401) throw e; }
      if (!auth) { session = engine.join(code, body); auth = { member: { id: session.memberId }, csrf: session.csrf }; }
    } else {
      auth = engine.auth(code, tokenOf(request, code));
      if (request.method === 'POST' && action) {
        if (!equal(request.headers.get('x-csrf-token'), auth.csrf)) throw new GameError(403, 'Actualiza la sala antes de continuar.', 'CSRF_REJECTED');
        if (action === 'card') value = engine.privateCard(code, auth.member.id, body.roundId);
        else { engine.perform(code, auth.member.id, action, body); left = action === 'leave'; }
      } else if (request.method !== 'GET' || ![undefined, 'catalog', 'qr'].includes(action)) throw new GameError(405, 'Esta acción no está disponible.');
    }
    if (store.dirty) {
      const next = store.record(code);
      const result = await db.prepare('UPDATE rooms SET data = ?, sessions = ?, expires_at = ?, version = version + 1 WHERE code = ? AND version = ?').bind(next.data, next.sessions, next.expires_at, code, row.version).run();
      if (!result.meta.changes) {
        await new Promise(resolve => setTimeout(resolve, Math.min(100, 5 + attempt * 4) + Math.floor(Math.random() * 30)));
        continue;
      }
    }
    const tokenMode = bearerMode(request, env);
    const headers = session && !tokenMode ? { 'Set-Cookie': cookie(code, session.token, url.protocol === 'https:') } : {};
    if (left) {
      await db.prepare('DELETE FROM presence WHERE code = ? AND member_id = ?').bind(code, auth.member.id).run();
      return response({ left: true }, 200, tokenMode ? {} : { 'Set-Cookie': cookie(code, '', url.protocol === 'https:') });
    }
    if (value) return response(value);
    if (action === 'catalog') return response(engine.catalog(code, auth.member.id));
    const connected = await presence(db, code, auth.member.id, Date.now());
    const state = snapshot(engine, code, auth, frontendUrl(env, url).href, connected);
    if (session && tokenMode) state.sessionToken = session.token;
    if (action === 'qr') {
      if (!state.me.isHost) throw new GameError(403, 'Solo el anfitrión puede abrir esta invitación.');
      const qr = SVG.render(QR.create(state.shareUrl, { errorCorrectionLevel: 'M' }), { margin: 3, width: 480, color: { dark: '#2F493FFF', light: '#F8F1E7FF' } });
      return response(qr, 200, { 'Content-Type': 'image/svg+xml' });
    }
    return response(state, session ? 201 : 200, headers);
  }
  throw new GameError(409, 'La sala está recibiendo muchas acciones. Vuelve a intentarlo.', 'BUSY_ROOM');
}
const handler = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url), path = decodeURIComponent(url.pathname);
      if (path === '/api/health' && request.method === 'GET') {
        if (!env.DB) throw new Error('Database binding unavailable');
        await env.DB.prepare('SELECT code FROM rooms LIMIT 1').first();
        return response({ ok: true, app: 'colomba', hosting: 'cloud', version: '1.2.0' });
      }
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(request.method)) throw new GameError(405, 'Esta acción no está disponible.');
        const asset = assets[path === '/' ? '/index.html' : path];
        if (!asset) throw new GameError(404, 'No encontramos esta página.');
        const bytes = Uint8Array.from(atob(asset.data), c => c.charCodeAt(0));
        return response(request.method === 'HEAD' ? null : bytes, 200, { 'Content-Type': asset.type, 'Cache-Control': path.startsWith('/fonts/') ? 'public, max-age=604800' : 'no-cache' });
      }
      if (!env.DB) throw new Error('Database binding unavailable');
      const db = typeof env.DB.withSession === 'function' ? env.DB.withSession('first-primary') : env.DB;
      let body;
      if (request.method === 'POST') {
        if (!request.headers.get('origin') || !allowedOrigin(request, env) || request.headers.get('x-colomba-intent') !== 'play') throw new GameError(403, 'Esta solicitud no viene de la app.', 'ORIGIN_REJECTED');
        body = await readBody(request);
        await rate(db, request, 'actions', 600, 60000);
      }
      if (path === '/api/config' && request.method === 'GET') return response({ urls: { local: url.origin, network: [] }, hosting: 'cloud', maxPlayers: 24, minPlayers: 4 });
      if (path === '/api/rooms' && request.method === 'POST') { await rate(db, request, 'create', 10, 600000); return await createRoom(db, body, frontendUrl(env, url).href, url.protocol === 'https:', bearerMode(request, env)); }
      const match = /^\/api\/rooms\/([A-Z2-9]{6})(?:\/([a-z-]+))?$/.exec(path);
      if (!match) throw new GameError(404, 'No encontramos esta dirección.');
      const [, code, action] = match;
      if (action === 'join' && request.method === 'POST') await rate(db, request, 'join', 100, 600000);
      if (action === 'info' && request.method === 'GET') await rate(db, request, 'lookup', 150, 600000);
      return await roomRequest(request, db, code, action, body, url, env);
    } catch (error) {
      const status = error instanceof GameError ? error.status : 500;
      if (status === 500) console.error('Cloud request failed:', error.message);
      return response({ error: status === 500 ? 'No pudimos completar la acción. Inténtalo nuevamente.' : error.message, code: error.code ?? 'INTERNAL_ERROR' }, status, status === 429 ? { 'Retry-After': '60' } : {});
    }
  },
};

export default {
  async fetch(request, env) {
    const isApi = new URL(request.url).pathname.startsWith('/api/');
    try {
      if (isApi && !allowedOrigin(request, env)) return response({ error: 'Esta solicitud no viene de la app.', code: 'ORIGIN_REJECTED' }, 403);
      if (isApi && request.method === 'OPTIONS') return response(null, validPreflight(request) ? 204 : 403, corsHeaders(request, env));
      const result = await handler.fetch(request, env);
      if (!isApi) return result;
      const headers = new Headers(result.headers);
      for (const [name, value] of Object.entries(corsHeaders(request, env))) headers.set(name, value);
      return new Response(result.body, { status: result.status, headers });
    } catch (error) {
      console.error('API policy failed:', error.message);
      return response({ error: 'No pudimos completar la acción. Inténtalo nuevamente.', code: 'INTERNAL_ERROR' }, 500);
    }
  },
};
