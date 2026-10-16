import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { createApp } from '../server/http.mjs';

const root = process.env.COLOMBA_TEST_URL || 'http://127.0.0.1:4183';
const screenshot = async (page, name) => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: `evidence/${name}.png`, fullPage: true }); };
async function state(page, code) { return (await page.request.get(`/api/rooms/${code}`)).json(); }
async function join(page, name, code) {
  await page.goto(`${root}/?sala=${code}`);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Tu nombre o apodo').fill(name);
  await page.getByRole('button', { name: 'Entrar al juego', exact: true }).click();
}
async function seeCard(page) {
  await page.getByRole('button', { name: 'Ver mi tarjeta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ocultar tarjeta', exact: true })).toBeVisible();
  const role = await page.locator('.secret-card.impostor').count() ? 'impostor' : 'player';
  const concept = role === 'player' ? await page.locator('.secret-card h2').textContent() : null;
  await page.getByRole('button', { name: 'Ya la vi', exact: true }).click();
  return { role, concept };
}
async function apiPost(page, base, path, body, csrf) {
  const response = await page.request.post(path, { headers: { Origin: base, 'X-Colomba-Intent': 'play', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, data: body });
  expect(response.ok()).toBe(true); return response.json();
}
async function apiAction(page, base, code, action, body = {}) {
  const s = await state(page, code);
  return apiPost(page, base, `/api/rooms/${code}/${action}`, { revision: s.revision, roundId: s.round?.id, ballotId: s.round?.ballotId, ...body }, s.me.csrf);
}
test.beforeAll(async () => { await mkdir('evidence', { recursive: true }); });

test('complete mobile game with independent sessions, private cards, reconnection, votes and a late arrival', async ({ browser }) => {
  const contexts = [], pages = [], errors = [];
  try {
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, baseURL: root }); contexts.push(context);
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); pages.push(page);
    }
    const [host, fran, dani, nico, late] = pages;
    await host.goto(root); await screenshot(host, '01_inicio_movil');
    await host.getByRole('button', { name: 'Crear una sala', exact: true }).click();
    await host.getByLabel('Tu nombre', { exact: true }).fill('Vale');
    await host.getByRole('button', { name: 'Crear sala', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Que se sume el grupo' })).toBeVisible();
    const code = (await host.locator('.room-code').textContent()).trim();
    await screenshot(host, '02_invitacion_qr');
    await join(fran, 'Fran', code); await join(dani, 'Dani', code); await join(nico, 'Nico', code);
    await host.getByRole('button', { name: /Ver participantes/ }).click();
    await expect(host.getByText('Participantes · 4')).toBeVisible();
    await screenshot(host, '03_sala_anfitrion');
    await screenshot(fran, '04_sala_invitado');
    await host.getByRole('button', { name: 'Iniciar ronda', exact: true }).click();
    for (const page of pages.slice(0, 4)) await expect(page.getByRole('heading', { name: 'Tu secreto está listo' })).toBeVisible();
    await screenshot(host, '05_tarjeta_oculta');
    const roles = [];
    for (let i = 0; i < 4; i++) {
      const page = pages[i]; await page.getByRole('button', { name: 'Ver mi tarjeta', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Ocultar tarjeta', exact: true })).toBeVisible();
      const imp = await page.locator('.secret-card.impostor').count();
      roles.push({ role: imp ? 'impostor' : 'player', concept: imp ? null : await page.locator('.secret-card h2').textContent() });
      await screenshot(page, imp ? '07_tarjeta_impostor' : '06_tarjeta_concepto');
      const snapshot = await state(page, code);
      expect(JSON.stringify(snapshot)).not.toContain('impostorId');
      if (!imp) expect(JSON.stringify(snapshot)).not.toContain(roles[i].concept);
      await page.getByRole('button', { name: 'Ya la vi', exact: true }).click();
    }
    expect(roles.filter(p => p.role === 'impostor')).toHaveLength(1);
    expect(new Set(roles.filter(p => p.concept).map(p => p.concept)).size).toBe(1);
    await join(late, 'Cami', code);
    await expect(late.getByRole('heading', { name: 'Llegaste justo a tiempo' })).toBeVisible();
    await screenshot(late, '08_ingreso_tardio');
    await host.getByRole('button', { name: 'Comenzar las pistas', exact: true }).click();
    await expect.poll(async () => (await state(host, code)).phase).toBe('clues');
    await screenshot(fran, '09_turno_pistas');
    await host.getByRole('button', { name: 'Controles del anfitrión', exact: true }).click();
    await screenshot(host, '10_controles_anfitrion');
    await host.getByRole('button', { name: 'Pausar ronda', exact: true }).click();
    await expect(fran.getByRole('heading', { name: 'Hacemos una pausa' })).toBeVisible();
    const id = (await state(fran, code)).me.id;
    await fran.reload(); await expect(fran.getByRole('heading', { name: 'Hacemos una pausa' })).toBeVisible();
    expect((await state(fran, code)).me.id).toBe(id);
    await contexts[1].setOffline(true);
    await expect(fran.getByText(/Estamos reconectando. Tu lugar sigue guardado/)).toBeVisible();
    await contexts[1].setOffline(false);
    await expect(fran.locator('.reconnect-strip')).toHaveCount(0);
    await host.getByRole('button', { name: 'Continuar ronda', exact: true }).click();
    for (let i = 0; i < 8; i++) {
      await host.getByRole('button', { name: 'Siguiente turno', exact: true }).click();
      await expect.poll(async () => (await state(host, code)).round.turnIndex).toBe(i + 1);
    }
    await expect.poll(async () => (await state(host, code)).phase).toBe('discussion');
    await screenshot(fran, '11_conversacion');
    await host.getByRole('button', { name: 'Abrir votación', exact: true }).click();
    await host.getByRole('button', { name: 'Volver a mi pantalla', exact: true }).click();
    const names = ['Vale', 'Fran', 'Dani', 'Nico'], impIndex = roles.findIndex(r => r.role === 'impostor');
    for (let i = 0; i < 4; i++) {
      const target = i === impIndex ? (i + 1) % 4 : impIndex;
      await pages[i].getByRole('button', { name: `Votar por ${names[target]}`, exact: true }).click();
      if (i === 0) await screenshot(pages[i], '12_votacion');
      await pages[i].getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(pages[i].getByRole('dialog')).toBeVisible();
      if (i === 0) await screenshot(pages[i], '13_confirmacion_voto');
      await pages[i].getByRole('button', { name: 'Confirmar voto', exact: true }).click();
    }
    for (const page of pages) await expect(page.getByRole('heading', { name: '¡Lo descubrieron!' })).toBeVisible();
    await screenshot(host, '14_resultado_grupo');
    await host.getByRole('button', { name: 'Ver todos los votos', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Así votó el grupo' })).toBeVisible();
    await screenshot(host, '15_detalle_votos');
    await host.getByRole('button', { name: 'Volver al resultado', exact: true }).click();
    await host.getByRole('button', { name: 'Siguiente ronda', exact: true }).click();
    await expect(late.getByRole('heading', { name: 'Tu secreto está listo' })).toBeVisible();
    expect((await state(late, code)).me.inRound).toBe(true);
    await host.getByRole('button', { name: 'Controles del anfitrión', exact: true }).click();
    await host.getByRole('button', { name: 'Cancelar esta ronda', exact: true }).click();
    await host.getByRole('button', { name: 'Cancelar ronda', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Estamos casi listos' })).toBeVisible();
    await host.getByRole('button', { name: /1 impostor/ }).click();
    await host.getByRole('button', { name: 'Revisar catálogo', exact: true }).click();
    await host.getByRole('button', { name: 'Agregar concepto', exact: true }).click();
    await host.getByLabel('Concepto', { exact: true }).fill('La mascota de la familia');
    await host.getByLabel('Categoría', { exact: true }).selectOption('family');
    await host.getByRole('button', { name: 'Guardar concepto', exact: true }).click();
    await expect(host.getByText('La mascota de la familia', { exact: true })).toBeVisible();
    await screenshot(host, '16_catalogo_personalizado');
    expect(errors).toEqual([]);
  } finally { await Promise.allSettled(contexts.map(c => c.close())); }
});

test('mobile layouts fit narrow screens; error recovery, settings and rules remain readable', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  for (const width of [320, 360, 393, 430]) {
    await page.setViewportSize({ width, height: 852 }); await page.goto('/');
    await expect(page.getByRole('button', { name: 'Entrar a una sala', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Entrar a una sala', exact: true }).click();
  await page.getByLabel('Código de sala', { exact: true }).fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('no existe');
  await page.getByRole('button', { name: 'Escanear QR', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('cámara de tu celular');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ajustes de experiencia', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Texto más grande', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Reducir animaciones', exact: true }).check();
  await page.getByRole('button', { name: 'Guardar ajustes', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/large-text/);
  await page.getByRole('button', { name: 'Cómo jugar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cómo jugar', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, '17_reglas_texto_grande');
  expect(errors).toEqual([]);
});

test('spectator host can organize, customize a category and close a room for everyone', async ({ page, browser }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Crear una sala', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill('Organizadora');
  await page.getByRole('checkbox', { name: 'También voy a jugar', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Crear sala', exact: true }).click();
  const code = (await page.locator('.room-code').textContent()).trim();
  const context = await browser.newContext({ baseURL: root }); const guest = await context.newPage();
  try {
    await join(guest, 'Invitada', code);
    await page.getByRole('button', { name: /Ver participantes/ }).click();
    await expect(page.getByText('Solo organiza')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Faltan 3 jugadores' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cerrar sala', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('La sala se cerrará para todos');
    await screenshot(page, '18_cerrar_sala');
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sala', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Gracias por jugar', exact: true })).toBeVisible();
    await screenshot(guest, '19_despedida');
    await guest.reload(); await expect(guest.getByRole('heading', { name: 'Gracias por jugar', exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test('tie ballot only offers tied candidates and a repeated tie awards the impostor', async ({ browser }) => {
  const contexts = [], pages = [], names = ['Uno', 'Dos', 'Tres', 'Cuatro'];
  try {
    for (let i = 0; i < 4; i++) { const c = await browser.newContext({ baseURL: root, viewport: { width: 393, height: 852 } }); contexts.push(c); pages.push(await c.newPage()); }
    const created = await apiPost(pages[0], root, '/api/rooms', { name: names[0] }); const code = created.code;
    for (let i = 1; i < 4; i++) await apiPost(pages[i], root, `/api/rooms/${code}/join`, { name: names[i] });
    await apiAction(pages[0], root, code, 'start');
    for (const p of pages) { await apiAction(p, root, code, 'card'); await apiAction(p, root, code, 'ready'); }
    await apiAction(pages[0], root, code, 'begin'); await apiAction(pages[0], root, code, 'discussion', { confirm: true }); await apiAction(pages[0], root, code, 'voting');
    for (const p of pages) await p.goto(`${root}/?sala=${code}`);
    const choices = [2, 3, 3, 2];
    for (let ballot = 0; ballot < 2; ballot++) {
      if (ballot === 1) {
        for (const p of pages) await expect(p.getByRole('heading', { name: 'Hay un empate', exact: true })).toBeVisible();
        await expect(pages[0].getByRole('button', { name: 'Votar por Uno', exact: true })).toHaveCount(0);
        await expect(pages[0].getByRole('button', { name: 'Votar por Dos', exact: true })).toHaveCount(0);
        await screenshot(pages[0], '20_desempate');
      }
      for (let i = 0; i < 4; i++) {
        await pages[i].getByRole('button', { name: `Votar por ${names[choices[i]]}`, exact: true }).click();
        await pages[i].getByRole('button', { name: 'Continuar', exact: true }).click();
        await pages[i].getByRole('dialog').getByRole('button', { name: 'Confirmar voto', exact: true }).click();
      }
    }
    for (const p of pages) await expect(p.getByRole('heading', { name: 'Se salió con la suya', exact: true })).toBeVisible();
    expect((await state(pages[0], code)).round.result.reason).toBe('persistent_tie');
    await screenshot(pages[0], '21_resultado_impostor');
  } finally { await Promise.allSettled(contexts.map(c => c.close())); }
});

test('real server restart restores browser sessions and identical private cards, then resumes the paused game', async ({ browser }) => {
  test.skip(Boolean(process.env.CLOUD_TEST), 'Node restart is verified in the local server suite; cloud durability is verified separately.');
  const dir = mkdtempSync(pathJoin(tmpdir(), 'colomba-restart-')), dbPath = pathJoin(dir, 'game.sqlite');
  let app = createApp({ dbPath, port: 0 }); await app.listen();
  const port = app.server.address().port, base = `http://127.0.0.1:${port}`, contexts = [], pages = [];
  try {
    for (let i = 0; i < 4; i++) { const c = await browser.newContext({ baseURL: base, viewport: { width: 393, height: 852 } }); contexts.push(c); pages.push(await c.newPage()); }
    const created = await apiPost(pages[0], base, '/api/rooms', { name: 'Vale' }), code = created.code;
    for (let i = 1; i < 4; i++) await apiPost(pages[i], base, `/api/rooms/${code}/join`, { name: `Invitado ${i}` });
    await apiAction(pages[0], base, code, 'start');
    const cards = [], identities = [];
    for (const p of pages) { identities.push((await state(p, code)).me.id); cards.push(await apiAction(p, base, code, 'card')); await apiAction(p, base, code, 'ready'); }
    await apiAction(pages[0], base, code, 'begin');
    for (const p of pages) { await p.goto(`${base}/?sala=${code}`); await expect(p.locator('.round-strip')).toBeVisible(); }
    await app.close(); app = null;
    await expect(pages[1].locator('.reconnect-strip')).toBeVisible();
    app = createApp({ dbPath, port }); await app.listen();
    for (const p of pages) await expect(p.getByRole('heading', { name: 'Hacemos una pausa', exact: true })).toBeVisible();
    for (let i = 0; i < 4; i++) {
      expect((await state(pages[i], code)).me.id).toBe(identities[i]);
      expect(await apiAction(pages[i], base, code, 'card')).toEqual(cards[i]);
    }
    await screenshot(pages[0], '22_recuperacion_tras_reinicio');
    await pages[0].getByRole('button', { name: 'Continuar ronda', exact: true }).click();
    await expect.poll(async () => (await state(pages[0], code)).phase).toBe('clues');
  } finally { await Promise.allSettled(contexts.map(c => c.close())); if (app) await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
