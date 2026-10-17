import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameEngine } from '../server/engine.mjs';

function fixture(t, options = {}) {
  let clock = 1000000;
  const engine = new GameEngine({ now: () => clock, rng: n => n - 1, ...options });
  t.after(() => engine.close());
  const host = engine.create({ name: 'Vale', playing: options.playing ?? true });
  const code = host.code;
  const guests = ['Fran', 'Dani', 'Nico', ...(options.playing === false ? ['Paz'] : [])].map(name => engine.join(code, { name }));
  const people = [host, ...guests], state = who => engine.state(code, (who ?? host).memberId);
  const act = (action, body = {}, who = host) => { const s = state(); return engine.perform(code, who.memberId, action, { revision: s.revision, roundId: s.round?.id, ballotId: s.round?.ballotId, turnIndex: s.round?.turnIndex, ...body }); };
  const start = () => act('start');
  const ready = () => { for (const p of people.filter(p => state(p).me.inRound)) { engine.privateCard(code, p.memberId, state().round.id); act('ready', {}, p); } act('begin'); };
  const voting = () => { if (state().phase === 'lobby') start(); if (state().phase === 'reveal') ready(); act('discussion', { confirm: true }); act('voting'); };
  return { engine, code, host, guests, people, state, act, start, ready, voting, tick: n => { clock += n; } };
}
function rejects(fn, status, code) { assert.throws(fn, e => e.status === status && (!code || e.code === code)); }

test('names, colors and settings are validated; normalized duplicate names cannot take over a session', t => {
  const f = fixture(t);
  rejects(() => f.engine.join(f.code, { name: '  VÁLE ' }), 409, 'DUPLICATE_NAME');
  rejects(() => f.engine.join(f.code, { name: '<script>' }), 400);
  rejects(() => f.engine.join(f.code, { name: 'Test', color: 100 }), 400);
  rejects(() => f.act('settings', { settings: { vueltas: 100 } }), 400);
  rejects(() => f.act('settings', { settings: { categories: [] } }), 400);
  rejects(() => f.act('settings', { settings: { impostorId: f.host.memberId } }), 400);
});
test('exactly one impostor, all other cards share a concept; shared snapshots never expose secrets', t => {
  const f = fixture(t); f.start();
  const cards = f.people.map(p => f.engine.privateCard(f.code, p.memberId, f.state().round.id));
  assert.equal(cards.filter(c => c.role === 'impostor').length, 1);
  const concept = cards.find(c => c.concept).concept;
  assert.equal(new Set(cards.filter(c => c.role === 'player').map(c => c.concept)).size, 1);
  for (const p of f.people) {
    const serialized = JSON.stringify(f.state(p));
    assert.ok(!serialized.includes(concept)); assert.ok(!serialized.includes('impostorId')); assert.ok(!serialized.includes('token_hash')); assert.ok(!serialized.includes('"role"'));
  }
  assert.equal(cards.find(c => c.role === 'impostor').concept, undefined);
  assert.deepEqual(f.engine.privateCard(f.code, f.host.memberId, f.state().round.id), cards[0]);
});
test('impostor count is validated on creation and settings, with a default of one', t => {
  const f = fixture(t);
  assert.equal(f.state().settings.impostors, 1);
  for (const impostors of [0, -1, 12, 1.5, '2', null, true]) {
    rejects(() => f.engine.create({ name: 'Invalid', settings: { impostors } }), 400);
    rejects(() => f.act('settings', { settings: { impostors } }), 400);
  }
  const h = f.engine.create({ name: 'Otra', settings: { impostors: 3 } });
  assert.equal(f.engine.state(h.code, h.memberId).settings.impostors, 3);
});
test('configured roles are unique and private for two, three and eleven impostors', t => {
  for (const impostors of [2, 3, 11]) {
    const f = fixture(t, { playing: false });
    f.act('settings', { settings: { impostors } });
    const minimum = 2 * impostors + 1;
    while (f.state().members.filter(p => p.participates).length < minimum - 1) f.people.push(f.engine.join(f.code, { name: `Extra ${f.people.length}` }));
    rejects(() => f.start(), 409, 'MIN_PLAYERS');
    f.people.push(f.engine.join(f.code, { name: 'Última' }));
    f.start();
    const cards = f.people.slice(1).map(p => f.engine.privateCard(f.code, p.memberId, f.state().round.id));
    assert.equal(cards.filter(c => c.role === 'impostor').length, impostors);
    assert.equal(new Set(f.engine.load(f.code).round.impostorIds).size, impostors);
    assert.equal(new Set(cards.filter(c => c.role === 'player').map(c => c.concept)).size, 1);
    assert.ok(cards.filter(c => c.role === 'impostor').every(c => !Object.hasOwn(c, 'concept')));
    assert.ok(!JSON.stringify(f.state()).includes('impostorId'));
    rejects(() => f.engine.privateCard(f.code, f.host.memberId, f.state().round.id), 403);
    rejects(() => f.act('settings', { settings: { impostors: 1 } }), 409);
  }
});
test('finding any configured impostor wins; an innocent accusation loses; count can change next round', t => {
  for (const findImpostor of [true, false]) {
    const f = fixture(t);
    f.people.push(f.engine.join(f.code, { name: 'Paz' }));
    f.act('settings', { settings: { impostors: 2 } }); f.voting();
    const ids = f.engine.load(f.code).round.impostorIds;
    const target = findImpostor ? ids[1] : f.people.find(p => !ids.includes(p.memberId)).memberId;
    for (const p of f.people) f.act('vote', { targetId: p.memberId === target ? f.people.find(x => x.memberId !== target).memberId : target }, p);
    const result = f.state().round.result;
    assert.equal(result.winner, findImpostor ? 'group' : 'impostor');
    assert.equal(result.reason, findImpostor ? 'found' : 'wrong_person');
    assert.deepEqual(result.impostorIds, ids);
    f.act('settings', { settings: { impostors: 1 } }); f.start();
    assert.equal(f.people.map(p => f.engine.privateCard(f.code, p.memberId, f.state().round.id)).filter(c => c.role === 'impostor').length, 1);
  }
});
test('legacy rooms and in-progress rounds retain their original single impostor', t => {
  const f = fixture(t); f.start();
  const original = f.people.map(p => f.engine.privateCard(f.code, p.memberId, f.state().round.id));
  const room = f.engine.load(f.code);
  delete room.settings.impostors; delete room.round.impostorIds; f.engine.save(room);
  assert.equal(f.state().settings.impostors, 1);
  assert.deepEqual(f.people.map(p => f.engine.privateCard(f.code, p.memberId, f.state().round.id)), original);
  f.voting();
  const impostor = room.round.impostorId;
  for (const p of f.people) f.act('vote', { targetId: p.memberId === impostor ? f.host.memberId : impostor }, p);
  assert.equal(f.state().round.result.winner, 'group');
  assert.deepEqual(f.state().round.result.impostorIds, [impostor]);
});
test('a spectator host receives no role and cannot read any card; four real players are required', t => {
  const f = fixture(t, { playing: false }); f.start();
  assert.equal(f.state().round.playerCount, 4); assert.equal(f.state().me.inRound, false);
  rejects(() => f.engine.privateCard(f.code, f.host.memberId, f.state().round.id), 403);
  assert.equal(f.people.slice(1).map(p => f.engine.privateCard(f.code, p.memberId, f.state().round.id)).filter(c => c.role === 'impostor').length, 1);
});
test('minimum players and empty category checks cannot be bypassed', t => {
  const e = new GameEngine(); t.after(() => e.close()); const h = e.create({ name: 'H' });
  rejects(() => e.perform(h.code, h.memberId, 'start', { revision: 1 }), 409, 'MIN_PLAYERS');
  for (const name of ['A', 'B', 'C']) e.join(h.code, { name });
  let s = e.state(h.code, h.memberId);
  e.perform(h.code, h.memberId, 'settings', { revision: s.revision, settings: { categories: ['family'] } });
  s = e.state(h.code, h.memberId);
  rejects(() => e.perform(h.code, h.memberId, 'start', { revision: s.revision }), 409, 'EMPTY_CATALOG');
});
test('host permission is checked before mutations; identities in the body do not grant control', t => {
  const f = fixture(t);
  for (const action of ['start', 'settings', 'concept', 'close', 'remove']) rejects(() => f.act(action, { isHost: true, memberId: f.host.memberId, confirm: true }, f.guests[0]), 403, 'HOST_REQUIRED');
  assert.equal(f.state().phase, 'lobby');
  rejects(() => f.engine.catalog(f.code, f.guests[0].memberId), 403);
});
test('cross-room sessions and member IDs are rejected', t => {
  const f = fixture(t), other = f.engine.create({ name: 'Otra sala' });
  rejects(() => f.engine.auth(f.code, other.token), 401);
  rejects(() => f.engine.auth(other.code, f.host.token), 401);
  rejects(() => f.engine.state(f.code, other.memberId), 401);
  rejects(() => f.engine.perform(f.code, other.memberId, 'close', { confirm: true, revision: f.state().revision }), 401);
});
test('stale revision prevents double-start and stale round commands cannot affect a later round', t => {
  const f = fixture(t), revision = f.state().revision; f.start();
  const roundId = f.state().round.id;
  rejects(() => f.engine.perform(f.code, f.host.memberId, 'start', { revision }), 409, 'STALE_STATE');
  f.act('cancel', { confirm: true }); f.start();
  assert.notEqual(f.state().round.id, roundId);
  rejects(() => f.act('view', { roundId }, f.guests[0]), 409, 'STALE_ROUND');
});
test('all players must see and acknowledge their card before clues begin', t => {
  const f = fixture(t); f.start();
  rejects(() => f.act('ready'), 409); rejects(() => f.act('begin'), 409);
  for (const p of f.people) { f.engine.privateCard(f.code, p.memberId, f.state().round.id); f.act('ready', {}, p); f.act('ready', {}, p); }
  assert.equal(f.state().round.readyCount, 4); f.act('begin'); assert.equal(f.state().phase, 'clues');
});
test('two complete clue turns, timer pause and resume, and transition into discussion', t => {
  const f = fixture(t); f.start(); f.ready(); const first = f.state();
  assert.equal(first.round.totalTurns, 8);
  f.tick(5000); f.act('pause'); assert.equal(f.state().round.turn.remaining, 15000);
  f.tick(100000); f.act('resume'); assert.equal(f.state().round.turn.deadline - f.state().serverNow, 15000);
  for (let i = 0; i < 8; i++) f.act('advance');
  assert.equal(f.state().phase, 'discussion'); rejects(() => f.act('advance'), 409);
});
test('each current player can pass their own turn, reset its timer and complete both laps', t => {
  for (const seconds of [20, 0]) {
    const f = fixture(t); f.act('settings', { settings: { seconds } }); f.start(); f.ready();
    for (let i = 0; i < 8; i++) {
      const before = f.state(), player = f.people.find(p => p.memberId === before.round.turn.playerId);
      f.tick(i % 2 ? 25000 : 2000);
      f.act('skip-turn', {}, player);
      const after = f.state(); assert.equal(after.round.turnIndex, i + 1);
      if (i < 7) {
        assert.equal(after.phase, 'clues');
        assert.equal(after.round.turn.deadline, seconds ? after.serverNow + seconds * 1000 : null);
      } else { assert.equal(after.phase, 'discussion'); assert.equal(after.round.turn, null); }
    }
  }
});
test('other players, late arrivals and a spectator host cannot pass somebody else’s turn', t => {
  const f = fixture(t, { playing: false }); f.start(); f.ready();
  const late = f.engine.join(f.code, { name: 'Cami' }), before = f.state();
  const others = [...f.people, late].filter(p => p.memberId !== before.round.turn.playerId);
  for (const p of others) rejects(() => f.act('skip-turn', { memberId: before.round.turn.playerId, isHost: true }, p), 403, 'TURN_REQUIRED');
  rejects(() => f.act('advance', {}, f.guests[0]), 403, 'HOST_REQUIRED');
  assert.equal(f.state().round.turnIndex, 0);
  f.act('advance'); assert.equal(f.state().round.turnIndex, 1);
});
test('passing requires the active phase, matching round and explicit turn context', t => {
  const f = fixture(t); f.start();
  rejects(() => f.act('skip-turn'), 409);
  f.ready(); const player = f.people.find(p => p.memberId === f.state().round.turn.playerId);
  for (const turnIndex of [undefined, '0', -1, 1]) rejects(() => f.act('skip-turn', { turnIndex }, player), 409, 'STALE_TURN');
  rejects(() => f.act('skip-turn', { roundId: 'another-round' }, player), 409, 'STALE_ROUND');
  rejects(() => f.act('skip-turn', { revision: f.state().revision - 1 }, player), 409, 'STALE_STATE');
  f.act('pause'); rejects(() => f.act('skip-turn', {}, player), 409);
  f.act('resume'); f.act('skip-turn', {}, player); assert.equal(f.state().round.turnIndex, 1);
  const oldRoundId = f.state().round.id;
  f.act('cancel', { confirm: true }); f.start(); f.ready();
  rejects(() => f.act('skip-turn', { roundId: oldRoundId }, player), 409, 'STALE_ROUND');
});
test('simultaneous host and player advances or repeated clicks consume only one turn', t => {
  for (const winner of ['advance', 'skip-turn']) {
    const f = fixture(t); f.start(); f.ready(); f.act('advance');
    const s = f.state(), player = f.people.find(p => p.memberId === s.round.turn.playerId);
    const body = { revision: s.revision, roundId: s.round.id, turnIndex: s.round.turnIndex };
    const submit = action => f.engine.perform(f.code, (action === 'advance' ? f.host : player).memberId, action, body);
    submit(winner);
    rejects(() => submit(winner), 409);
    rejects(() => submit(winner === 'advance' ? 'skip-turn' : 'advance'), 409);
    assert.equal(f.state().round.turnIndex, s.round.turnIndex + 1);
    for (let i = 0; i < 3; i++) f.act('advance');
    assert.equal(f.state().round.turn.playerId, player.memberId);
    rejects(() => f.act('skip-turn', { turnIndex: body.turnIndex }, player), 409, 'STALE_TURN');
    assert.equal(f.state().round.turnIndex, 5);
  }
});
test('late arrivals get no card or vote and become eligible in the next round', t => {
  const f = fixture(t); f.start(); const late = f.engine.join(f.code, { name: 'Cami' });
  assert.equal(f.state(late).me.inRound, false); assert.equal(f.state().round.playerCount, 4);
  rejects(() => f.engine.privateCard(f.code, late.memberId, f.state().round.id), 403);
  f.ready(); f.act('discussion', { confirm: true }); f.act('voting');
  rejects(() => f.act('vote', { targetId: f.host.memberId }, late), 403);
  f.act('cancel', { confirm: true }); f.start(); assert.equal(f.state(late).me.inRound, true);
});
test('vote privacy, one vote per person, safe retry, no self vote and valid targets', t => {
  const f = fixture(t); f.voting(); const p = f.guests[0];
  rejects(() => f.act('vote', { targetId: p.memberId }, p), 400);
  rejects(() => f.act('vote', { targetId: 'made-up' }, p), 400);
  f.act('vote', { targetId: f.host.memberId }, p);
  f.act('vote', { targetId: f.host.memberId }, p);
  assert.equal(f.state().round.voteCount, 1);
  rejects(() => f.act('vote', { targetId: f.guests[1].memberId }, p), 409, 'ALREADY_VOTED');
  assert.equal(f.state().round.result, null); assert.equal(f.state().round.votes, undefined); assert.equal(f.state().round.tallies, undefined);
});
test('a majority identifying the impostor yields a group victory with exactly four votes', t => {
  const f = fixture(t); f.voting(); const imp = f.engine.load(f.code).round.impostorId;
  for (const p of f.people) f.act('vote', { targetId: p.memberId === imp ? f.host.memberId : imp }, p);
  const s = f.state(); assert.equal(s.phase, 'results'); assert.equal(s.round.result.winner, 'group'); assert.equal(s.round.result.totalVotes, 4); assert.equal(s.round.result.impostorId, imp);
});
test('wrong accusation yields impostor victory', t => {
  const f = fixture(t); f.voting();
  for (const p of f.people) f.act('vote', { targetId: p.memberId === f.host.memberId ? f.guests[0].memberId : f.host.memberId }, p);
  assert.equal(f.state().round.result.winner, 'impostor'); assert.equal(f.state().round.result.reason, 'wrong_person');
});
test('tie opens a fresh ballot limited to tied candidates; persistent tie awards impostor', t => {
  const f = fixture(t); f.voting(); const [a, b, c, d] = f.people;
  for (const [p, target] of [[a, c], [b, d], [c, d], [d, c]]) f.act('vote', { targetId: target.memberId }, p);
  assert.equal(f.state().phase, 'tie'); assert.equal(f.state().round.ballotId, 2); assert.equal(f.state().round.voteCount, 0);
  rejects(() => f.act('vote', { targetId: a.memberId }, b), 400);
  rejects(() => f.act('vote', { targetId: c.memberId, ballotId: 1 }, a), 409, 'STALE_BALLOT');
  for (const [p, target] of [[a, c], [b, d], [c, d], [d, c]]) f.act('vote', { targetId: target.memberId }, p);
  assert.equal(f.state().round.result.reason, 'persistent_tie'); assert.equal(f.state().round.result.winner, 'impostor');
});
test('closing an incomplete ballot requires explicit confirmation and at least one vote', t => {
  const f = fixture(t); f.voting(); rejects(() => f.act('close-vote', { confirm: true }), 409);
  f.act('vote', { targetId: f.guests[0].memberId }); rejects(() => f.act('close-vote'), 409, 'PENDING_VOTES');
  f.act('close-vote', { confirm: true }); assert.equal(f.state().phase, 'results'); assert.equal(f.state().round.result.totalVotes, 1);
});
test('catalog editing is host-only, cannot leak chosen concept during a round and avoids repeats', t => {
  const f = fixture(t);
  f.act('concept', { word: 'La mascota', category: 'family', enabled: true });
  rejects(() => f.act('concept', { word: 'LA MÁSCOTA', category: 'family', enabled: true }), 409);
  f.start(); const first = f.engine.load(f.code).round.concept;
  rejects(() => f.engine.catalog(f.code, f.host.memberId), 409);
  rejects(() => f.act('concept', { word: 'Otra', category: 'baby', enabled: true }), 409);
  f.act('cancel', { confirm: true }); f.start(); assert.notEqual(f.engine.load(f.code).round.concept, first);
});
test('removal revokes session; active players require cancellation before removal or leave', t => {
  const f = fixture(t), guest = f.guests[0]; f.start();
  rejects(() => f.act('remove', { memberId: guest.memberId }), 409);
  rejects(() => f.act('leave', {}, guest), 409);
  f.act('cancel', { confirm: true }); f.act('remove', { memberId: guest.memberId });
  rejects(() => f.engine.auth(f.code, guest.token), 401); assert.equal(f.state().members.length, 3);
});
test('24-player cap, closed room and room expiry are enforced', t => {
  const f = fixture(t);
  for (let i = 4; i < 24; i++) f.engine.join(f.code, { name: `Persona ${i}` });
  rejects(() => f.engine.join(f.code, { name: 'Una más' }), 409);
  f.act('close', { confirm: true }); assert.equal(f.state().phase, 'closed');
  rejects(() => f.engine.join(f.code, { name: 'Después' }), 410);
  f.tick(86400001); assert.equal(f.engine.cleanup(), 1); rejects(() => f.state(), 404);
});
test('repeated leave and rejoin does not accumulate inactive identities or valid old tokens', t => {
  const f = fixture(t);
  for (let i = 0; i < 40; i++) {
    const guest = f.engine.join(f.code, { name: 'Invitada temporal' });
    f.act('leave', {}, guest);
    rejects(() => f.engine.auth(f.code, guest.token), 401);
  }
  assert.equal(f.engine.load(f.code).members.length, 4);
  assert.equal(f.engine.db.prepare('SELECT count(*) AS n FROM sessions WHERE room_code = ?').get(f.code).n, 4);
});
test('SQLite restart retains tokens, roles and votes, and pauses the round for safe recovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'colomba-persist-')), path = join(dir, 'game.sqlite');
  let e = new GameEngine({ dbPath: path });
  try {
    const h = e.create({ name: 'Host' }); const people = [h, ...['A', 'B', 'C'].map(name => e.join(h.code, { name }))];
    const act = (action, body = {}, who = h) => { const s = e.state(h.code, h.memberId); e.perform(h.code, who.memberId, action, { revision: s.revision, roundId: s.round?.id, ballotId: s.round?.ballotId, ...body }); };
    act('start'); const roundId = e.state(h.code, h.memberId).round.id;
    const cards = people.map(p => { const card = e.privateCard(h.code, p.memberId, roundId); act('ready', {}, p); return card; });
    act('begin'); act('discussion', { confirm: true }); act('voting'); act('vote', { targetId: people[1].memberId });
    e.close(); e = new GameEngine({ dbPath: path });
    assert.equal(e.auth(h.code, h.token).member.id, h.memberId); assert.equal(e.state(h.code, h.memberId).phase, 'paused'); assert.equal(e.state(h.code, h.memberId).round.voteCount, 1);
    people.forEach((p, i) => assert.deepEqual(e.privateCard(h.code, p.memberId, roundId), cards[i]));
    act('resume'); assert.equal(e.state(h.code, h.memberId).phase, 'voting');
  } finally { e.close(); rmSync(dir, { recursive: true, force: true }); }
});
