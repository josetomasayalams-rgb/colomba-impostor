import { icon, shellSun } from './icons.js';

const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const categories = [{ id: 'baby', name: 'El mundo de Colomba', description: 'Cuna, chupete, babero y más', icon: 'carriage' }, { id: 'arrival', name: 'Preparando su llegada', description: 'Regalos, mantas y preparativos', icon: 'gift' }, { id: 'family', name: 'Nuestra familia', description: 'Agrega sus propias palabras', icon: 'home' }];
function stored(name, fallback) { try { return JSON.parse(localStorage.getItem(name)) ?? fallback; } catch { return fallback; } }
function store(name, value) { try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* La sesión de juego usa cookies, no este almacenamiento opcional. */ } }
const ui = { view: 'welcome', back: 'welcome', room: null, secret: null, hostPanel: false, modal: null, busy: false, error: '', connected: true, clockOffset: 0, code: '', query: '', filter: 'baby', catalog: null, selectedVote: null, preferences: stored('colomba.preferences', { sounds: false, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, large: false }), form: { name: '', color: 0, vueltas: 2, seconds: 20, playing: true, categories: ['baby'] }, edit: null };
let stream, toastTimer, syncing = false, syncAgain = false, lastLayout = '', modalFocusKey = '';
const current = () => ui.room;
const active = s => ['reveal', 'clues', 'discussion', 'voting', 'tie', 'paused'].includes(s.phase);
const ctx = () => ({ code: ui.room?.code, roundId: ui.room?.round?.id, revision: ui.room?.revision, ballotId: ui.room?.round?.ballotId });
const nameOf = id => ui.room?.round?.players.find(p => p.id === id)?.name ?? ui.room?.members.find(p => p.id === id)?.name ?? 'Participante';
const personOf = id => ui.room?.round?.players.find(p => p.id === id) ?? ui.room?.members.find(p => p.id === id);
function toast(message, error = false) { clearTimeout(toastTimer); const node = $('#toast'); node.textContent = message; node.className = `toast${error ? ' error' : ''}`; node.hidden = false; toastTimer = setTimeout(() => { node.hidden = true; }, 5000); }
async function request(path, body, options = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Colomba-Intent': 'play', ...(ui.room?.me.csrf ? { 'X-CSRF-Token': ui.room.me.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const data = await response.json();
    if (!response.ok) { const e = new Error(data.error ?? 'No pudimos completar la acción.'); e.status = response.status; e.code = data.code; throw e; }
    return data;
  } catch (e) { if (!e.status) { e.message = 'No logramos conectarnos. Revisa la conexión e inténtalo otra vez.'; if (ui.room) ui.connected = false; } throw e; }
  finally { clearTimeout(timeout); }
}
function applyState(state) {
  if (ui.room?.code === state.code && ui.room.revision > state.revision) return;
  const old = ui.room;
  if (old && (old.round?.id !== state.round?.id || old.phase !== state.phase || old.round?.ballotId !== state.round?.ballotId)) {
    ui.secret = null; ui.selectedVote = null;
    if (ui.modal && ['vote', 'confirm'].includes(ui.modal.kind)) ui.modal = null;
    if (active(state) || state.phase === 'closed' || state.phase === 'results') { if (!['rules', 'preferences'].includes(ui.view)) ui.view = 'room'; }
    if (state.phase === 'results' || state.phase === 'closed') ui.hostPanel = false;
    if (state.phase === 'closed') stream?.close();
    if (ui.preferences.sounds) playSound();
  }
  ui.room = state; ui.clockOffset = state.serverNow - Date.now(); ui.connected = true;
  store('colomba.lastRoom', state.code); render();
}
async function sync() {
  if (!ui.room) return;
  if (syncing) { syncAgain = true; return; }
  const code = ui.room.code; syncing = true;
  try { const state = await request(`/api/rooms/${code}`); if (ui.room?.code === code) applyState(state); }
  catch (e) {
    if (e.status === 401 || e.status === 404) { stream?.close(); ui.secret = null; ui.modal = null; ui.hostPanel = false; ui.room = null; ui.view = 'join'; ui.code = code; toast(e.message, true); }
    render();
  } finally { syncing = false; if (syncAgain) { syncAgain = false; void sync(); } }
}
function connect() {
  stream?.close(); if (!ui.room || ui.room.phase === 'closed') return;
  if (ui.room.transport === 'poll') {
    let cancelled = false, timer;
    const poll = async () => { if (cancelled) return; if (!document.hidden && navigator.onLine) await sync(); if (!cancelled) timer = setTimeout(poll, ui.connected ? 1500 : 3000); };
    stream = { close() { cancelled = true; clearTimeout(timer); } };
    void poll(); return;
  }
  stream = new EventSource(`/api/rooms/${ui.room.code}/events`);
  stream.onmessage = () => { void sync(); };
  stream.onopen = () => { ui.connected = true; void sync(); };
  stream.onerror = () => { ui.connected = false; ui.secret = null; render(); };
}
async function enter(state, view = 'room') { applyState(state); ui.view = view; ui.secret = null; ui.hostPanel = false; ui.error = ''; history.replaceState(null, '', `/?sala=${state.code}`); connect(); render(); }
async function mutate(action, body = {}, context = ctx()) {
  const state = await request(`/api/rooms/${context.code}/${action}`, { ...context, ...body });
  if (action !== 'leave') applyState(state);
  return state;
}
function go(view, back = ui.view) { ui.secret = null; ui.modal = null; ui.error = ''; ui.back = back; ui.view = view; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
function btn(text, action, style = 'primary', extra = '', disabled = false) { return `<button type="button" class="btn ${style}" data-action="${action}" ${extra} ${disabled || ui.busy ? 'disabled' : ''}>${text}</button>`; }
function textButton(text, action, extra = '', cls = '') { return `<button type="button" class="text-button ${cls}" data-action="${action}" ${extra}>${text}</button>`; }
function avatar(p, cls = '', connected = false, ready = false) { return `<span class="avatar tone${Number(p?.color ?? 0)} ${cls}" aria-hidden="true">${esc([...p?.name ?? '?'][0]?.toUpperCase())}${connected ? `<span class="dot${p.connected ? '' : ' offline'}" aria-label="${p.connected ? 'Conectado' : 'Sin conexión'}"></span>` : ''}${ready ? `<span class="check-mark">${icon('check')}</span>` : ''}</span>`; }
function topbar(back = 'back', room = false) {
  return `<header class="topbar">${back ? `<button class="icon-button" data-action="${back}" type="button" aria-label="Volver">${icon('back')}</button>` : '<span class="spacer"></span>'}<span class="wordmark">colomba${icon('shell')}</span><span class="right-tools">${room && ui.room.me.isHost ? `<button type="button" class="icon-button" data-action="host" aria-label="Controles del anfitrión">${icon('people')}</button>` : ''}<button type="button" class="icon-button" data-action="preferences" aria-label="Ajustes de experiencia">${icon('settings')}</button></span></header>`;
}
function heading(title, subtitle = '', left = false) { return `<div class="page-heading${left ? ' align-left' : ''}"><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>`; }
function errorInline() { return ui.error ? `<p class="error-inline" role="alert">${esc(ui.error)}</p>` : ''; }
function notice(text, glyph = 'shell', style = '') { return `<div class="notice ${style}">${icon(glyph)}<div class="notice-copy">${text}</div></div>`; }
function page(content, cls = '') { return `${!ui.connected && ui.room ? `<div class="reconnect-strip" role="status">${icon('wifi')} Estamos reconectando. Tu lugar sigue guardado. ${textButton('Reintentar', 'retry')}</div>` : ''}<section class="page ${cls}">${content}<div class="wave" aria-hidden="true"></div></section>`; }
function miniRoster(players, readiness = false) { return `<div class="mini-roster">${players.map(p => `<div class="mini-person">${avatar(p, '', false, readiness && p.ready)}<span>${esc(p.name)}${p.id === current().me.id ? '<br>(tú)' : ''}</span></div>`).join('')}</div>`; }
function colorPicker() { return `<div class="color-picker" role="group" aria-label="Color de tu avatar">${[0, 1, 2, 3, 4, 5].map(c => `<button type="button" class="color-swatch tone${c}${ui.form.color === c ? ' selected' : ''}" aria-label="Color ${c + 1}" aria-pressed="${ui.form.color === c}" data-action="color" data-value="${c}"></button>`).join('')}</div>`; }
function toggle(name, label, checked, extra = '') { return `<label class="toggle"><input type="checkbox" name="${name}" aria-label="${label}" ${checked ? 'checked' : ''} ${extra}><span class="toggle-track"></span></label>`; }
function categorySummary() { return ui.form.categories.length === 1 ? categories.find(c => c.id === ui.form.categories[0]).name : `${ui.form.categories.length} categorías elegidas`; }
function setupRows() {
  return `<div class="settings-box"><div class="setting-row"><span>Impostores</span><span class="badge">1</span></div><div class="setting-row"><span>Vueltas de pistas</span><div class="segments">${[1, 2].map(n => `<button type="button" data-action="vueltas" data-value="${n}" class="${ui.form.vueltas === n ? 'active' : ''}" aria-pressed="${ui.form.vueltas === n}">${n}</button>`).join('')}</div></div><div class="setting-row"><span>Tiempo por pista<small>El anfitrión avanza los turnos.</small></span><select class="select-small" name="seconds" aria-label="Tiempo por pista">${[0, 20, 30, 45, 60].map(n => `<option value="${n}" ${ui.form.seconds === n ? 'selected' : ''}>${n ? `${n} segundos` : 'Sin límite'}</option>`).join('')}</select></div><div class="setting-row"><span>También voy a jugar</span>${toggle('playing', 'También voy a jugar', ui.form.playing)}</div></div>${btn(`${icon('shell')}${esc(categorySummary())}${icon('arrow')}`, 'categories', '', '', false)}`;
}
function renderWelcome() {
  return page(`<header class="topbar"><span class="wordmark">colomba${icon('shell')}</span></header><div class="welcome-main">${shellSun()}<p class="eyebrow">BABY SHOWER</p><h1>El impostor de<strong>Colomba</strong></h1><p class="tagline">Una palabra. Muchas sospechas.</p><p class="intro-note">Celebremos su llegada jugando juntos.</p><span class="pill">Se juega en grupo, desde tu celular</span></div><div class="buttons">${btn(`Entrar a una sala ${icon('arrow', 'arrow')}`, 'join')}${btn('Crear una sala', 'create', '')}${ui.room && ui.room.phase !== 'closed' ? textButton('Volver a mi sala', 'room') : textButton('Cómo jugar', 'rules')}</div><p class="welcome-footer">Una pequeña gran bienvenida</p>`, 'welcome');
}
function renderJoin() {
  return page(`${topbar('home')}${heading('Entra al juego', 'Escribe el código que compartió el anfitrión.')}<form class="form-stack" data-form="join"><div class="field"><label for="room-code">Código de sala</label><input id="room-code" class="code-input" name="code" value="${esc(ui.code)}" placeholder="ABC234" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" required></div>${errorInline()}${textButton(`${icon('qr')}Escanear QR`, 'scan')}<div class="decor-space">${icon('shell')}</div><div class="buttons push-bottom"><button class="btn primary" ${ui.busy ? 'disabled' : ''}>Continuar</button>${textButton('Cómo jugar', 'rules')}</div></form>`);
}
function renderRegister() {
  return page(`${topbar('join')}<span class="badge">SALA ${esc(ui.code)}</span>${heading('¿Cómo te llamas?', 'Así te reconocerán los demás.')}<form class="form-stack" data-form="register"><div class="avatar-area"><span id="avatar-preview">${avatar({ name: ui.form.name || 'Tú', color: ui.form.color }, 'large')}</span>${colorPicker()}</div><div class="field"><label for="name">Tu nombre o apodo</label><input id="name" name="name" value="${esc(ui.form.name)}" placeholder="Tu nombre" maxlength="24" autocomplete="given-name" required><small>Usa un nombre que el grupo reconozca.</small></div>${errorInline()}<div class="buttons push-bottom"><button class="btn primary" ${ui.busy ? 'disabled' : ''}>Entrar al juego</button><p class="small center muted">Solo necesitamos tu nombre.</p></div></form>`);
}
function renderCreate(editing = false) {
  return page(`${topbar(editing ? 'room' : 'home')}${heading(editing ? 'Ajusta la partida' : 'Prepara la partida', 'Todo listo para celebrar a Colomba.')}<form class="form-stack" data-form="${editing ? 'room-settings' : 'create'}">${!editing ? `<div class="field"><label for="name">Tu nombre</label><input id="name" name="name" value="${esc(ui.form.name)}" placeholder="¿Cómo te llamas?" maxlength="24" autocomplete="given-name" required></div>${colorPicker()}` : ''}${setupRows()}<p class="small muted">Puedes cambiar los conceptos antes de comenzar. Se necesitan al menos 4 jugadores.</p>${editing ? textButton(`${icon('edit')}Revisar catálogo`, 'catalog') : ''}${errorInline()}<div class="push-bottom"><button class="btn primary" ${ui.busy ? 'disabled' : ''}>${editing ? 'Guardar configuración' : 'Crear sala'}</button></div></form>`);
}
function renderCategories() {
  return page(`${topbar('category-back')}${heading('Elige los conceptos', 'Palabras para jugar y celebrar su llegada.')}<div class="category-list">${categories.map(c => `<button type="button" class="category-row ${ui.form.categories.includes(c.id) ? 'selected' : ''}" data-action="category" data-id="${c.id}" aria-pressed="${ui.form.categories.includes(c.id)}">${icon(c.icon)}<span class="category-copy"><strong>${c.name}</strong><small>${c.description}</small></span><span class="radio"></span></button>`).join('')}</div><p class="small muted">Puedes combinar varias categorías. En “Nuestra familia”, agrega palabras propias desde el catálogo.</p>${ui.room?.me.isHost && ['lobby', 'results'].includes(ui.room.phase) ? textButton('Revisar catálogo', 'catalog') : ''}<div class="push-bottom">${btn('Usar estas categorías', 'category-back')}</div>`);
}
function renderRules() {
  const steps = [['lock', '1. Mira tu tarjeta', 'Todos reciben un concepto, excepto el impostor. Mira tu pantalla en privado.'], ['chat', '2. Da una pista', 'Por turnos, di una palabra relacionada sin revelar el concepto.'], ['vote', '3. Vota', 'Después de las vueltas de pistas, conversen y descubran al impostor.']];
  return page(`${topbar()}${heading('Cómo jugar', 'Una palabra. Muchas sospechas.')}<div class="rules-list">${steps.map(([i, title, text]) => `<div class="rule"><span class="rule-icon">${icon(i)}</span><div><strong>${title}</strong><p>${text}</p></div></div>`).join('')}</div>${notice('El impostor escucha, deduce y trata de pasar desapercibido.', 'sun')}<p class="small center">Si lo descubren, gana el grupo. Si se equivocan, gana el impostor. Un empate se vota otra vez; si persiste, gana el impostor.</p><div class="push-bottom">${btn('Entendido', 'back')}</div>`);
}
function renderPreferences() {
  const p = ui.preferenceDraft ?? ui.preferences;
  return page(`${topbar()}${heading('A tu ritmo', 'Pequeños ajustes para jugar cómodo.')}<form class="form-stack" data-form="preferences"><div class="settings-box"><div class="setting-row"><span>Sonidos<small>Avisos suaves entre etapas.</small></span>${toggle('sounds', 'Sonidos', p.sounds)}</div><div class="setting-row"><span>Reducir animaciones<small>Transiciones más tranquilas.</small></span>${toggle('reduce', 'Reducir animaciones', p.reduce)}</div><div class="setting-row"><span>Texto más grande<small>Mayor comodidad al leer.</small></span>${toggle('large', 'Texto más grande', p.large)}</div></div>${textButton(`${icon('help')}Cómo jugar`, 'rules')}<div class="push-bottom"><button class="btn primary">Guardar ajustes</button></div></form>`);
}
function renderInvite() {
  const s = current();
  return page(`${topbar('room')}${heading('Que se sume el grupo', 'Comparte el QR o el código de la sala.')}<div class="qr-box"><img src="/api/rooms/${s.code}/qr" alt="QR para entrar a la sala ${s.code}" width="260" height="260"></div><div class="center"><p class="eyebrow">CÓDIGO DE SALA</p><p class="room-code">${s.code}</p></div><div class="share-actions">${btn(`${icon('copy')}Copiar código`, 'copy-code', '', '', false)}${btn(`${icon('share')}Compartir`, 'share', '', '', false)}</div>${notice(s.transport === 'poll' ? 'Comparte este enlace o QR. Cada persona puede entrar con Wi-Fi o datos móviles.' : 'Para entrar, los celulares y este Mac deben estar conectados a la misma red Wi-Fi.', 'wifi')}<p class="small center muted">${esc(s.shareUrl)}</p><div class="buttons push-bottom">${btn(`Ver participantes · ${s.members.filter(p => p.participates).length}`, 'room')}<p class="small center muted">Cada persona entra desde su celular.</p></div>`);
}
function renderLobby(s) {
  const players = s.members.filter(p => p.participates), host = s.me.isHost;
  const rows = s.members.map(p => `<div class="player-row">${avatar(p, '', true)}<span class="row-name"><strong>${esc(p.name)}${p.id === s.me.id ? ' (tú)' : ''}</strong>${!p.participates ? '<small>Solo organiza</small>' : ''}</span>${p.isHost ? '<span class="host-label">Anfitrión</span>' : `<button type="button" class="icon-button" data-action="member" data-id="${p.id}" aria-label="Opciones de ${esc(p.name)}">${icon('dots')}</button>`}</div>`).join('');
  return page(`${topbar('home', true)}${host ? '<span class="badge">ANFITRIÓN</span>' : `<span class="badge">SALA ${s.code}</span>`}${heading(host ? 'Estamos casi listos' : 'Ya estás dentro', host ? 'Comparte el código para que se unan al juego.' : 'Esperamos a que el anfitrión comience.')}${host ? `<button type="button" class="code-chip" data-action="invite" aria-label="Invitar a la sala ${s.code}">${s.code}${icon('share')}</button><div class="section-head"><span>Participantes · ${players.length}</span>${textButton(`Invitar ${icon('plus')}`, 'invite')}</div><div class="player-list">${rows}</div>${btn(`${icon('settings')}1 impostor · ${s.settings.vueltas} vueltas${icon('arrow')}`, 'room-settings', '')}<div class="buttons push-bottom">${btn(players.length >= 4 ? 'Iniciar ronda' : `Faltan ${4 - players.length} jugadores`, 'start', 'primary', '', players.length < 4)}${textButton('Cómo jugar', 'rules')}${textButton('Cerrar sala', 'close-room', '', 'danger')}</div>` : `<div class="roster-card"><p>${players.length} personas en la sala</p><div class="roster-grid">${s.members.map(p => `<div class="roster-person">${avatar(p, 'medium', true)}<span class="name">${esc(p.name)}${p.id === s.me.id ? ' (tú)' : ''}</span>${p.isHost ? '<span class="host-label">Anfitrión</span>' : ''}</div>`).join('')}</div></div>${notice('Tu tarjeta aparecerá aquí al comenzar.')}<div class="buttons push-bottom"><div class="status-bar"><span class="spinner" aria-hidden="true"></span>Esperando al anfitrión…</div>${textButton('Salir de la sala', 'leave')}</div>`}`);
}
function roundTop(s, badge = '') { return `${topbar('home', true)}<span class="badge${badge === 'PRIVADO' ? ' sage' : ''}">RONDA ${s.round.number}${badge ? ` · ${badge}` : ''}</span>`; }
function renderPrivate(s) {
  const imp = ui.secret.role === 'impostor';
  return page(`${roundTop(s, 'PRIVADO')}${heading(imp ? 'Este es tu papel' : 'Esta es tu palabra', `${esc(s.me.name)}, ${imp ? 'que no se note.' : 'guárdala en secreto.'}`)}<div class="secret-card ${imp ? 'impostor' : ''}">${icon('shell')}<span class="eyebrow">${imp ? 'TU ROL' : 'TU CONCEPTO'}</span><h2>${imp ? 'Eres el impostor' : esc(ui.secret.concept)}</h2><p class="secret-rule">${imp ? 'Escucha las pistas.<br>Descubre el concepto.<br>Pasa desapercibido.' : 'Da una pista relacionada<br>sin decir el concepto.'}</p></div><div class="buttons push-bottom">${btn('Ocultar tarjeta', 'hide-card')}${s.phase === 'reveal' && !s.me.ready ? btn('Ya la vi', 'ready', '') : ''}<p class="small center muted">La tarjeta se oculta al cambiar de aplicación.</p></div>`);
}
function renderReveal(s) {
  const r = s.round;
  if (s.me.inRound && !s.me.ready) return page(`${roundTop(s)}${heading('Tu secreto está listo', `${esc(s.me.name)}, mira tu pantalla en privado.`)}<div class="secret-card closed">${icon('shell')}${icon('lock', 'lock-icon')}<p>Solo para ti</p></div><p class="small center muted">Ocúltala antes de mostrar tu celular.</p><div class="buttons push-bottom">${btn('Ver mi tarjeta', 'card')}<p class="small center muted">${r.viewedCount} de ${r.playerCount} personas ya miraron su tarjeta.</p></div>`);
  return page(`${roundTop(s)}${heading(s.me.inRound ? 'Secreto guardado' : 'La ronda está preparada', 'Esperemos a que todos vean su tarjeta.')}<div class="progress-circle">${icon('shell')}</div><p class="center">${r.readyCount} de ${r.playerCount} personas listas</p>${miniRoster(r.players, true)}<div class="buttons push-bottom">${s.me.inRound ? btn(`${icon('eye')}Volver a ver mi tarjeta`, 'card', '') : notice('Estás organizando esta ronda. No recibes tarjeta.', 'people')}${s.me.isHost ? btn('Comenzar las pistas', 'begin', 'primary', '', r.readyCount < r.playerCount) : '<div class="status-bar">La ronda está por comenzar…</div>'}</div>`);
}
function timerValue(deadline) { return deadline == null ? '∞' : Math.max(0, Math.ceil((deadline - Date.now() - ui.clockOffset) / 1000)); }
function renderClues(s) {
  const turn = s.round.turn, p = personOf(turn.playerId), own = p.id === s.me.id;
  const next = s.round.players; // El siguiente nombre se publica únicamente cuando llega su turno.
  return page(`${topbar('home', true)}<div class="round-strip"><span>Ronda ${s.round.number}</span><span>Vuelta ${turn.vuelta} de ${s.round.vueltas}</span></div>${heading(own ? `Te toca, ${esc(s.me.name)}` : `Ahora habla ${esc(p.name)}`, own ? 'Di una palabra relacionada.' : 'Escucha su pista. Puede decir mucho.')}<div class="timer-art"><div class="timer-circle">${own ? `<span class="timer-number" data-timer="${turn.deadline ?? ''}">${timerValue(turn.deadline)}</span><span class="timer-label">${turn.deadline ? 'segundos' : 'sin límite'}</span>` : avatar(p, 'large')}</div>${!own ? `<span class="timer-label"><strong data-timer="${turn.deadline ?? ''}">${timerValue(turn.deadline)}</strong> ${turn.deadline ? 'segundos' : 'sin límite'}</span>` : ''}</div><p class="small center">${own ? 'Una pista, sin revelar el concepto.' : 'Las pistas se dicen en voz alta.'}</p>${own ? '<div class="status-bar coral">El grupo te está escuchando</div>' : ''}<p class="small center muted">Turno ${s.round.turnIndex + 1} de ${s.round.totalTurns} · ${next.length} jugadores</p><div class="buttons push-bottom">${s.me.isHost ? btn('Siguiente turno', 'advance') : ''}${s.me.inRound ? btn(`${icon('eye')}Ver mi tarjeta`, 'card', '') : ''}${s.me.isHost ? textButton(`${icon('pause')}Pausar ronda`, 'pause') : ''}</div>`);
}
function renderDiscussion(s) {
  return page(`${roundTop(s)}${heading('¿Quién levantó sospechas?', 'Ahora pueden conversar y comparar pistas.')}<div class="circle-art">${icon('chat')}</div>${miniRoster(s.round.players)}${notice(s.me.isHost ? 'Cuando el grupo esté listo, abre la votación.' : 'El anfitrión abrirá la votación cuando estén listos.', 'chat', 'sage')}<div class="buttons push-bottom">${s.me.isHost ? btn('Abrir votación', 'voting') : ''}${s.me.inRound ? btn(`${icon('eye')}Ver mi tarjeta`, 'card', '') : ''}<p class="small center muted">Escucha, pregunta y decide.</p></div>`);
}
function renderVoting(s) {
  const r = s.round;
  if (s.me.voted || !s.me.inRound) return page(`${roundTop(s)}<div class="circle-art sage">${icon(s.me.voted ? 'check' : 'vote')}</div>${heading(s.me.voted ? 'Tu voto está listo' : 'El grupo está votando', 'Esperemos a que vote el resto.')}<p class="center">${r.voteCount} de ${r.playerCount} votos recibidos</p><div class="progress-bar"><progress max="${r.playerCount}" value="${r.voteCount}" aria-label="Votos recibidos"></progress></div><p class="small center muted">Los resultados se revelan al cerrar la votación.</p><div class="buttons push-bottom"><div class="status-bar"><span class="spinner"></span>Esperando resultados…</div>${s.me.isHost ? btn('Controles de la votación', 'host', '') : ''}</div>`);
  const tie = s.phase === 'tie', players = r.players.filter(p => r.candidates.includes(p.id));
  return page(`${roundTop(s, tie ? 'DESEMPATE' : 'VOTACIÓN')}${heading(tie ? 'Hay un empate' : '¿Quién es el impostor?', tie ? 'Voten otra vez entre estas personas.' : 'Elige a una persona. Tu voto es privado.')}<div class="player-list">${players.map(p => `<button type="button" class="player-row ${p.id === s.me.id ? 'disabled' : ''} ${ui.selectedVote === p.id ? 'selected' : ''}" data-action="select-vote" aria-label="Votar por ${esc(p.name)}" data-id="${p.id}" aria-pressed="${ui.selectedVote === p.id}" ${p.id === s.me.id ? 'disabled' : ''}>${avatar(p)}<span class="row-name"><strong>${esc(p.name)}${p.id === s.me.id ? ' (tú)' : ''}</strong>${p.id === s.me.id ? '<small>No puedes votarte</small>' : tie ? `<small>${r.firstTallies[p.id]} votos en la primera votación</small>` : ''}</span><span class="radio"></span></button>`).join('')}</div>${tie ? notice('Si el empate continúa, gana el impostor.', 'shell') : ''}<div class="buttons push-bottom">${btn('Continuar', 'confirm-vote', 'primary', '', !ui.selectedVote)}<p class="small center muted">Revisarás tu elección antes de confirmar.</p></div>`);
}
function renderResult(s) {
  const result = s.round.result, won = result.winner === 'group';
  return page(`${roundTop(s, 'RESULTADO')}<div class="result-emblem">${icon('shell')}</div>${heading(won ? '¡Lo descubrieron!' : 'Se salió con la suya', won ? 'El grupo gana esta ronda.' : 'El impostor gana esta ronda.')}<div class="reveal-box"><p class="eyebrow">EL IMPOSTOR ERA</p><div class="result-identity">${avatar(personOf(result.impostorId), 'medium')}<strong>${esc(nameOf(result.impostorId))}</strong></div>${!won ? `<p class="small">${result.reason === 'persistent_tie' ? 'El empate continuó y el impostor logró pasar desapercibido.' : `El grupo acusó a ${esc(nameOf(result.accusedId))}.`}</p>` : ''}<hr><p class="eyebrow">EL CONCEPTO</p><p class="concept">${esc(result.concept)}</p></div>${notice(`<p>${result.totalVotes} de ${result.expectedVotes} votos recibidos.</p>${textButton('Ver todos los votos', 'results-detail')}`, 'people')}<div class="buttons push-bottom">${s.me.isHost ? btn('Siguiente ronda', 'start') : '<div class="status-bar">Esperando la próxima ronda…</div>'}${s.me.isHost ? textButton('Revisar configuración y conceptos', 'room-settings') + textButton('Cerrar sala', 'close-room', '', 'danger') : textButton('Salir de la sala', 'leave')}</div>`);
}
function renderResultsDetail() {
  const s = current(), r = s.round.result, sorted = [...s.round.players].sort((a, b) => r.tallies[b.id] - r.tallies[a.id]);
  return page(`${topbar('room')}${heading('Así votó el grupo', `Ronda ${s.round.number}`)}<div>${sorted.map(p => `<div class="tally-row">${avatar(p)}<span class="tally-name">${esc(p.name)}${p.id === r.impostorId ? '<small>Impostor</small>' : ''}</span><progress value="${r.tallies[p.id]}" max="${Math.max(1, r.totalVotes)}" aria-label="${esc(p.name)}: ${r.tallies[p.id]} votos"></progress><span class="count">${r.tallies[p.id]} ${r.tallies[p.id] === 1 ? 'voto' : 'votos'}</span></div>`).join('')}</div><p class="small muted">${r.totalVotes} votos en total. No se publica quién votó por quién.</p>${notice(`Concepto: <strong>${esc(r.concept)}</strong>`)}<div class="push-bottom">${btn('Volver al resultado', 'room')}</div>`);
}
function renderPaused(s) {
  return page(`${roundTop(s)}<div class="circle-art">${icon('pause')}</div>${heading('Hacemos una pausa', 'La ronda continúa cuando estén listos.')}${s.recovered ? notice('La partida se recuperó al reiniciar. El anfitrión puede continuar donde quedaron.', 'check', 'sage') : ''}${s.round.turn ? notice(`Turno de ${esc(nameOf(s.round.turn.playerId))} · Vuelta ${s.round.turn.vuelta} de ${s.round.vueltas}<br>${s.round.turn.remaining == null ? 'Sin límite de tiempo' : `${Math.ceil(s.round.turn.remaining / 1000)} segundos restantes`}`, 'clock') : ''}${miniRoster(s.round.players)}<div class="buttons push-bottom">${s.me.isHost ? btn('Continuar ronda', 'resume') : '<div class="status-bar">El anfitrión reanudará la ronda.</div>'}${s.me.inRound ? btn(`${icon('eye')}Ver mi tarjeta`, 'card', '') : ''}${s.me.isHost ? textButton('Cancelar esta ronda', 'cancel-round', '', 'danger') : ''}</div>`);
}
function renderWaiting(s) {
  return page(`${topbar('home', true)}<span class="badge">SALA ${s.code}</span>${heading('Llegaste justo a tiempo', 'Hay una ronda en curso. Jugarás en la próxima.')}<div class="circle-art">${icon('shell')}</div>${notice('Tu nombre ya está en la lista.', 'check', 'sage')}<div class="buttons push-bottom"><div class="status-bar">Esperando la próxima ronda…</div>${textButton('Salir de la sala', 'leave')}</div>`);
}
function renderHost(s) {
  const r = s.round;
  return page(`${topbar('player-view', true)}<span class="badge">ANFITRIÓN</span>${heading('Tú llevas el ritmo', `Ronda ${r.number} · ${({ reveal: 'Tarjetas', clues: 'Pistas', discussion: 'Conversación', voting: 'Votación', tie: 'Desempate', paused: 'Pausa' })[s.phase]}`)}<div class="control-card">${s.phase === 'clues' ? `<p class="eyebrow">HABLA</p><strong>${esc(nameOf(r.turn.playerId))}</strong><p>Vuelta ${r.turn.vuelta} de ${r.vueltas}</p><p class="time"><span data-timer="${r.turn.deadline ?? ''}">${timerValue(r.turn.deadline)}</span> ${r.turn.deadline ? 'segundos' : 'sin límite'}</p>` : `<strong>${s.phase === 'reveal' ? `${r.readyCount} de ${r.playerCount}` : s.phase === 'voting' || s.phase === 'tie' ? `${r.voteCount} de ${r.playerCount}` : 'Todo a su ritmo'}</strong><p>${s.phase === 'reveal' ? 'tarjetas confirmadas' : s.phase === 'voting' || s.phase === 'tie' ? 'votos recibidos' : 'El grupo está reunido.'}</p>`}</div>${miniRoster(r.players, s.phase === 'reveal')}<div class="buttons">${s.phase === 'reveal' ? btn('Comenzar las pistas', 'begin', 'primary', '', r.readyCount < r.playerCount) : ''}${s.phase === 'clues' ? btn('Siguiente turno', 'advance') : ''}${s.phase === 'discussion' ? btn('Abrir votación', 'voting') : ''}${s.phase === 'voting' || s.phase === 'tie' ? btn('Cerrar votación', 'close-vote', 'primary', '', r.voteCount === 0) : ''}${s.phase === 'paused' ? btn('Continuar ronda', 'resume') : btn(`${icon('pause')}Pausar ronda`, 'pause', '')}${s.me.inRound ? btn('Volver a mi pantalla', 'player-view', '') : ''}</div>${s.phase === 'clues' ? `<button type="button" class="control-action" data-action="discussion">${icon('chat')}Abrir conversación${icon('arrow', 'arrow')}</button>` : ''}<div class="push-bottom">${textButton(`${icon('trash')}Cancelar esta ronda`, 'cancel-round', '', 'danger')}${textButton('Cerrar sala', 'close-room', '', 'danger')}</div>`);
}
function renderClosed(s) {
  return page(`${topbar('home')}<div class="decor-space">${shellSun()}</div>${heading('Gracias por jugar', 'Qué lindo celebrar juntos la llegada de Colomba.')}<span class="badge">${icon('lock')}La sala está cerrada</span><div class="buttons push-bottom">${btn('Volver al inicio', 'home')}${btn('Crear otra sala', 'create', '')}</div>`);
}
function renderRoom() {
  const s = current(); if (!s) return renderWelcome();
  if (s.phase === 'closed') return renderClosed(s);
  if (ui.secret && ui.secret.roundId === s.round?.id) return renderPrivate(s);
  if (s.phase === 'lobby') return renderLobby(s);
  if (s.phase === 'results') return renderResult(s);
  if (ui.hostPanel && s.me.isHost) return renderHost(s);
  if (!s.me.inRound && !s.me.isHost) return renderWaiting(s);
  if (s.phase === 'paused') return renderPaused(s);
  if (s.phase === 'reveal') return renderReveal(s);
  if (!s.me.inRound && s.me.isHost) return renderHost(s);
  if (s.phase === 'clues') return renderClues(s);
  if (s.phase === 'discussion') return renderDiscussion(s);
  return renderVoting(s);
}
function renderCatalog() {
  const concepts = (ui.catalog?.concepts ?? []).filter(c => c.category === ui.filter && c.word.toLocaleLowerCase('es').includes(ui.query.toLocaleLowerCase('es')));
  return page(`${topbar('room-settings')}${heading('Los conceptos', 'Se sortean sin repetirse.')}<select class="select-small" name="catalog-filter" aria-label="Categoría del catálogo">${categories.map(c => `<option value="${c.id}" ${ui.filter === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select><div class="search-field">${icon('search')}<input name="query" aria-label="Buscar concepto" placeholder="Buscar concepto" value="${esc(ui.query)}"></div><div class="catalog-list catalog-scroll">${concepts.map(c => `<div class="concept-row"><span class="word">${esc(c.word)}</span>${toggle('concept-enabled', `Activar ${esc(c.word)}`, c.enabled, `data-concept="${c.id}" ${ui.busy ? 'disabled' : ''}`)}<button type="button" class="icon-button" data-action="edit-concept" data-id="${c.id}" aria-label="Editar ${esc(c.word)}">${icon('edit')}</button></div>`).join('') || `<div class="empty">${icon('shell')}<p>Aquí caben sus propias palabras.</p><p class="small muted">Agrega un concepto para esta categoría.</p></div>`}</div><div class="buttons push-bottom">${btn(`${icon('plus')}Agregar concepto`, 'add-concept')}${textButton('Listo', 'room-settings')}</div>`);
}
function renderEdit() {
  const e = ui.edit;
  return page(`${topbar('catalog')}${heading('Un concepto para jugar')}<form class="form-stack" data-form="concept"><div class="field"><label for="word">Concepto</label><input id="word" name="word" value="${esc(e.word)}" maxlength="48" required></div><div class="field"><label for="category">Categoría</label><select id="category" name="category">${categories.map(c => `<option value="${c.id}" ${e.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>${notice('<strong>Que permita varias pistas</strong>Elige algo que todos puedan reconocer.', 'sparkle')}<div class="setting-row"><span>Disponible para sortear</span>${toggle('enabled', 'Disponible para sortear', e.enabled)}</div>${errorInline()}<div class="buttons push-bottom"><button class="btn primary" ${ui.busy ? 'disabled' : ''}>Guardar concepto</button>${textButton('Cancelar', 'catalog')}</div></form>`);
}
function render() {
  document.documentElement.classList.toggle('reduced-motion', ui.preferences.reduce); document.documentElement.classList.toggle('large-text', ui.preferences.large);
  const focus = document.activeElement?.name, start = document.activeElement?.selectionStart, end = document.activeElement?.selectionEnd;
  const layout = `${ui.view}:${ui.room?.phase}:${Boolean(ui.secret)}:${ui.hostPanel}`;
  const scrollTop = $('.catalog-scroll')?.scrollTop;
  const views = { welcome: renderWelcome, join: renderJoin, register: renderRegister, create: () => renderCreate(false), 'room-settings': () => renderCreate(true), categories: renderCategories, rules: renderRules, preferences: renderPreferences, room: renderRoom, invite: renderInvite, catalog: renderCatalog, edit: renderEdit, 'results-detail': renderResultsDetail };
  $('#app').innerHTML = (views[ui.view] ?? renderWelcome)();
  if (layout === lastLayout && focus) { const field = [...document.querySelectorAll('[name]')].find(n => n.name === focus); if (field) { field.focus({ preventScroll: true }); if (typeof field.setSelectionRange === 'function' && start !== null) { try { field.setSelectionRange(start, end); } catch { /* select */ } } } }
  if (scrollTop && $('.catalog-scroll')) $('.catalog-scroll').scrollTop = scrollTop;
  lastLayout = layout; renderModal(); updateTimers();
}
function showModal(modal) { ui.secret = null; ui.modal = { ...modal, context: ctx() }; render(); }
function renderModal() {
  const m = ui.modal, overlay = $('#overlay'); $('#app').inert = Boolean(m);
  if (m) $('#app').setAttribute('aria-hidden', 'true'); else $('#app').removeAttribute('aria-hidden');
  if (!m) { overlay.innerHTML = ''; modalFocusKey = ''; return; }
  let content;
  if (m.kind === 'vote') content = `<h2 id="dialog-title">¿Votas por ${esc(nameOf(m.targetId))}?</h2><p>Una vez confirmado, tu voto queda registrado.</p>${avatar(personOf(m.targetId), 'medium')}<p class="sheet-name">${esc(nameOf(m.targetId))}</p><div class="buttons">${btn('Confirmar voto', 'send-vote')}${btn('Cambiar elección', 'dismiss', '')}</div>`;
  else if (m.kind === 'scan') content = `${icon('qr', 'sheet-icon')}<h2 id="dialog-title">Entra con tu cámara</h2><p>Abre la cámara de tu celular, apunta al QR que muestra el anfitrión y toca el enlace.</p><p class="small muted">También puedes escribir el código de seis caracteres. No necesitas dar acceso a tu cámara desde esta página.</p>${btn('Entendido', 'dismiss')}`;
  else if (m.kind === 'share') content = `<h2 id="dialog-title">La invitación está lista</h2><p>Comparte este enlace con el grupo.</p><div class="field"><label for="share-url">Enlace de la sala</label><input id="share-url" readonly value="${esc(current().shareUrl)}"></div>${btn('Copiar enlace', 'copy-link')}${btn('Listo', 'dismiss', '')}`;
  else content = `${icon(m.icon ?? 'shell', 'sheet-icon')}<h2 id="dialog-title">${esc(m.title)}</h2><p>${esc(m.text)}</p><div class="buttons">${btn(esc(m.confirm), 'confirm-action', m.danger ? 'terracotta' : 'primary')}${btn(m.cancel ?? 'Seguir jugando', 'dismiss', '')}</div>`;
  overlay.innerHTML = `<div class="modal-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="handle" aria-hidden="true"></div>${content}</div></div>`;
  const key = `${m.kind}:${m.action}:${m.targetId}`;
  if (key !== modalFocusKey) { $('#dialog-title').tabIndex = -1; $('#dialog-title').focus({ preventScroll: true }); modalFocusKey = key; }
}
function updateTimers() { for (const el of document.querySelectorAll('[data-timer]')) { const deadline = Number(el.dataset.timer) || null; el.textContent = timerValue(deadline); if (deadline && timerValue(deadline) === 0) el.setAttribute('aria-label', 'Tiempo cumplido'); } }
function setupDraft() { if (ui.room) Object.assign(ui.form, { ...ui.room.settings, categories: [...ui.room.settings.categories], playing: ui.room.me.participates, name: ui.room.me.name, color: ui.room.me.color }); }
async function openCatalog() { ui.catalog = await request(`/api/rooms/${current().code}/catalog`); ui.filter = ui.form.categories[0] ?? 'baby'; go('catalog', 'room-settings'); }
async function clipboard(text) { try { if (!navigator.clipboard?.writeText) return false; await navigator.clipboard.writeText(text); return true; } catch { return false; } }
async function performAction(action, element) {
  switch (action) {
    case 'home': go('welcome'); break;
    case 'back': go(ui.back, 'welcome'); break;
    case 'join': go('join', 'welcome'); break;
    case 'create': ui.form = { name: current()?.me.name ?? ui.form.name, color: current()?.me.color ?? 0, vueltas: 2, seconds: 20, playing: true, categories: ['baby'] }; go('create', 'welcome'); break;
    case 'room': ui.hostPanel = false; go('room'); break;
    case 'rules': go('rules'); break;
    case 'preferences': if (ui.view !== 'preferences') { ui.preferenceDraft = { ...ui.preferences }; go('preferences'); } break;
    case 'scan': showModal({ kind: 'scan' }); break;
    case 'color': ui.form.color = Number(element.dataset.value); render(); break;
    case 'vueltas': ui.form.vueltas = Number(element.dataset.value); render(); break;
    case 'categories': ui.categoryBack = ui.view; go('categories'); break;
    case 'category-back': go(ui.categoryBack ?? 'create'); break;
    case 'category': { const id = element.dataset.id; if (ui.form.categories.includes(id)) { if (ui.form.categories.length === 1) return toast('Elige al menos una categoría.'); ui.form.categories = ui.form.categories.filter(c => c !== id); } else ui.form.categories.push(id); render(); break; }
    case 'room-settings': setupDraft(); go('room-settings', 'room'); break;
    case 'invite': go('invite', 'room'); break;
    case 'copy-code': if (await clipboard(current().code)) toast('Código copiado.'); else { ui.modal = { kind: 'share' }; render(); } break;
    case 'copy-link': if (await clipboard(current().shareUrl)) toast('Enlace copiado.'); else { const field = $('#share-url'); field.focus(); field.select(); toast('Mantén presionado el enlace y elige Copiar.'); } break;
    case 'share': { const data = { title: 'El impostor de Colomba', text: `¡Juguemos! Sala ${current().code}.${current().transport === 'poll' ? ' Entra desde tu celular.' : ' Conéctate a la misma red Wi-Fi.'}`, url: current().shareUrl }; if (navigator.share) { try { await navigator.share(data); break; } catch (e) { if (e.name === 'AbortError') break; } } showModal({ kind: 'share' }); break; }
    case 'start': await mutate('start'); ui.hostPanel = false; ui.view = 'room'; break;
    case 'card': ui.secret = await request(`/api/rooms/${current().code}/card`, { roundId: current().round.id }); render(); break;
    case 'hide-card': ui.secret = null; render(); break;
    case 'ready': ui.secret = null; await mutate('ready'); break;
    case 'begin': case 'advance': case 'voting': case 'pause': case 'resume': await mutate(action); break;
    case 'host': if (!current()?.me.isHost) break; if (['lobby', 'results'].includes(current().phase)) { setupDraft(); go('room-settings', 'room'); } else { ui.hostPanel = !ui.hostPanel; ui.secret = null; ui.view = 'room'; render(); } break;
    case 'player-view': ui.hostPanel = false; go('room'); break;
    case 'select-vote': ui.selectedVote = element.dataset.id; render(); break;
    case 'confirm-vote': if (ui.selectedVote) showModal({ kind: 'vote', targetId: ui.selectedVote }); break;
    case 'send-vote': { const m = ui.modal; ui.modal = null; await mutate('vote', { targetId: m.targetId, ballotId: m.context.ballotId }, m.context); break; }
    case 'dismiss': ui.modal = null; render(); break;
    case 'results-detail': go('results-detail', 'room'); break;
    case 'discussion': showModal({ kind: 'confirm', title: '¿Pasamos a conversar?', text: 'Terminarán las pistas que quedan. El grupo podrá comparar sus sospechas.', confirm: 'Abrir conversación', action: 'discussion' }); break;
    case 'close-vote': showModal({ kind: 'confirm', title: '¿Cerramos la votación?', text: `Hay ${current().round.voteCount} de ${current().round.playerCount} votos. Los votos pendientes no se contarán.`, confirm: 'Cerrar votación', action: 'close-vote', icon: 'vote' }); break;
    case 'cancel-round': showModal({ kind: 'confirm', title: '¿Cancelamos esta ronda?', text: 'Se descartarán las tarjetas y votos de esta ronda. Todos volverán a la sala de espera.', confirm: 'Cancelar ronda', action: 'cancel', danger: true }); break;
    case 'close-room': showModal({ kind: 'confirm', title: '¿Terminamos por hoy?', text: 'La sala se cerrará para todos. No podrán entrar más personas.', confirm: 'Cerrar sala', action: 'close', danger: true }); break;
    case 'leave': showModal({ kind: 'confirm', title: '¿Sales de la sala?', text: 'Si quieres volver después, tendrás que inscribirte nuevamente.', confirm: 'Salir de la sala', action: 'leave', danger: true }); break;
    case 'member': showModal({ kind: 'confirm', title: `¿Retirar a ${nameOf(element.dataset.id)}?`, text: 'Se quitará su inscripción y se cerrará su acceso a esta sala.', confirm: 'Retirar participante', action: 'remove', targetId: element.dataset.id, danger: true }); break;
    case 'confirm-action': { const m = ui.modal; ui.modal = null; await mutate(m.action, { confirm: true, memberId: m.targetId }, m.context); if (m.action === 'leave') { stream?.close(); ui.room = null; history.replaceState(null, '', '/'); go('welcome'); } break; }
    case 'catalog': await openCatalog(); break;
    case 'edit-concept': ui.edit = { ...ui.catalog.concepts.find(c => c.id === element.dataset.id) }; go('edit', 'catalog'); break;
    case 'add-concept': ui.edit = { word: '', category: ui.filter, enabled: true }; go('edit', 'catalog'); break;
    case 'retry': await sync(); connect(); break;
  }
}
document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled || ui.busy) return;
  event.preventDefault(); const action = el.dataset.action;
  const remote = ['start', 'card', 'ready', 'begin', 'advance', 'voting', 'pause', 'resume', 'send-vote', 'confirm-action', 'catalog', 'retry'].includes(action);
  if (remote) { ui.busy = true; for (const b of document.querySelectorAll('.btn')) b.disabled = true; }
  try { await performAction(action, el); }
  catch (e) { ui.error = e.message; toast(e.message, true); if (e.status === 409 && ui.room) await sync(); }
  finally { ui.busy = false; render(); }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.name === 'code') { el.value = el.value.toUpperCase().replace(/[^A-Z2-9]/g, ''); ui.code = el.value; }
  if (el.name === 'name') { ui.form.name = el.value; if ($('#avatar-preview')) $('#avatar-preview').innerHTML = avatar({ name: el.value || 'Tú', color: ui.form.color }, 'large'); }
  if (el.name === 'seconds') ui.form.seconds = Number(el.value);
  if (el.name === 'playing') ui.form.playing = el.checked;
  if (el.name === 'query') { ui.query = el.value; render(); }
  if (ui.view === 'preferences' && ['sounds', 'reduce', 'large'].includes(el.name)) ui.preferenceDraft[el.name] = el.checked;
  if (ui.view === 'edit' && ui.edit) { if (el.name === 'word') ui.edit.word = el.value; if (el.name === 'category') ui.edit.category = el.value; if (el.name === 'enabled') ui.edit.enabled = el.checked; }
});
document.addEventListener('change', async event => {
  const el = event.target;
  if (el.name === 'catalog-filter') { ui.filter = el.value; render(); }
  if (el.name === 'concept-enabled') {
    const c = ui.catalog.concepts.find(c => c.id === el.dataset.concept); ui.busy = true;
    try { await mutate('concept', { ...c, enabled: el.checked }); ui.catalog = await request(`/api/rooms/${current().code}/catalog`); }
    catch (e) { toast(e.message, true); await sync(); }
    finally { ui.busy = false; render(); }
  }
});
document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form]'); if (!form) return; event.preventDefault(); if (ui.busy) return;
  const data = new FormData(form); ui.busy = true; ui.error = ''; render();
  try {
    switch (form.dataset.form) {
      case 'join': {
        const code = String(data.get('code')).toUpperCase().trim(); ui.code = code;
        await request(`/api/rooms/${code}/info`);
        try { const saved = await request(`/api/rooms/${code}`); await enter(saved); }
        catch (e) { if (e.status !== 401) throw e; go('register', 'join'); }
        break;
      }
      case 'register': await enter(await request(`/api/rooms/${ui.code}/join`, { name: data.get('name'), color: ui.form.color })); break;
      case 'create': await enter(await request('/api/rooms', { name: data.get('name'), color: ui.form.color, playing: data.has('playing'), settings: { vueltas: ui.form.vueltas, seconds: Number(data.get('seconds')), categories: ui.form.categories } }), 'invite'); break;
      case 'room-settings': await mutate('settings', { settings: { vueltas: ui.form.vueltas, seconds: Number(data.get('seconds')), categories: ui.form.categories }, playing: data.has('playing') }); go('room'); toast('Configuración guardada.'); break;
      case 'concept': await mutate('concept', { ...ui.edit, word: data.get('word'), category: data.get('category'), enabled: data.has('enabled') }); ui.filter = data.get('category'); ui.catalog = await request(`/api/rooms/${current().code}/catalog`); go('catalog', 'room-settings'); toast('Concepto guardado.'); break;
      case 'preferences': ui.preferences = { sounds: data.has('sounds'), reduce: data.has('reduce'), large: data.has('large') }; store('colomba.preferences', ui.preferences); go(ui.back); toast('Ajustes guardados.'); break;
    }
  } catch (e) { ui.error = e.message; if (e.status === 409 && current() && form.dataset.form !== 'register') await sync(); }
  finally { ui.busy = false; render(); }
});
document.addEventListener('keydown', event => {
  if (!ui.modal) return;
  if (event.key === 'Escape') { ui.modal = null; render(); }
  if (event.key === 'Tab') { const nodes = [...document.querySelectorAll('.sheet button:not(:disabled), .sheet input')]; const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === $('#dialog-title'))) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
});
function conceal() { if (ui.secret) { ui.secret = null; render(); } }
document.addEventListener('visibilitychange', () => { if (document.hidden) conceal(); else if (current()) void sync(); });
window.addEventListener('blur', conceal); window.addEventListener('pagehide', conceal); window.addEventListener('online', () => { void sync(); connect(); });
window.addEventListener('offline', () => { ui.connected = false; ui.secret = null; stream?.close(); render(); });
window.addEventListener('popstate', () => { ui.modal = null; go(current() ? 'room' : 'welcome'); });
let audio;
function playSound() { try { const Audio = window.AudioContext ?? window.webkitAudioContext; if (!Audio) return; audio ??= new Audio(); if (audio.state !== 'running') return; const osc = audio.createOscillator(), gain = audio.createGain(); osc.frequency.value = 660; gain.gain.setValueAtTime(.025, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .2); osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .22); } catch { /* El sonido es opcional. */ } }
document.addEventListener('pointerdown', () => { if (ui.preferences.sounds) { try { const Audio = window.AudioContext ?? window.webkitAudioContext; if (Audio) { audio ??= new Audio(); void audio.resume(); } } catch { /* Opcional. */ } } });
setInterval(updateTimers, 250);
setInterval(() => { if (current() && !document.hidden && current().phase !== 'closed') void sync(); }, 20000);
async function boot() {
  const invite = new URLSearchParams(location.search).get('sala')?.toUpperCase();
  const code = invite ?? stored('colomba.lastRoom', null);
  if (code && /^[A-Z2-9]{6}$/.test(code)) {
    try { const saved = await request(`/api/rooms/${code}`); await enter(saved); if (!invite) go('welcome'); return; }
    catch (e) { if (invite) { ui.code = code; ui.view = 'join'; } }
  }
  render();
}
void boot();
