import { test, expect, request as apiRequest } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const front = process.env.COLOMBA_PAGES_URL || 'http://127.0.0.1:4187/colomba-impostor/';
const api = process.env.COLOMBA_API_ORIGIN || 'http://127.0.0.1:4184';
async function apiState(page, code) {
  return page.evaluate(async ({ api, code }) => {
    const sessions = JSON.parse(localStorage.getItem('colomba.github.sessions') || '{}');
    const r = await fetch(`${api}/api/rooms/${code}`, { credentials: 'omit', headers: { Authorization: `Bearer ${sessions[code].token}`, 'X-Colomba-Session': 'token' } });
    return r.json();
  }, { api, code });
}
async function action(page, code, name, body = {}) {
  return page.evaluate(async ({ api, code, name, body }) => {
    const token = JSON.parse(localStorage.getItem('colomba.github.sessions'))[code].token;
    const headers = { Authorization: `Bearer ${token}`, 'X-Colomba-Session': 'token' };
    const s = await (await fetch(`${api}/api/rooms/${code}`, { credentials: 'omit', headers })).json();
    const r = await fetch(`${api}/api/rooms/${code}/${name}`, { method: 'POST', credentials: 'omit', headers: { ...headers, 'Content-Type': 'application/json', 'X-Colomba-Intent': 'play', 'X-CSRF-Token': s.me.csrf }, body: JSON.stringify({ revision: s.revision, roundId: s.round?.id, ballotId: s.round?.ballotId, turnIndex: s.round?.turnIndex, ...body }) });
    if (!r.ok) throw new Error(`API action failed: ${r.status}`);
    return r.json();
  }, { api, code, name, body });
}
test('GitHub Pages supports private cards, each player passing their turn, safe host races, votes and results', async ({ browser }) => {
  const contexts = [], pages = [], errors = [], requests = [];
  let code;
  try {
    for (let i = 0; i < 4; i++) {
      const c = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true }); contexts.push(c);
      const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
      p.on('request', r => { if (r.url().startsWith(api + '/api/')) requests.push(r); });
      pages.push(p);
    }
    const host = pages[0], names = ['QA Vale', 'QA Fran', 'QA Dani', 'QA Nico'];
    await host.goto(front); await expect(host.getByRole('heading', { name: 'El impostor de Colomba' })).toBeVisible();
    expect(await host.evaluate(() => document.fonts.check('600 16px Editorial'))).toBe(true);
    await host.getByRole('button', { name: 'Crear una sala', exact: true }).click();
    await host.getByLabel('Tu nombre', { exact: true }).fill(names[0]);
    await host.getByRole('button', { name: 'Crear sala', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Que se sume el grupo' })).toBeVisible();
    code = (await host.locator('.room-code').textContent()).trim();
    expect(host.url()).toBe(`${front}?sala=${code}`);
    const qr = host.getByRole('img', { name: `QR para entrar a la sala ${code}` });
    await expect(qr).toHaveAttribute('src', /data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    const first = await apiState(host, code); expect(first.shareUrl).toBe(`${front}?sala=${code}`); expect(first).not.toHaveProperty('sessionToken');
    const oldId = first.me.id;
    await host.reload(); await expect(host.getByRole('heading', { name: 'Estamos casi listos' })).toBeVisible(); expect((await apiState(host, code)).me.id).toBe(oldId);
    for (let i = 1; i < 4; i++) {
      await pages[i].goto(`${front}?sala=${code}`); await pages[i].getByRole('button', { name: 'Continuar', exact: true }).click();
      await pages[i].getByLabel('Tu nombre o apodo').fill(names[i]); await pages[i].getByRole('button', { name: 'Entrar al juego', exact: true }).click();
    }
    await expect(host.getByText('Participantes · 4')).toBeVisible();
    await host.getByRole('button', { name: 'Iniciar ronda', exact: true }).click();
    const roles = [], playerIds = [];
    for (let i = 0; i < 4; i++) {
      const p = pages[i]; await p.getByRole('button', { name: 'Ver mi tarjeta', exact: true }).click();
      await expect(p.getByRole('button', { name: 'Ocultar tarjeta', exact: true })).toBeVisible();
      const impostor = Boolean(await p.locator('.secret-card.impostor').count());
      roles.push({ impostor, concept: impostor ? null : await p.locator('.secret-card h2').textContent() });
      const s = await apiState(p, code); expect(s.round).not.toHaveProperty('concept'); expect(s.round).not.toHaveProperty('impostorId');
      playerIds.push(s.me.id);
      const storage = await p.evaluate(() => localStorage.getItem('colomba.github.sessions'));
      expect(storage).not.toContain('impostor'); if (!impostor) expect(storage).not.toContain(roles.at(-1).concept);
      await p.getByRole('button', { name: 'Ya la vi', exact: true }).click();
    }
    expect(roles.filter(r => r.impostor)).toHaveLength(1);
    expect(new Set(roles.filter(r => r.concept).map(r => r.concept)).size).toBe(1);
    // Force a real revision race after the click was sent but before it reaches D1.
    let injected = false;
    await host.route(`${api}/api/rooms/${code}/begin`, async route => {
      if (!injected) {
        injected = true;
        const late = await apiRequest.newContext({ baseURL: api });
        const joined = await late.post(`/api/rooms/${code}/join`, { headers: { Origin: new URL(front).origin, 'X-Colomba-Intent': 'play', 'X-Colomba-Session': 'token' }, data: { name: 'QA último segundo' } });
        expect(joined.status()).toBe(201); await late.dispose();
      }
      await route.continue();
    });
    await host.getByRole('button', { name: 'Comenzar las pistas', exact: true }).click();
    await expect.poll(async () => (await apiState(host, code)).phase).toBe('clues');
    expect(injected).toBe(true);
    let advanceRequests = 0;
    await host.route(`${api}/api/rooms/${code}/advance`, async route => {
      advanceRequests++;
      if (advanceRequests === 1) await action(host, code, 'advance');
      await route.continue();
    });
    await host.getByRole('button', { name: 'Controles del anfitrión', exact: true }).click();
    await host.getByRole('button', { name: 'Siguiente turno', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Siguiente turno', exact: true })).toBeEnabled();
    await expect.poll(async () => (await apiState(host, code)).round.turnIndex).toBe(1);
    expect(advanceRequests).toBe(2);
    await host.getByRole('button', { name: 'Volver a mi pantalla', exact: true }).click();
    await host.unroute(`${api}/api/rooms/${code}/advance`);
    let playerHostRace = false, participantPassed = false;
    for (;;) {
      const before = await apiState(host, code);
      if (before.phase !== 'clues') { expect(before.phase).toBe('discussion'); break; }
      const index = playerIds.indexOf(before.round.turn.playerId), player = pages[index];
      const pass = player.getByRole('button', { name: 'Pasar mi turno', exact: true });
      await expect(pass).toBeVisible();
      await expect(player.getByText(`Turno ${before.round.turnIndex + 1} de ${before.round.totalTurns}`, { exact: false })).toBeVisible();
      for (let i = 1; i < 4; i++) if (i !== index) await expect(pages[i].getByRole('button', { name: 'Pasar mi turno', exact: true })).toHaveCount(0);
      if (index !== 0 && !playerHostRace) {
        let intercepted = 0;
        await player.route(`${api}/api/rooms/${code}/skip-turn`, async route => {
          intercepted++;
          if (intercepted === 1) await action(host, code, 'advance');
          await route.continue();
        });
        await pass.click();
        await expect(pass).toHaveCount(0);
        expect(intercepted).toBe(1);
        await player.unroute(`${api}/api/rooms/${code}/skip-turn`);
        playerHostRace = true;
      } else {
        if (index !== 0) {
          await mkdir('evidence', { recursive: true });
          await player.screenshot({ path: 'evidence/pages-pass-turn.png', fullPage: true });
          expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          participantPassed = true;
        }
        await pass.click();
        await expect(pass).toHaveCount(0);
      }
      await expect.poll(async () => (await apiState(host, code)).round.turnIndex).toBe(before.round.turnIndex + 1);
    }
    expect(playerHostRace).toBe(true); expect(participantPassed).toBe(true);
    await action(host, code, 'voting');
    const imp = roles.findIndex(r => r.impostor);
    for (let i = 0; i < 4; i++) {
      const p = pages[i], target = i === imp ? (i + 1) % 4 : imp;
      await p.getByRole('button', { name: `Votar por ${names[target]}`, exact: true }).click();
      await p.getByRole('button', { name: 'Continuar', exact: true }).click();
      await p.getByRole('button', { name: 'Confirmar voto', exact: true }).click();
    }
    for (const p of pages) await expect(p.getByRole('heading', { name: '¡Lo descubrieron!' })).toBeVisible();
    const final = await apiState(host, code); expect(final.round.result.totalVotes).toBe(4);
    await mkdir('evidence', { recursive: true }); await host.screenshot({ path: 'evidence/pages-result.png', fullPage: true });
    expect((await contexts[0].cookies(api)).filter(c => c.name.startsWith('colomba_'))).toHaveLength(0);
    for (const request of requests) expect(await request.headerValue('cookie')).toBe(null);
    expect(errors).toEqual([]);
    await action(host, code, 'close', { confirm: true });
  } finally { await Promise.allSettled(contexts.map(c => c.close())); }
});

test('cross-origin preflights reject other sites and member tokens cannot take host control', async () => {
  const client = await apiRequest.newContext({ baseURL: api });
  const origin = new URL(front).origin;
  try {
    const pre = await client.fetch('/api/rooms', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-colomba-intent,x-colomba-session' } });
    expect(pre.status()).toBe(204); expect(pre.headers()['access-control-allow-origin']).toBe(origin); expect(pre.headers()['access-control-allow-credentials']).toBeUndefined();
    const rejected = await client.fetch('/api/rooms', { method: 'OPTIONS', headers: { Origin: 'https://attacker.test', 'Access-Control-Request-Method': 'POST' } });
    expect(rejected.status()).toBe(403); expect(rejected.headers()['access-control-allow-origin']).toBeUndefined();
    const headers = { Origin: origin, 'X-Colomba-Intent': 'play', 'X-Colomba-Session': 'token' };
    const created = await client.post('/api/rooms', { headers, data: { name: 'QA cross host' } }); expect(created.status()).toBe(201);
    const host = await created.json(); expect(host.sessionToken).toMatch(/^[a-f0-9]{64}$/); expect(created.headers()['set-cookie']).toBeUndefined();
    const path = `/api/rooms/${host.code}`;
    const joinedResponse = await client.post(`${path}/join`, { headers, data: { name: 'QA cross guest' } }); const guest = await joinedResponse.json();
    expect(guest.sessionToken).not.toBe(host.sessionToken);
    const read = await client.get(path, { headers: { ...headers, Authorization: `Bearer ${guest.sessionToken}` } }); const state = await read.json(); expect(state).not.toHaveProperty('sessionToken'); expect(state.me.id).toBe(guest.me.id);
    const denied = await client.post(`${path}/close`, { headers: { ...headers, Authorization: `Bearer ${guest.sessionToken}`, 'X-CSRF-Token': guest.me.csrf }, data: { revision: state.revision, confirm: true } }); expect(denied.status()).toBe(403);
    const badCsrf = await client.post(`${path}/close`, { headers: { ...headers, Authorization: `Bearer ${host.sessionToken}`, 'X-CSRF-Token': 'invalid' }, data: { revision: state.revision, confirm: true } }); expect(badCsrf.status()).toBe(403);
    const closed = await client.post(`${path}/close`, { headers: { ...headers, Authorization: `Bearer ${host.sessionToken}`, 'X-CSRF-Token': host.me.csrf }, data: { revision: state.revision, confirm: true } }); expect(closed.status()).toBe(200);
  } finally { await client.dispose(); }
});
