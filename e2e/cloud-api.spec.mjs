import { test, expect, request as makeRequest } from '@playwright/test';
const root = process.env.COLOMBA_TEST_URL || 'http://127.0.0.1:4184';
test.skip(!process.env.CLOUD_TEST, 'Cloud integration suite runs against the D1 Worker.');
async function client() { return makeRequest.newContext({ baseURL: root }); }
async function post(c, path, body, csrf, extra = {}) {
  return c.post(path, { headers: { Origin: root, 'X-Colomba-Intent': 'play', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...extra }, data: body });
}
async function good(response) { expect(response.ok(), await response.text()).toBe(true); return response.json(); }

test('D1 retains 24 concurrent identities, cards, readiness and simultaneous votes without lost writes', async () => {
  const clients = await Promise.all(Array.from({ length: 25 }, client));
  try {
    const host = clients[0];
    let state = await good(await post(host, '/api/rooms', { name: 'QA anfitrión', settings: { vueltas: 1, seconds: 0 } }));
    const code = state.code, path = `/api/rooms/${code}`, csrf = [state.me.csrf];
    const joined = await Promise.all(clients.slice(1, 24).map((c, i) => post(c, `${path}/join`, { name: `QA persona ${i + 1}` }).then(good)));
    csrf.push(...joined.map(s => s.me.csrf));
    state = await good(await host.get(path));
    expect(state.members).toHaveLength(24);
    expect(new Set(state.members.map(m => m.id)).size).toBe(24);
    const full = await post(clients[24], `${path}/join`, { name: 'QA extra' }); expect(full.status()).toBe(409);
    const startBody = { revision: state.revision };
    const starts = await Promise.all([post(host, `${path}/start`, startBody, csrf[0]), post(host, `${path}/start`, startBody, csrf[0])]);
    expect(starts.map(r => r.status()).sort()).toEqual([200, 409]);
    state = await good(await host.get(path)); const roundId = state.round.id;
    const cards = await Promise.all(clients.slice(0, 24).map((c, i) => post(c, `${path}/card`, { roundId }, csrf[i]).then(good)));
    expect(cards.filter(c => c.role === 'impostor')).toHaveLength(1);
    expect(new Set(cards.filter(c => c.role === 'player').map(c => c.concept)).size).toBe(1);
    const impostorIndex = cards.findIndex(c => c.role === 'impostor');
    await Promise.all(clients.slice(0, 24).map((c, i) => post(c, `${path}/ready`, { roundId }, csrf[i]).then(good)));
    state = await good(await host.get(path)); expect(state.round.readyCount).toBe(24);
    expect(state).not.toHaveProperty('impostorId'); expect(state.round).not.toHaveProperty('concept');
    async function action(action, body = {}) {
      state = await good(await host.get(path));
      return good(await post(host, `${path}/${action}`, { revision: state.revision, roundId, ...body }, csrf[0]));
    }
    await action('begin'); await action('discussion', { confirm: true }); state = await action('voting');
    const playerIds = [state.me.id, ...joined.map(s => s.me.id)], impostor = playerIds[impostorIndex];
    const votes = await Promise.all(clients.slice(0, 24).map((c, i) => post(c, `${path}/vote`, { roundId, ballotId: 1, targetId: i === impostorIndex ? playerIds[(i + 1) % 24] : impostor }, csrf[i]).then(good)));
    expect(votes).toHaveLength(24);
    state = await good(await host.get(path));
    expect(state.phase).toBe('results'); expect(state.round.result.winner).toBe('group'); expect(state.round.result.totalVotes).toBe(24);
    expect(state.round.result.tallies[impostor]).toBe(23);
    await action('close', { confirm: true });
    expect((await good(await clients[23].get(path))).phase).toBe('closed');
  } finally { await Promise.all(clients.map(c => c.dispose())); }
});

test('cloud sessions stay private, require origin and CSRF, and never serve backend files', async () => {
  const host = await client(), guest = await client();
  try {
    const hostile = await post(host, '/api/rooms', { name: 'Intruso' }, undefined, { Origin: 'https://example.com' }); expect(hostile.status()).toBe(403);
    const created = await post(host, '/api/rooms', { name: 'QA seguridad' }); const state = await good(created);
    const cookie = created.headers()['set-cookie']; expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
    if (root.startsWith('https:')) expect(cookie).toContain('Secure');
    const path = `/api/rooms/${state.code}`;
    expect((await guest.get(path)).status()).toBe(401);
    expect((await post(host, `${path}/close`, { revision: state.revision, confirm: true }, 'wrong-token')).status()).toBe(403);
    const joined = await good(await post(guest, `${path}/join`, { name: 'QA invitada' }));
    expect((await post(guest, `${path}/close`, { revision: joined.revision, confirm: true }, joined.me.csrf)).status()).toBe(403);
    const twice = await good(await post(guest, `${path}/join`, { name: 'Otro nombre' })); expect(twice.me.id).toBe(joined.me.id); expect(twice.members).toHaveLength(2);
    for (const file of ['/server/engine-core.mjs', '/worker/index.js', '/.openai/hosting.json', '/package.json', '/data/colomba.sqlite']) expect((await host.get(file)).status()).toBe(404);
    expect((await host.get(`${path}/qr`)).headers()['content-type']).toContain('image/svg+xml');
    const persisted = await makeRequest.newContext({ baseURL: root, storageState: await host.storageState() });
    expect((await good(await persisted.get(path))).me.id).toBe(state.me.id); await persisted.dispose();
    const current = await good(await host.get(path)); await good(await post(host, `${path}/close`, { revision: current.revision, confirm: true }, current.me.csrf));
  } finally { await host.dispose(); await guest.dispose(); }
});
