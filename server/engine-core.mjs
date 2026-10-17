import { hash, randomToken, randomInt, randomUUID, Signal } from './portable.mjs';
import { CATEGORIES, seedCatalog } from './catalog.mjs';

export class GameError extends Error {
  constructor(status, message, code = 'INVALID_ACTION') { super(message); this.status = status; this.code = code; }
}
const fail = (condition, status, message, code) => { if (!condition) throw new GameError(status, message, code); };
const key = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
const activePhases = new Set(['reveal', 'clues', 'discussion', 'voting', 'tie', 'paused']);
const editablePhases = new Set(['lobby', 'results']);
const ttl = 24 * 60 * 60 * 1000;
const impostorsOf = round => round.impostorIds ?? [round.impostorId];
export function cleanText(value, max, label) {
  fail(typeof value === 'string', 400, `${label} es obligatorio.`);
  const text = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  fail(text.length >= 1 && [...text].length <= max && !/[\p{Cc}\p{Cf}<>]/u.test(text), 400, `${label} debe tener entre 1 y ${max} caracteres, sin símbolos especiales.`);
  return text;
}
function validateSettings(input = {}, current) {
  fail(input && typeof input === 'object' && !Array.isArray(input), 400, 'La configuración no es válida.');
  const allowed = ['impostors', 'vueltas', 'seconds', 'categories'];
  fail(Object.keys(input).every(k => allowed.includes(k)), 400, 'Hay una opción de configuración desconocida.');
  const settings = { impostors: 1, vueltas: 2, seconds: 20, categories: ['baby'], ...current, ...input };
  fail(Number.isInteger(settings.impostors) && settings.impostors >= 1 && settings.impostors <= 11, 400, 'Elige entre 1 y 11 impostores.');
  fail([1, 2].includes(settings.vueltas), 400, 'Elige una o dos vueltas.');
  fail([0, 20, 30, 45, 60].includes(settings.seconds), 400, 'El tiempo elegido no es válido.');
  fail(Array.isArray(settings.categories) && settings.categories.length > 0 && settings.categories.length <= 3 && settings.categories.every(c => CATEGORIES.some(x => x.id === c)), 400, 'Elige al menos una categoría válida.');
  settings.categories = [...new Set(settings.categories)];
  return settings;
}

export class GameEngineCore extends Signal {
  constructor({ store, now = () => Date.now(), rng = randomInt, recover = true } = {}) {
    super(); this.now = now; this.rng = rng; this.store = store;
    this.cleanup();
    if (recover) {
      for (const row of this.store.all()) {
        const room = JSON.parse(row.data);
        if (activePhases.has(room.phase) && room.phase !== 'paused') {
          room.round.pausedFrom = room.phase;
          room.round.remaining = room.round.deadline == null ? null : Math.max(0, room.round.deadline - this.now());
          room.round.deadline = null; room.phase = 'paused'; room.recovered = true; room.revision++;
          this.save(room);
        }
      }
    }
  }
  transaction(fn) { return this.store.transaction(fn); }
  cleanup() { return this.store.cleanup(this.now()); }
  close() { this.store.close(); }
  load(code) {
    fail(typeof code === 'string' && /^[A-Z2-9]{6}$/.test(code), 404, 'No encontramos esa sala. Revisa el código.', 'ROOM_NOT_FOUND');
    const row = this.store.get(code);
    fail(row && row.expires_at > this.now(), 404, 'La sala no existe o ya venció. Puedes crear otra.', 'ROOM_NOT_FOUND');
    const room = JSON.parse(row.data);
    room.settings = { impostors: 1, ...room.settings };
    return room;
  }
  save(room) {
    this.store.save(room.code, JSON.stringify(room), room.closedAt ? room.closedAt + ttl : this.now() + ttl);
  }
  session(room, member) {
    const token = randomToken(32), csrf = randomToken(24);
    this.store.addSession(hash(token), room.code, member.id, csrf);
    return { token, csrf, memberId: member.id, code: room.code };
  }
  auth(code, token) {
    fail(typeof token === 'string' && token.length >= 32 && token.length <= 100, 401, 'Entra a la sala para continuar.', 'SESSION_REQUIRED');
    const session = this.store.findSession(code, hash(token));
    fail(session, 401, 'Tu acceso a esta sala ya no está disponible. Vuelve a entrar.', 'SESSION_REQUIRED');
    const room = this.load(code), member = room.members.find(p => p.id === session.member_id && p.active);
    fail(member, 401, 'Ya no formas parte de esta sala.', 'SESSION_REQUIRED');
    return { member, csrf: session.csrf };
  }
  makeMember(name, color, isHost, participates = true) {
    fail(color === undefined || (Number.isInteger(color) && color >= 0 && color <= 5), 400, 'El color no es válido.');
    return { id: randomUUID(), name: cleanText(name, 24, 'El nombre'), color: color ?? 0, isHost, participates, active: true };
  }
  create({ name, color, playing = true, settings } = {}) {
    fail(typeof playing === 'boolean', 400, 'Elige si vas a jugar.');
    const member = this.makeMember(name, color, true, playing);
    const result = this.transaction(() => {
      fail(this.store.count() < 1000, 503, 'Hay muchas salas abiertas. Cierra una e inténtalo de nuevo.');
      const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let code;
      do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (this.store.has(code));
      const room = { code, phase: 'lobby', revision: 1, createdAt: this.now(), closedAt: null, recovered: false, members: [member], settings: validateSettings(settings), catalog: seedCatalog(), used: [], round: null, roundNumber: 0 };
      this.store.insert(code, JSON.stringify(room), this.now() + ttl);
      return this.session(room, member);
    });
    this.emit('change', result.code); return result;
  }
  join(code, { name, color } = {}) {
    const member = this.makeMember(name, color, false);
    const result = this.transaction(() => {
      const room = this.load(code);
      fail(room.phase !== 'closed', 410, 'Esta sala está cerrada. Puedes crear una nueva.', 'ROOM_CLOSED');
      const members = room.members.filter(p => p.active);
      fail(members.filter(p => p.participates).length < 24, 409, 'La sala ya tiene 24 jugadores. Crea otra para el siguiente grupo.');
      fail(!members.some(p => key(p.name) === key(member.name)), 409, 'Ese nombre ya está en la sala. Agrega un apellido o usa otro apodo.', 'DUPLICATE_NAME');
      room.members.push(member); room.revision++; this.save(room);
      return this.session(room, member);
    });
    this.emit('change', code); return result;
  }
  info(code) {
    const room = this.load(code);
    fail(room.phase !== 'closed', 410, 'Esta sala está cerrada.', 'ROOM_CLOSED');
    return { code, phase: room.phase, count: room.members.filter(m => m.active && m.participates).length };
  }
  catalog(code, memberId) {
    const room = this.load(code);
    fail(room.members.some(m => m.id === memberId && m.active && m.isHost), 403, 'Solo el anfitrión puede editar los conceptos.');
    fail(editablePhases.has(room.phase), 409, 'El catálogo se puede revisar entre rondas.');
    return { categories: CATEGORIES, concepts: room.catalog };
  }
  state(code, memberId, connected = () => false) {
    const room = this.load(code), me = room.members.find(m => m.id === memberId && m.active);
    fail(me, 401, 'Tu participación ya no está disponible.', 'SESSION_REQUIRED');
    const r = room.round;
    const inRound = Boolean(r?.players.includes(me.id));
    const round = r ? {
      id: r.id, number: r.number, playerCount: r.players.length,
      players: r.players.map(id => ({ id, ...r.names[id], ready: r.ready.includes(id), viewed: r.viewed.includes(id) })),
      readyCount: r.ready.length, viewedCount: r.viewed.length,
      vueltas: r.vueltas, turnIndex: r.turnIndex, totalTurns: r.players.length * r.vueltas,
      turn: room.phase === 'clues' || (room.phase === 'paused' && r.pausedFrom === 'clues') ? { playerId: r.order[r.turnIndex % r.order.length], vuelta: Math.floor(r.turnIndex / r.order.length) + 1, deadline: r.deadline, remaining: r.remaining } : null,
      ballotId: r.ballotId, voteCount: Object.keys(r.votes).length,
      candidates: r.candidates ?? r.players, firstTallies: room.phase === 'tie' ? r.firstTallies : null,
      pausedFrom: room.phase === 'paused' ? r.pausedFrom : null,
      result: room.phase === 'results' ? r.result : null,
    } : null;
    return {
      code: room.code, phase: room.phase, revision: room.revision, roundNumber: room.roundNumber, recovered: room.recovered, serverNow: this.now(), settings: room.settings,
      members: room.members.filter(m => m.active).map(({ id, name, color, isHost, participates }) => ({ id, name, color, isHost, participates, connected: connected(id) })),
      me: { id: me.id, name: me.name, color: me.color, isHost: me.isHost, participates: me.participates, inRound, viewed: inRound && r.viewed.includes(me.id), ready: inRound && r.ready.includes(me.id), voted: inRound && Object.hasOwn(r.votes, me.id) },
      round,
    };
  }
  privateCard(code, memberId, roundId) {
    this.perform(code, memberId, 'view', { roundId });
    const room = this.load(code), r = room.round;
    return impostorsOf(r).includes(memberId) ? { roundId: r.id, role: 'impostor' } : { roundId: r.id, role: 'player', concept: r.concept };
  }
  perform(code, memberId, action, body = {}) {
    let changed = true;
    this.transaction(() => {
      const room = this.load(code), me = room.members.find(m => m.id === memberId && m.active);
      fail(me, 401, 'Tu participación ya no está disponible.', 'SESSION_REQUIRED');
      fail(room.phase !== 'closed', 410, 'La sala está cerrada.', 'ROOM_CLOSED');
      const hostActions = new Set(['start', 'begin', 'advance', 'discussion', 'voting', 'close-vote', 'pause', 'resume', 'cancel', 'close', 'remove', 'settings', 'concept']);
      if (hostActions.has(action)) {
        fail(me.isHost, 403, 'Solo el anfitrión puede realizar esta acción.', 'HOST_REQUIRED');
        fail(Number.isInteger(body.revision) && body.revision === room.revision, 409, 'La sala cambió. Revisa el estado y vuelve a intentarlo.', 'STALE_STATE');
      }
      const r = room.round;
      if (['view', 'ready', 'vote', 'begin', 'advance', 'skip-turn', 'discussion', 'voting', 'close-vote', 'pause', 'resume', 'cancel'].includes(action)) {
        fail(r && body.roundId === r.id, 409, 'Esta acción pertenece a otra ronda.', 'STALE_ROUND');
      }
      switch (action) {
        case 'start': {
          fail(editablePhases.has(room.phase), 409, 'Ya hay una ronda en curso.');
          const players = room.members.filter(p => p.active && p.participates);
          const minimumPlayers = Math.max(4, room.settings.impostors * 2 + 1);
          fail(players.length >= minimumPlayers, 409, `Necesitamos al menos ${minimumPlayers} jugadores para ${room.settings.impostors === 1 ? 'comenzar' : `jugar con ${room.settings.impostors} impostores`}.`, 'MIN_PLAYERS');
          let pool = room.catalog.filter(c => c.enabled && room.settings.categories.includes(c.category));
          fail(pool.length > 0, 409, 'Activa al menos un concepto de las categorías elegidas.', 'EMPTY_CATALOG');
          const unused = pool.filter(c => !room.used.includes(c.id));
          if (unused.length) pool = unused;
          else { const last = room.used.at(-1); room.used = []; if (pool.length > 1) pool = pool.filter(c => c.id !== last); }
          const chosen = pool[this.rng(pool.length)]; room.used.push(chosen.id);
          const order = players.map(p => p.id);
          for (let i = order.length - 1; i > 0; i--) { const j = this.rng(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
          // Draw roles independently from the public clue order, without replacement.
          const available = players.map(p => p.id), impostorIds = [];
          for (let i = 0; i < room.settings.impostors; i++) impostorIds.push(available.splice(this.rng(available.length), 1)[0]);
          room.roundNumber++;
          room.round = { id: randomUUID(), number: room.roundNumber, players: players.map(p => p.id), names: Object.fromEntries(players.map(({ id, name, color }) => [id, { name, color }])), concept: chosen.word, impostorId: impostorIds[0], impostorIds, order, vueltas: room.settings.vueltas, seconds: room.settings.seconds, viewed: [], ready: [], turnIndex: 0, deadline: null, remaining: null, pausedFrom: null, ballotId: 0, votes: {}, candidates: null, firstTallies: null, result: null };
          room.phase = 'reveal'; room.recovered = false; break;
        }
        case 'view':
          fail(activePhases.has(room.phase) && r.players.includes(me.id), 403, 'Tu tarjeta estará disponible cuando juegues una ronda.');
          if (r.viewed.includes(me.id)) changed = false; else r.viewed.push(me.id);
          break;
        case 'ready':
          fail(room.phase === 'reveal' && r.players.includes(me.id) && r.viewed.includes(me.id), 409, 'Mira tu tarjeta antes de confirmar.');
          if (r.ready.includes(me.id)) changed = false; else r.ready.push(me.id);
          break;
        case 'begin':
          fail(room.phase === 'reveal' && r.ready.length === r.players.length, 409, 'Todavía falta que alguien revise y confirme su tarjeta.');
          room.phase = 'clues'; r.deadline = r.seconds ? this.now() + r.seconds * 1000 : null; break;
        case 'skip-turn':
        case 'advance':
          fail(room.phase === 'clues', 409, 'Los turnos no están activos.');
          if (action === 'skip-turn') {
            fail(Number.isInteger(body.turnIndex) && body.turnIndex === r.turnIndex, 409, 'Ese turno ya cambió. Revisa a quién le toca.', 'STALE_TURN');
            fail(r.order[r.turnIndex % r.order.length] === me.id, 403, 'Solo puedes pasar tu propio turno.', 'TURN_REQUIRED');
            fail(Number.isInteger(body.revision) && body.revision === room.revision, 409, 'La sala cambió. Revisa el estado y vuelve a intentarlo.', 'STALE_STATE');
          }
          r.turnIndex++;
          if (r.turnIndex >= r.players.length * r.vueltas) { room.phase = 'discussion'; r.deadline = null; }
          else r.deadline = r.seconds ? this.now() + r.seconds * 1000 : null;
          break;
        case 'discussion':
          fail(room.phase === 'clues' && body.confirm === true, 409, 'Confirma que quieres terminar las pistas antes de tiempo.', 'CONFIRM_REQUIRED');
          room.phase = 'discussion'; r.deadline = null; break;
        case 'voting':
          fail(room.phase === 'discussion', 409, 'Primero terminen las pistas y conversen.');
          room.phase = 'voting'; r.votes = {}; r.ballotId = 1; r.candidates = null; break;
        case 'vote': {
          fail(r.players.includes(me.id), 403, 'Podrás votar en la próxima ronda.');
          fail(body.ballotId === r.ballotId, 409, 'La votación cambió. Revisa las opciones.', 'STALE_BALLOT');
          if (Object.hasOwn(r.votes, me.id)) {
            fail(r.votes[me.id] === body.targetId, 409, 'Tu voto ya está confirmado y no se puede cambiar.', 'ALREADY_VOTED');
            changed = false; break;
          }
          fail(room.phase === 'voting' || room.phase === 'tie', 409, 'La votación no está abierta.');
          fail(body.targetId !== me.id && (r.candidates ?? r.players).includes(body.targetId), 400, 'Elige a otra persona de la lista.');
          r.votes[me.id] = body.targetId;
          if (Object.keys(r.votes).length === r.players.length) this.finishVote(room);
          break;
        }
        case 'close-vote':
          fail(room.phase === 'voting' || room.phase === 'tie', 409, 'La votación no está abierta.');
          fail(Object.keys(r.votes).length > 0, 409, 'Debe haber al menos un voto para cerrar.');
          fail(Object.keys(r.votes).length === r.players.length || body.confirm === true, 409, 'Todavía faltan votos. Confirma si quieres cerrar de todas formas.', 'PENDING_VOTES');
          this.finishVote(room); break;
        case 'pause':
          fail(activePhases.has(room.phase) && room.phase !== 'paused', 409, 'La ronda no se puede pausar ahora.');
          r.pausedFrom = room.phase; r.remaining = r.deadline == null ? null : Math.max(0, r.deadline - this.now()); r.deadline = null; room.phase = 'paused'; break;
        case 'resume':
          fail(room.phase === 'paused' && r.pausedFrom, 409, 'La ronda no está pausada.');
          room.phase = r.pausedFrom; r.deadline = room.phase === 'clues' && r.remaining !== null ? this.now() + r.remaining : null; r.pausedFrom = null; room.recovered = false; break;
        case 'cancel':
          fail(activePhases.has(room.phase), 409, 'No hay una ronda en curso.');
          fail(body.confirm === true, 409, 'Confirma que quieres cancelar esta ronda.', 'CONFIRM_REQUIRED');
          room.phase = 'lobby'; room.round = null; room.recovered = false; break;
        case 'close':
          fail(body.confirm === true, 409, 'Confirma que quieres cerrar la sala.', 'CONFIRM_REQUIRED');
          room.phase = 'closed'; room.closedAt = this.now(); room.round = null; break;
        case 'settings':
          fail(editablePhases.has(room.phase), 409, 'La configuración se cambia entre rondas.');
          room.settings = validateSettings(body.settings, room.settings);
          if (body.playing !== undefined) {
            fail(typeof body.playing === 'boolean', 400, 'Elige si vas a jugar.');
            fail(!body.playing || room.members.filter(m => m.active && m.participates && m.id !== me.id).length < 24, 409, 'La sala ya tiene 24 jugadores.');
            me.participates = body.playing;
          }
          break;
        case 'concept': {
          fail(editablePhases.has(room.phase), 409, 'Los conceptos se cambian entre rondas.');
          const word = cleanText(body.word, 48, 'El concepto');
          fail(CATEGORIES.some(c => c.id === body.category), 400, 'La categoría no es válida.');
          fail(typeof body.enabled === 'boolean', 400, 'Indica si el concepto está disponible.');
          fail(!room.catalog.some(c => c.id !== body.id && c.category === body.category && key(c.word) === key(word)), 409, 'Ese concepto ya está en esta categoría.');
          if (body.id) {
            const c = room.catalog.find(c => c.id === body.id); fail(c, 404, 'No encontramos ese concepto.');
            Object.assign(c, { word, category: body.category, enabled: body.enabled });
          } else {
            fail(room.catalog.length < 200, 409, 'Puedes guardar hasta 200 conceptos por sala.');
            room.catalog.push({ id: randomUUID(), word, category: body.category, enabled: body.enabled });
          }
          break;
        }
        case 'remove': {
          const target = room.members.find(p => p.id === body.memberId && p.active);
          fail(target && target.id !== me.id, 400, 'Elige a otro participante.');
          fail(editablePhases.has(room.phase) || !r?.players.includes(target.id), 409, 'Para retirar a alguien que está jugando, cancela primero la ronda.');
          target.active = false;
          room.members = room.members.filter(p => p.id !== target.id);
          this.store.deleteSessions(code, target.id); break;
        }
        case 'leave':
          fail(!me.isHost, 409, 'Como anfitrión, debes cerrar la sala para terminar.');
          fail(editablePhases.has(room.phase) || !r?.players.includes(me.id), 409, 'Pide al anfitrión que cancele la ronda antes de salir.');
          room.members = room.members.filter(p => p.id !== me.id); this.store.deleteSessions(code, me.id); break;
        default: throw new GameError(404, 'Esta acción no existe.');
      }
      if (changed) { room.revision++; this.save(room); }
    });
    if (changed) this.emit('change', code);
  }
  finishVote(room) {
    const r = room.round, candidates = r.candidates ?? r.players;
    const tallies = Object.fromEntries(candidates.map(id => [id, 0]));
    for (const target of Object.values(r.votes)) tallies[target]++;
    const highest = Math.max(...Object.values(tallies));
    const leaders = candidates.filter(id => tallies[id] === highest);
    if (leaders.length > 1 && room.phase === 'voting') {
      r.firstTallies = tallies; r.candidates = leaders; r.votes = {}; r.ballotId++; room.phase = 'tie'; return;
    }
    const accusedId = leaders.length === 1 ? leaders[0] : null;
    const impostorIds = impostorsOf(r), found = impostorIds.includes(accusedId);
    r.result = { winner: found ? 'group' : 'impostor', reason: accusedId === null ? 'persistent_tie' : found ? 'found' : 'wrong_person', impostorId: r.impostorId, impostorIds, accusedId, concept: r.concept, tallies: Object.fromEntries(r.players.map(id => [id, tallies[id] ?? 0])), totalVotes: Object.keys(r.votes).length, expectedVotes: r.players.length, firstTallies: r.firstTallies };
    room.phase = 'results'; r.deadline = null;
  }
}
