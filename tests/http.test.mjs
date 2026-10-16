import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/http.mjs';

async function fixture(t, options = {}) {
  const app = createApp({ port: 0, ...options }); await app.listen();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, body, session = {}, headers = {}) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: base, 'X-Colomba-Intent': 'play' } : {}), ...(session.cookie ? { Cookie: session.cookie } : {}), ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = r.headers.get('content-type') ?? '';
    const data = type.startsWith('application/json') ? await r.json() : await r.text();
    return { status: r.status, data, headers: r.headers };
  };
  const create = async name => {
    const r = await request('/api/rooms', { name }); assert.equal(r.status, 201);
    return { code: r.data.code, memberId: r.data.me.id, cookie: r.headers.get('set-cookie').split(';')[0], csrf: r.data.me.csrf };
  };
  const join = async (host, name) => {
    const r = await request(`/api/rooms/${host.code}/join`, { name }); assert.equal(r.status, 201);
    return { code: host.code, memberId: r.data.me.id, cookie: r.headers.get('set-cookie').split(';')[0], csrf: r.data.me.csrf };
  };
  const state = async who => (await request(`/api/rooms/${who.code}`, undefined, who)).data;
  const act = async (who, action, extra = {}) => { const s = await state(who); return request(`/api/rooms/${who.code}/${action}`, { revision: s.revision, roundId: s.round?.id, ballotId: s.round?.ballotId, ...extra }, who); };
  return { app, base, request, create, join, state, act };
}
test('API creates HttpOnly sessions, enforces origin and CSRF, and protects host operations', async t => {
  const f = await fixture(t), h = await f.create('Vale'), g = await f.join(h, 'Fran');
  const raw = await f.request('/api/rooms', { name: 'Otra' });
  assert.match(raw.headers.get('set-cookie'), /HttpOnly/); assert.match(raw.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await f.request(`/api/rooms/${h.code}`)).status, 401);
  assert.equal((await f.act(g, 'close', { confirm: true })).status, 403);
  assert.equal((await f.request(`/api/rooms/${h.code}/close`, { confirm: true }, { cookie: h.cookie })).status, 403);
  assert.equal((await f.request(`/api/rooms/${h.code}/close`, { confirm: true }, h, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request(`/api/rooms/${h.code}/close`, { confirm: true }, h, { 'X-Colomba-Intent': '' })).status, 403);
  assert.equal((await f.state(h)).phase, 'lobby');
});
test('API does not allow cross-room credentials or static reads of server, tests, database or traversal paths', async t => {
  const f = await fixture(t), h = await f.create('Vale'), other = await f.create('Otra');
  assert.equal((await f.request(`/api/rooms/${h.code}`, undefined, other)).status, 401);
  for (const path of ['/server/engine.mjs', '/data/colomba.sqlite', '/package.json', '/%2e%2e%2fserver%2fengine.mjs', '/tests/http.test.mjs']) assert.equal((await f.request(path)).status, 404);
  const page = await f.request('/'); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await f.request('/%ZZ')).status, 400);
});
test('24 concurrent participants keep every identity and receive live updates without exposing roles', { timeout: 10000 }, async t => {
  const f = await fixture(t), h = await f.create('Vale');
  const sessions = [h, ...await Promise.all(Array.from({ length: 23 }, (_, i) => f.join(h, `Persona ${i}`)))];
  assert.equal((await f.state(h)).members.length, 24);
  const streams = await Promise.all(sessions.map(p => fetch(`${f.base}/api/rooms/${h.code}/events`, { headers: { Cookie: p.cookie }, signal: AbortSignal.timeout(5000) })));
  try {
    for (const response of streams) assert.equal(response.status, 200);
    assert.equal((await f.state(h)).members.filter(p => p.connected).length, 24);
    assert.equal((await f.act(h, 'start')).status, 200);
    const states = await Promise.all(sessions.map(p => f.state(p)));
    assert.ok(states.every(s => s.phase === 'reveal' && s.round.playerCount === 24 && !JSON.stringify(s).includes('impostorId')));
  } finally { await Promise.allSettled(streams.map(r => r.body.cancel())); }
});
test('duplicate parallel start requests cannot redraw roles or create a second round', async t => {
  const f = await fixture(t), h = await f.create('Vale'); for (const n of ['Fran', 'Dani', 'Nico']) await f.join(h, n);
  const s = await f.state(h);
  const results = await Promise.all([1, 2].map(() => f.request(`/api/rooms/${h.code}/start`, { revision: s.revision }, h)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal((await f.state(h)).round.number, 1);
});
test('live events carry invalidations only; private cards and catalog stay isolated', async t => {
  const f = await fixture(t), h = await f.create('Vale');
  const guests = await Promise.all(['Fran', 'Dani', 'Nico'].map(n => f.join(h, n)));
  assert.equal((await f.act(h, 'start')).status, 200);
  const s = await f.state(h), cards = [];
  for (const p of [h, ...guests]) {
    const response = await f.request(`/api/rooms/${h.code}/card`, { roundId: s.round.id, memberId: h.memberId }, p);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); cards.push(response.data);
  }
  assert.equal(cards.filter(c => c.role === 'impostor').length, 1);
  const word = cards.find(c => c.concept).concept;
  for (const p of [h, ...guests]) assert.ok(!JSON.stringify(await f.state(p)).includes(word));
  assert.equal((await f.request(`/api/rooms/${h.code}/catalog`, undefined, h)).status, 409);
  assert.equal((await f.request(`/api/rooms/${h.code}/catalog`, undefined, guests[0])).status, 403);
  const abort = new AbortController();
  try {
    const response = await fetch(`${f.base}/api/rooms/${h.code}/events`, { headers: { Cookie: guests[0].cookie }, signal: abort.signal });
    assert.equal(response.status, 200); const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /changed/); assert.ok(!first.includes(word)); assert.ok(!first.includes('impostor'));
    await reader.cancel();
  } finally { abort.abort(); }
});
test('QR is a real generated SVG and invitation points to the listening server, without credentials', async t => {
  const f = await fixture(t), h = await f.create('Vale'), g = await f.join(h, 'Fran');
  const s = await f.state(h), invite = new URL(s.shareUrl);
  assert.equal(invite.searchParams.get('sala'), h.code); assert.equal(Number(invite.port), f.app.server.address().port); assert.equal(invite.username, ''); assert.equal(invite.searchParams.size, 1);
  const qr = await f.request(`/api/rooms/${h.code}/qr`, undefined, h);
  assert.equal(qr.status, 200); assert.match(qr.data, /<svg/); assert.match(qr.data, /<path/); assert.ok(!qr.data.includes('muestra'));
  assert.equal((await f.request(`/api/rooms/${h.code}/qr`, undefined, g)).status, 403);
  const landing = await fetch(s.shareUrl); assert.equal(landing.status, 200);
});
test('removed sessions are revoked and joining twice with the same session does not duplicate players', async t => {
  const f = await fixture(t), h = await f.create('Vale'), g = await f.join(h, 'Fran');
  const again = await f.request(`/api/rooms/${h.code}/join`, { name: 'Otro nombre' }, g);
  assert.equal(again.status, 200); assert.equal(again.data.me.id, g.memberId); assert.equal(again.data.members.length, 2);
  assert.equal((await f.act(h, 'remove', { memberId: g.memberId })).status, 200);
  assert.equal((await f.state(h)).members.length, 1);
  assert.equal((await f.request(`/api/rooms/${h.code}`, undefined, g)).status, 401);
});
test('request size, content type, malformed JSON and room creation rate are bounded', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/rooms', { name: 'Vale' }, {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.request('/api/rooms', { name: 'a'.repeat(70000) })).status, 413);
  const malformed = await fetch(f.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.base, 'X-Colomba-Intent': 'play' }, body: '{' }); assert.equal(malformed.status, 400);
  for (let i = 0; i < 7; i++) assert.equal((await f.request('/api/rooms', { name: `H${i}` })).status, 201);
  const limited = await f.request('/api/rooms', { name: 'Una más' }); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
});
