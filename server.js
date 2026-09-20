import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { PIECES, canMove, canAttack, isDeadPosition } from './shared/rules.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};
const SPAWNS = { white: { x: 3, z: 6 }, black: { x: 4, z: 1 } };
const validPiece = (piece) => typeof piece === 'string' && Object.hasOwn(PIECES, piece);
const cleanName = (name) => String(name || 'Challenger').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 22) || 'Challenger';
const position = ({ x, z }) => ({ x, z });

/** Create an isolated authoritative server. Call await app.listen() to start it. */
export function createGameServer({ port = 3000, host = '0.0.0.0', disconnectGraceMs = 30_000 } = {}) {
  const rooms = new Map();
  const sockets = new Set();
  const send = (socket, data) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
  };
  const error = (socket, message) => send(socket, { type: 'error', message });

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': MIME['.json'] }).end(JSON.stringify({ ok: true, rooms: rooms.size }));
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      let base = path.join(ROOT, 'public');
      const vendor = { 'vendor/three.module.js': 'three.module.js', 'vendor/three.core.js': 'three.core.js' };
      if (Object.hasOwn(vendor, relative)) {
        base = path.join(ROOT, 'node_modules', 'three', 'build');
        relative = vendor[relative];
      } else if (relative.split(/[\\/]/).some((part) => part.startsWith('.') || part === 'node_modules')) {
        res.writeHead(404).end('Not found');
        return;
      } else if (relative.startsWith('shared/')) {
        base = path.join(ROOT, 'shared');
        relative = relative.slice('shared/'.length);
      }
      const requested = path.resolve(base, relative);
      const [resolved, realBase] = await Promise.all([realpath(requested), realpath(base)]);
      if (!resolved.startsWith(realBase + path.sep)) {
        res.writeHead(404).end('Not found');
        return;
      }
      const info = await stat(resolved);
      if (!info.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(resolved).on('error', () => res.destroy()).pipe(res);
    } catch (err) {
      res.writeHead(err instanceof URIError ? 400 : 404).end('Not found');
    }
  });
  const wss = new WebSocketServer({ server, maxPayload: 4096 });
  // The HTTP server's listen promise reports bind errors to the caller.
  wss.on('error', () => {});

  function publicPlayer(player) {
    return {
      id: player.id, name: player.name, piece: player.piece, color: player.color,
      x: player.x, z: player.z, hp: player.hp, maxHp: player.maxHp,
      hasMoved: player.hasMoved, moveReadyAt: player.moveReadyAt,
      attackReadyAt: player.attackReadyAt, ready: player.ready,
      connected: player.connected, rematch: player.rematch,
      move: player.move,
      attack: player.attack && {
        target: player.attack.target, startAt: player.attack.startAt,
        hitAt: player.attack.hitAt, endAt: player.attack.endAt,
      },
    };
  }
  function roomState(room) {
    return {
      code: room.code, phase: room.phase, players: room.players.map(publicPlayer),
      winner: room.winner, serverTime: Date.now(), startedAt: room.startedAt,
    };
  }
  function broadcast(room, data) {
    for (const player of room.players) send(player.socket, data);
  }
  function state(room) { broadcast(room, { type: 'state', state: roomState(room) }); }
  function event(room, value) { broadcast(room, { type: 'event', event: value }); }

  function resetPlayer(player) {
    Object.assign(player, SPAWNS[player.color], {
      hp: PIECES[player.piece].maxHp, maxHp: PIECES[player.piece].maxHp,
      hasMoved: false, moveReadyAt: 0, attackReadyAt: 0, move: null, attack: null,
      ready: false, rematch: false,
    });
  }
  function newPlayer(socket, name, piece, color) {
    const player = {
      id: randomBytes(8).toString('hex'), token: randomBytes(24).toString('hex'),
      name: cleanName(name), piece: validPiece(piece) ? piece : 'knight', color,
      socket, connected: true, disconnectedAt: null,
    };
    resetPlayer(player);
    return player;
  }
  function attach(socket, room, player) {
    socket.room = room;
    socket.player = player;
    player.socket = socket;
    player.connected = true;
    player.disconnectedAt = null;
    room.updatedAt = Date.now();
    send(socket, { type: 'welcome', playerId: player.id, token: player.token, code: room.code });
    if (room.phase === 'selecting' && room.players.length === 2 && room.players.every(p => p.connected && p.ready)) begin(room);
    else state(room);
  }
  function begin(room) {
    for (const player of room.players) resetPlayer(player);
    room.phase = 'playing';
    room.winner = null;
    room.startedAt = Date.now();
    room.updatedAt = Date.now();
    room.deadPositionKey = null;
    event(room, { type: 'start', startedAt: room.startedAt });
    state(room);
  }
  function finish(room, winner, reason = 'capture') {
    if (room.phase !== 'playing') return;
    room.phase = 'finished';
    room.winner = winner;
    room.updatedAt = Date.now();
    for (const player of room.players) { player.move = null; player.attack = null; }
    event(room, { type: 'victory', winner, loserId: winner === 'draw' ? undefined : room.players.find((p) => p.color !== winner)?.id, reason });
    state(room);
  }
  function detach(socket, voluntary = false) {
    const { room, player } = socket;
    socket.room = null;
    socket.player = null;
    if (!room || !player || player.socket !== socket) return;
    player.socket = null;
    player.connected = false;
    player.disconnectedAt = Date.now();
    room.updatedAt = Date.now();
    event(room, { type: 'disconnect', playerId: player.id, graceEndsAt: Date.now() + (voluntary ? 0 : disconnectGraceMs) });
    if (voluntary && room.phase === 'playing') {
      finish(room, room.players.find((p) => p.id !== player.id)?.color || null, 'disconnect');
    } else if (voluntary && ['waiting', 'selecting'].includes(room.phase)) {
      room.players = room.players.filter((p) => p !== player);
      room.phase = 'waiting';
      for (const other of room.players) other.ready = false;
    }
    state(room);
    if (!room.players.length) rooms.delete(room.code);
  }

  function resolveDueAttacks(room, now) {
    if (room.phase !== 'playing') return;
    const due = room.players.filter(p => p.attack && !p.attack.resolved && p.attack.hitAt <= now)
      .sort((a, b) => a.attack.hitAt - b.attack.hitAt);
    for (let i = 0; i < due.length && room.phase === 'playing';) {
      const hitAt = due[i].attack.hitAt;
      const simultaneous = [];
      while (i < due.length && due[i].attack.hitAt === hitAt) simultaneous.push(due[i++]);
      // Equal-time impacts trade damage; an earlier lethal strike always wins.
      const impacts = simultaneous.map(player => {
        const attack = player.attack;
        const opponent = room.players.find(p => p !== player);
        const hit = player.hp > 0 && opponent?.hp > 0 && opponent.x === attack.target.x && opponent.z === attack.target.z
          && canAttack({ ...player, ...attack.from }, attack.target, opponent);
        return { player, opponent, attack, hit: !!hit, damage: hit ? PIECES[player.piece].damage : 0 };
      });
      for (const { opponent, attack, hit, damage } of impacts) {
        attack.resolved = true;
        if (hit) opponent.hp = Math.max(0, opponent.hp - damage);
      }
      for (const { player, opponent, attack, hit, damage } of impacts) {
        event(room, { type: 'hit', playerId: player.id, targetId: opponent?.id, color: player.color, piece: player.piece, from: attack.from, target: attack.target, damage, hp: opponent?.hp, hit, hitAt });
      }
      const defeated = room.players.filter(p => p.hp === 0);
      if (defeated.length === 2) finish(room, 'draw', 'double-capture');
      else if (defeated.length === 1) finish(room, room.players.find(p => p.hp > 0).color);
    }
  }

  function handle(socket, message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return error(socket, 'Invalid message.');
    if (message.type === 'ping') return send(socket, { type: 'pong', sentAt: message.sentAt, serverTime: Date.now() });
    if (message.type === 'leave') return detach(socket, true);
    if (['create', 'join', 'resume'].includes(message.type)) {
      if (socket.room) return error(socket, 'Leave your current room before joining another.');
      if (message.type === 'create') {
        if (rooms.size >= 1000) return error(socket, 'Arena is busy. Try again shortly.');
        let code;
        do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code));
        const room = { code, phase: 'waiting', players: [], winner: null, startedAt: null, updatedAt: Date.now() };
        const player = newPlayer(socket, message.name, message.piece, 'white');
        room.players.push(player);
        rooms.set(code, room);
        return attach(socket, room, player);
      }
      const code = String(message.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return error(socket, 'Room not found. Check the six-character code.');
      if (message.type === 'resume') {
        const player = room.players.find((p) => typeof message.token === 'string' && p.token === message.token);
        if (!player) return error(socket, 'Session expired. Create or join a room again.');
        if (player.connected) return error(socket, 'This player is already connected in another window.');
        return attach(socket, room, player);
      }
      if (room.players.length >= 2) return error(socket, 'This room already has two players.');
      if (!['waiting', 'selecting'].includes(room.phase)) return error(socket, 'This match is already in progress.');
      const color = room.players.some((p) => p.color === 'white') ? 'black' : 'white';
      const player = newPlayer(socket, message.name, message.piece, color);
      room.players.push(player);
      room.phase = 'selecting';
      return attach(socket, room, player);
    }
    const { room, player } = socket;
    if (!room || !player) return error(socket, 'Create or join a room first.');
    // Settle impacts before a new action can change occupancy after their deadline.
    resolveDueAttacks(room, Date.now());
    if (message.type === 'select') {
      if (!['waiting', 'selecting'].includes(room.phase)) return error(socket, 'Classes can only be changed before a match.');
      if (!validPiece(message.piece)) return error(socket, 'Choose one of the six chess classes.');
      player.piece = message.piece;
      resetPlayer(player);
      return state(room);
    }
    if (message.type === 'ready') {
      if (!['waiting', 'selecting'].includes(room.phase)) return error(socket, 'The match has already started.');
      player.ready = !player.ready;
      if (room.players.length === 2 && room.players.every((p) => p.ready && p.connected)) begin(room);
      else state(room);
      return;
    }
    if (message.type === 'rematch') {
      if (room.phase !== 'finished') return error(socket, 'Finish this match before requesting a rematch.');
      player.rematch = true;
      if (room.players.length === 2 && room.players.every((p) => p.rematch && p.connected)) begin(room);
      else state(room);
      return;
    }
    if (!['move', 'attack'].includes(message.type)) return error(socket, 'Unknown command.');
    if (room.phase !== 'playing') return error(socket, 'Both players must be ready before fighting.');
    const now = Date.now();
    if ((player.move && now < player.move.endAt) || (player.attack && now < player.attack.endAt)) return error(socket, 'Your current action is still in progress.');
    const target = { x: message.x, z: message.z };
    if (!Number.isInteger(target.x) || !Number.isInteger(target.z) || target.x < 0 || target.x > 7 || target.z < 0 || target.z > 7) return error(socket, 'Choose a square inside the chessboard.');
    const opponent = room.players.find((p) => p.id !== player.id);
    const piece = PIECES[player.piece];
    if (message.type === 'move') {
      if (now < player.moveReadyAt) return error(socket, 'Movement is cooling down.');
      if (!canMove(player, target, opponent)) return error(socket, 'That square is not a legal move for your piece.');
      const from = position(player);
      player.move = { from, to: target, startAt: now, endAt: now + piece.moveDuration };
      Object.assign(player, target, { hasMoved: true, moveReadyAt: now + piece.moveCooldown });
      event(room, { type: 'move', playerId: player.id, color: player.color, piece: player.piece, ...player.move });
    } else {
      if (now < player.attackReadyAt) return error(socket, 'Attack is cooling down.');
      if (!canAttack(player, target, opponent)) return error(socket, 'That square is outside your legal capture pattern.');
      const from = position(player);
      player.attack = { from, target, startAt: now, hitAt: now + piece.windup, endAt: now + piece.windup + 220, resolved: false };
      player.attackReadyAt = now + piece.attackCooldown;
      event(room, { type: 'attack', playerId: player.id, color: player.color, piece: player.piece, from, target, startAt: now, hitAt: player.attack.hitAt, endAt: player.attack.endAt });
    }
    room.updatedAt = now;
    state(room);
  }

  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.alive = true;
    socket.windowAt = Date.now();
    socket.windowCount = 0;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('message', (raw, binary) => {
      const now = Date.now();
      if (now - socket.windowAt > 1000) { socket.windowAt = now; socket.windowCount = 0; }
      if (++socket.windowCount > 80) return;
      if (binary) return error(socket, 'Send text JSON messages.');
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return error(socket, 'Invalid JSON.'); }
      handle(socket, message);
    });
    socket.on('error', () => {});
    socket.on('close', () => { sockets.delete(socket); detach(socket); });
  });

  const tick = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (!room.players.some((p) => p.connected) && now - room.updatedAt > 300_000) {
        rooms.delete(room.code);
        continue;
      }
      for (const player of room.players) {
        if (!player.connected && player.disconnectedAt && now - player.disconnectedAt >= disconnectGraceMs) {
          if (room.phase === 'playing') {
            const opponent = room.players.find((p) => p !== player && p.connected);
            finish(room, opponent?.color || 'draw', opponent ? 'disconnect' : 'abandoned');
          } else if (['waiting', 'selecting'].includes(room.phase)) {
            room.players = room.players.filter((p) => p !== player);
            room.phase = 'waiting';
            for (const other of room.players) other.ready = false;
            state(room);
          }
        }
        if (room.phase !== 'playing') continue;
        if (player.move && now >= player.move.endAt) player.move = null;
      }
      resolveDueAttacks(room, now);
      for (const player of room.players) if (player.attack && now >= player.attack.endAt) player.attack = null;
      if (room.phase === 'playing' && room.players.every(p => !p.move && !p.attack)) {
        const key = room.players.map(p => `${p.piece}:${p.color}:${p.x}:${p.z}:${p.hasMoved}`).join('|');
        if (room.deadPositionKey !== key) {
          room.deadPositionKey = key;
          if (isDeadPosition(room.players)) finish(room, 'draw', 'dead-position');
        }
      }
      if (room.phase === 'playing') state(room);
      if (!room.players.length) rooms.delete(room.code);
    }
  }, 50);
  tick.unref();
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false;
      socket.ping();
    }
  }, 15_000);
  heartbeat.unref();

  return {
    server, wss, rooms,
    listen: (bindPort = port, bindHost = host) => new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);
      server.listen(bindPort, bindHost, () => {
        server.off('error', onError);
        resolve(server.address());
      });
    }),
    close: () => new Promise((resolve) => {
      clearInterval(tick);
      clearInterval(heartbeat);
      for (const socket of sockets) socket.terminate();
      wss.close(() => server.close(() => resolve()));
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createGameServer({ port: Number(process.env.PORT) || 3000, host: process.env.HOST || '0.0.0.0' });
  app.listen().then((address) => {
    console.log(`Regicide Arena is running at http://localhost:${address.port}`);
    console.log('Share your computer\'s LAN address with a second player, or deploy this Node server for online play.');
  }).catch((err) => { console.error(err.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
