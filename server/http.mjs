import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { GameEngine, GameError } from './engine.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function localAddresses() {
  return Object.entries(networkInterfaces()).sort(([a], [b]) => (a === 'en0' ? -1 : b === 'en0' ? 1 : a.localeCompare(b))).flatMap(([, entries]) => (entries ?? []).filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address));
}
function safeEqual(a, b) { return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function cookieName(code) { return `colomba_${code}`; }
function cookie(req, code) {
  const name = `${cookieName(code)}=`;
  return (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(name))?.slice(name.length);
}
function sessionCookie(code, token) { return `${cookieName(code)}=${token}; Path=/api/rooms/${code}; HttpOnly; SameSite=Strict; Max-Age=86400`; }
function send(res, status, value, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}
async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new GameError(415, 'La solicitud debe enviarse como JSON.');
  if (Number(req.headers['content-length']) > 65536) throw new GameError(413, 'La solicitud es demasiado grande.');
  return new Promise((resolveBody, reject) => {
    let bytes = 0, raw = '', ended = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (ended) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 65536) { ended = true; reject(new GameError(413, 'La solicitud es demasiado grande.')); return; }
      raw += chunk;
    });
    req.on('end', () => {
      if (ended) return;
      try { const body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); resolveBody(body); }
      catch { reject(new GameError(400, 'No pudimos leer la solicitud.')); }
    });
    req.on('error', () => reject(new GameError(400, 'Se interrumpió la solicitud.')));
  });
}

export function createApp({ dbPath, now, rng, host = '0.0.0.0', port = 4173, rateLimit = true } = {}) {
  const engine = new GameEngine({ dbPath, now, rng });
  const streams = new Map(), limits = new Map();
  const addresses = localAddresses();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...addresses]);
  let actualPort = port;
  function urls() { return { local: `http://localhost:${actualPort}`, network: addresses.map(ip => `http://${ip}:${actualPort}`) }; }
  function isConnected(code, id) { return [...(streams.get(code) ?? [])].some(client => client.memberId === id && !client.res.destroyed); }
  function broadcast(code) {
    for (const client of streams.get(code) ?? []) if (!client.res.destroyed) client.res.write('data: {"changed":true}\n\n');
  }
  engine.on('change', broadcast);
  function snapshot(code, auth) {
    const state = engine.state(code, auth.member.id, id => isConnected(code, id));
    state.me.csrf = auth.csrf;
    const base = addresses.length ? urls().network[0] : urls().local;
    state.shareUrl = `${base}/?sala=${code}`;
    return state;
  }
  function limit(req, key, max, period) {
    if (!rateLimit) return;
    const at = Date.now(), k = `${req.socket.remoteAddress}:${key}`;
    const entry = limits.get(k);
    if (!entry || entry.until <= at) { limits.set(k, { n: 1, until: at + period }); return; }
    if (++entry.n > max) throw new GameError(429, 'Vas muy rápido. Espera un momento e inténtalo otra vez.', 'RATE_LIMIT');
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      let url, path;
      try { url = new URL(req.url, `http://${req.headers.host}`); path = decodeURIComponent(url.pathname); }
      catch { throw new GameError(400, 'La dirección no es válida.'); }
      if (!allowedHosts.has(url.hostname) || Number(url.port || 80) !== actualPort) throw new GameError(403, 'Abre la app desde su dirección local.');
      if (path === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, app: 'colomba' });
      if (path.startsWith('/api/')) {
        limit(req, 'api', 1200, 60000);
        if (req.method === 'POST') {
          if (req.headers.origin !== url.origin || req.headers['x-colomba-intent'] !== 'play') throw new GameError(403, 'Esta solicitud no viene de la app.', 'ORIGIN_REJECTED');
        }
        if (path === '/api/config' && req.method === 'GET') return send(res, 200, { urls: urls(), maxPlayers: 24, minPlayers: 4 });
        if (path === '/api/rooms' && req.method === 'POST') {
          limit(req, 'create', 10, 600000);
          const session = engine.create(await readBody(req));
          res.setHeader('Set-Cookie', sessionCookie(session.code, session.token));
          return send(res, 201, snapshot(session.code, { member: { id: session.memberId }, csrf: session.csrf }));
        }
        const match = /^\/api\/rooms\/([A-Z2-9]{6})(?:\/([a-z-]+))?$/.exec(path);
        if (!match) throw new GameError(404, 'No encontramos esta dirección.');
        const [, code, action] = match;
        if (action === 'info' && req.method === 'GET') { limit(req, 'lookup', 100, 600000); return send(res, 200, engine.info(code)); }
        if (action === 'join' && req.method === 'POST') {
          limit(req, 'join', 60, 600000);
          const body = await readBody(req);
          let existing;
          try { existing = engine.auth(code, cookie(req, code)); } catch (e) { if (e.status !== 401) throw e; }
          if (existing) return send(res, 200, snapshot(code, existing));
          const session = engine.join(code, body);
          res.setHeader('Set-Cookie', sessionCookie(code, session.token));
          return send(res, 201, snapshot(code, { member: { id: session.memberId }, csrf: session.csrf }));
        }
        const auth = engine.auth(code, cookie(req, code));
        if (!action && req.method === 'GET') return send(res, 200, snapshot(code, auth));
        if (action === 'catalog' && req.method === 'GET') return send(res, 200, engine.catalog(code, auth.member.id));
        if (action === 'qr' && req.method === 'GET') {
          if (!auth.member.isHost) throw new GameError(403, 'Solo el anfitrión puede abrir esta invitación.');
          const qr = await QRCode.toString(snapshot(code, auth).shareUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 3, width: 480, color: { dark: '#2F493FFF', light: '#F8F1E7FF' } });
          return send(res, 200, qr, 'image/svg+xml');
        }
        if (action === 'events' && req.method === 'GET') {
          const clients = streams.get(code) ?? new Set();
          if ([...clients].filter(c => c.memberId === auth.member.id).length >= 6) throw new GameError(429, 'Cierra otra pestaña de esta sala antes de continuar.');
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
          const client = { memberId: auth.member.id, res }; clients.add(client); streams.set(code, clients);
          res.write('retry: 1500\ndata: {"changed":true}\n\n'); broadcast(code);
          res.on('close', () => { clients.delete(client); if (!clients.size) streams.delete(code); broadcast(code); });
          return;
        }
        if (req.method === 'POST' && action) {
          if (!safeEqual(req.headers['x-csrf-token'], auth.csrf)) throw new GameError(403, 'Actualiza la sala antes de continuar.', 'CSRF_REJECTED');
          const body = await readBody(req);
          if (action === 'card') return send(res, 200, engine.privateCard(code, auth.member.id, body.roundId));
          engine.perform(code, auth.member.id, action, body);
          if (action === 'leave') {
            res.setHeader('Set-Cookie', `${cookieName(code)}=; Path=/api/rooms/${code}; HttpOnly; SameSite=Strict; Max-Age=0`);
            return send(res, 200, { left: true });
          }
          return send(res, 200, snapshot(code, auth));
        }
        throw new GameError(405, 'Esta acción no está disponible.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new GameError(405, 'Esta acción no está disponible.');
      const relative = path === '/' ? 'index.html' : path.slice(1);
      const target = resolve(publicDir, relative);
      if (!target.startsWith(resolve(publicDir) + sep) || !mime[extname(target)]) throw new GameError(404, 'No encontramos esta página.');
      const file = await stat(target).catch(() => null);
      if (!file?.isFile()) throw new GameError(404, 'No encontramos esta página.');
      res.writeHead(200, { 'Content-Type': mime[extname(target)], 'Cache-Control': path.startsWith('/fonts/') ? 'public, max-age=604800' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(target));
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const status = error instanceof GameError ? error.status : 500;
      if (status === 500) console.error('Error interno:', error.message);
      if (status === 413) res.setHeader('Connection', 'close');
      if (status === 429) res.setHeader('Retry-After', '60');
      send(res, status, { error: status === 500 ? 'No pudimos completar la acción. Inténtalo nuevamente.' : error.message, code: error.code ?? 'INTERNAL_ERROR' });
    }
  });
  server.headersTimeout = 15000; server.requestTimeout = 15000;
  const heartbeat = setInterval(() => {
    for (const clients of streams.values()) for (const c of clients) if (!c.res.destroyed) c.res.write(': seguimos aqui\n\n');
    for (const [k, entry] of limits) if (entry.until <= Date.now()) limits.delete(k);
    const removed = engine.cleanup();
    if (removed) for (const [code, clients] of streams) { try { engine.load(code); } catch { for (const c of clients) c.res.end(); } }
  }, 15000); heartbeat.unref();
  return {
    engine, server, urls,
    async listen() {
      await new Promise((ok, reject) => { server.once('error', reject); server.listen(port, host, ok); });
      actualPort = server.address().port; return urls();
    },
    async close() {
      clearInterval(heartbeat); engine.off('change', broadcast);
      for (const clients of streams.values()) for (const c of clients) c.res.end();
      await new Promise(ok => { server.close(ok); server.closeAllConnections(); });
      engine.close();
    },
  };
}
