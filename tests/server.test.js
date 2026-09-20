import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
import { PIECES } from '../shared/rules.js';

async function client(url) {
  const socket = new WebSocket(url);
  const inbox = [];
  const pending = new Set();
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    const waiter = [...pending].find(w => w.predicate(message));
    if (waiter) {
      pending.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else inbox.push(message);
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return {
    socket,
    send: message => socket.send(JSON.stringify(message)),
    next(predicate, timeout = 5000) {
      const index = inbox.findIndex(predicate);
      if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => { pending.delete(waiter); reject(new Error('Timed out waiting for server message.')); }, timeout);
        pending.add(waiter);
      });
    },
    close: () => new Promise(resolve => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      socket.once('close', resolve);
      socket.close();
    }),
  };
}

async function arena(t, options) {
  const app = createGameServer(options);
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const url = `ws://127.0.0.1:${address.port}`;
  const white = await client(url);
  const black = await client(url);
  white.send({ type: 'create', name: 'White tester', piece: 'rook' });
  const whiteWelcome = await white.next(m => m.type === 'welcome');
  black.send({ type: 'join', code: whiteWelcome.code, name: 'Black tester', piece: 'rook' });
  const blackWelcome = await black.next(m => m.type === 'welcome');
  return { app, url, white, black, whiteWelcome, blackWelcome };
}

async function start(a) {
  a.white.send({ type: 'ready' });
  a.black.send({ type: 'ready' });
  return (await a.white.next(m => m.type === 'state' && m.state.phase === 'playing')).state;
}

test('two humans share one authoritative room; invalid movement and third players are rejected', async t => {
  const a = await arena(t);
  const outsider = await client(a.url);
  outsider.send({ type: 'join', code: a.whiteWelcome.code, name: 'Third player' });
  assert.match((await outsider.next(m => m.type === 'error')).message, /two players/);
  const state = await start(a);
  assert.equal(state.players.length, 2);
  assert.deepEqual(state.players.map(p => p.color), ['white', 'black']);
  assert.ok(state.players.every(p => !Object.hasOwn(p, 'token')));

  a.white.send({ type: 'move', x: 4, z: 5 });
  assert.match((await a.white.next(m => m.type === 'error')).message, /not a legal move/);
  a.white.send({ type: 'move', x: 3, z: 4 });
  const move = await a.black.next(m => m.type === 'event' && m.event.type === 'move');
  assert.deepEqual(move.event.from, { x: 3, z: 6 });
  assert.deepEqual(move.event.to, { x: 3, z: 4 });
  const movedState = (await a.black.next(m => m.type === 'state' && m.state.players[0].z === 4)).state;
  assert.equal(movedState.players[0].hasMoved, true);
  assert.ok(movedState.players[0].moveReadyAt > movedState.serverTime);
  a.white.send({ type: 'move', x: 3, z: 3 });
  assert.match((await a.white.next(m => m.type === 'error')).message, /in progress|cooling down/);
  await delay(PIECES.rook.moveDuration + 60);
  a.white.send({ type: 'move', x: 3, z: 3 });
  assert.match((await a.white.next(m => m.type === 'error')).message, /cooling down/);
});

test('attacks enforce patterns, windup locks, damage, and dodging the locked target', { timeout: 10_000 }, async t => {
  const a = await arena(t);
  await start(a);
  a.white.send({ type: 'attack', x: 4, z: 1 });
  assert.match((await a.white.next(m => m.type === 'error')).message, /legal capture pattern/);
  a.white.send({ type: 'move', x: 4, z: 6 });
  await a.white.next(m => m.type === 'event' && m.event.type === 'move');
  await delay(PIECES.rook.moveDuration + 60);
  a.white.send({ type: 'attack', x: 4, z: 1 });
  const firstAttack = (await a.white.next(m => m.type === 'event' && m.event.type === 'attack')).event;
  a.white.send({ type: 'move', x: 3, z: 6 });
  assert.match((await a.white.next(m => m.type === 'error')).message, /in progress/);
  const hit = (await a.black.next(m => m.type === 'event' && m.event.type === 'hit')).event;
  assert.equal(hit.hit, true);
  assert.equal(hit.damage, PIECES.rook.damage);
  assert.equal(hit.hp, PIECES.rook.maxHp - PIECES.rook.damage);
  await delay(PIECES.rook.attackCooldown - PIECES.rook.windup + 70);
  a.white.send({ type: 'attack', x: 4, z: 1 });
  await a.black.next(m => m.type === 'event' && m.event.type === 'attack' && m.event.startAt > firstAttack.startAt);
  a.black.send({ type: 'move', x: 5, z: 1 });
  await a.black.next(m => m.type === 'event' && m.event.type === 'move' && m.event.playerId === a.blackWelcome.playerId);
  const miss = (await a.black.next(m => m.type === 'event' && m.event.type === 'hit')).event;
  assert.equal(miss.hit, false);
  assert.equal(miss.damage, 0);
  assert.equal(miss.hp, PIECES.rook.maxHp - PIECES.rook.damage);
});

test('reconnect tokens, disconnect forfeits, and mutual rematches preserve the two-player session', async t => {
  const a = await arena(t, { disconnectGraceMs: 250 });
  const initial = await start(a);
  await a.black.close();
  await a.white.next(m => m.type === 'event' && m.event.type === 'disconnect');
  const resumed = await client(a.url);
  resumed.send({ type: 'resume', code: a.blackWelcome.code, token: a.blackWelcome.token });
  const welcome = await resumed.next(m => m.type === 'welcome');
  assert.equal(welcome.playerId, a.blackWelcome.playerId);
  const reconnectState = (await resumed.next(m => m.type === 'state')).state;
  assert.equal(reconnectState.players[1].connected, true);
  assert.equal(reconnectState.phase, 'playing');
  await resumed.close();
  const finished = (await a.white.next(m => m.type === 'state' && m.state.phase === 'finished')).state;
  assert.equal(finished.winner, 'white');
  const returned = await client(a.url);
  returned.send({ type: 'resume', code: a.blackWelcome.code, token: a.blackWelcome.token });
  await returned.next(m => m.type === 'welcome');
  a.white.send({ type: 'rematch' });
  returned.send({ type: 'rematch' });
  const rematch = (await a.white.next(m => m.type === 'state' && m.state.phase === 'playing' && m.state.startedAt > initial.startedAt)).state;
  assert.equal(rematch.winner, null);
  assert.ok(rematch.players.every(p => p.hp === p.maxHp && p.connected));
});

test('forward-only pawns that pass each other finish in a dead-position draw', async t => {
  const a = await arena(t);
  a.white.send({ type: 'select', piece: 'pawn' });
  a.black.send({ type: 'select', piece: 'pawn' });
  await start(a);
  a.white.send({ type: 'move', x: 3, z: 4 });
  a.black.send({ type: 'move', x: 4, z: 3 });
  await a.white.next(m => m.type === 'state' && m.state.players[0].z === 4 && m.state.players[1].z === 3);
  await delay(PIECES.pawn.moveCooldown + 60);
  a.white.send({ type: 'move', x: 3, z: 3 });
  a.black.send({ type: 'move', x: 4, z: 4 });
  const finished = (await a.white.next(m => m.type === 'state' && m.state.phase === 'finished')).state;
  assert.equal(finished.winner, 'draw');
  assert.ok(finished.players.every(p => p.hp === p.maxHp));
});

test('both players disconnecting expires into a resumable draw with a valid winner value', async t => {
  const a = await arena(t, { disconnectGraceMs: 150 });
  await start(a);
  await Promise.all([a.white.close(), a.black.close()]);
  await delay(230);
  const resumed = await client(a.url);
  resumed.send({ type: 'resume', code: a.whiteWelcome.code, token: a.whiteWelcome.token });
  await resumed.next(m => m.type === 'welcome');
  const finished = (await resumed.next(m => m.type === 'state')).state;
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.winner, 'draw');
});

function queuedAttack(player, opponent, hitAt) {
  return {
    from: { x: player.x, z: player.z }, target: { x: opponent.x, z: opponent.z },
    startAt: hitAt - PIECES[player.piece].windup, hitAt, endAt: hitAt + 220, resolved: false,
  };
}

test('earlier impacts win even when both become due within the same server tick', async t => {
  const a = await arena(t);
  await start(a);
  const room = a.app.rooms.get(a.whiteWelcome.code);
  const [white, black] = room.players;
  Object.assign(white, { x: 4, hp: 1 });
  black.hp = 1;
  const now = Date.now();
  white.attack = queuedAttack(white, black, now - 1);
  black.attack = queuedAttack(black, white, now - 5);
  const finished = (await a.white.next(m => m.type === 'state' && m.state.phase === 'finished')).state;
  assert.equal(finished.winner, 'black');
  assert.equal(finished.players[1].hp, 1);
});

test('exactly simultaneous lethal impacts produce a draw instead of a color advantage', async t => {
  const a = await arena(t);
  await start(a);
  const room = a.app.rooms.get(a.whiteWelcome.code);
  const [white, black] = room.players;
  Object.assign(white, { x: 4, hp: 1 });
  black.hp = 1;
  const now = Date.now();
  white.attack = queuedAttack(white, black, now - 1);
  black.attack = queuedAttack(black, white, now - 1);
  const finished = (await a.white.next(m => m.type === 'state' && m.state.phase === 'finished')).state;
  assert.equal(finished.winner, 'draw');
  assert.ok(finished.players.every(p => p.hp === 0));
});

test('a move delivered after impact cannot dodge damage while awaiting the next tick', async t => {
  const a = await arena(t);
  await start(a);
  const room = a.app.rooms.get(a.whiteWelcome.code);
  const [white, black] = room.players;
  white.x = 4;
  white.attack = queuedAttack(white, black, Date.now() - 1);
  // Deliver the frame synchronously so no timer can settle the impact beforehand.
  black.socket.emit('message', Buffer.from(JSON.stringify({ type: 'move', x: 5, z: 1 })), false);
  assert.equal(black.hp, PIECES.rook.maxHp - PIECES.rook.damage);
  assert.equal(black.x, 5);
  assert.equal(white.attack.resolved, true);
});

test('HTTP health works and private server files stay inaccessible', async t => {
  const app = createGameServer();
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${address.port}`;
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, rooms: 0 });
  for (const pathname of ['/vendor/three.module.js', '/vendor/three.core.js', '/shared/rules.js']) {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.ok((await response.text()).length > 100);
  }
  for (const pathname of ['/.git/config', '/server.js', '/package.json', '/node_modules/ws/package.json', '/%2eenv']) {
    assert.equal((await fetch(base + pathname)).status, 404, pathname);
  }
});
