/** Shared, deterministic chess geometry. Coordinates use a8 = { x: 0, z: 0 }. */
export const BOARD_SIZE = 8;

export const PIECES = Object.freeze({
  pawn: Object.freeze({
    name: 'Pawn', glyph: '♟',
    description: 'A patient duelist. Advance with purpose and punish the diagonal.',
    movement: 'One square forward. Your first move may advance two squares.',
    attack: 'Strike one square diagonally forward.',
    maxHp: 120, damage: 30, moveCooldown: 650, attackCooldown: 900,
    moveDuration: 300, windup: 300,
  }),
  knight: Object.freeze({
    name: 'Knight', glyph: '♞',
    description: 'An unpredictable aerial fighter. Leap over danger and crash down.',
    movement: 'Leap in an L: two squares in one direction, then one across.',
    attack: 'Crash onto an L-shaped capture square. Jump over the opponent.',
    maxHp: 140, damage: 32, moveCooldown: 1200, attackCooldown: 1500,
    moveDuration: 650, windup: 700,
  }),
  bishop: Object.freeze({
    name: 'Bishop', glyph: '♝',
    description: 'A precise ranged fighter who commands the diagonals.',
    movement: 'Dash any distance diagonally. The opponent blocks your path.',
    attack: 'Release an energy slash along a diagonal.',
    maxHp: 110, damage: 26, moveCooldown: 1050, attackCooldown: 1400,
    moveDuration: 420, windup: 550,
  }),
  rook: Object.freeze({
    name: 'Rook', glyph: '♜',
    description: 'An armored siege tower. Control straight lanes with heavy force.',
    movement: 'Charge any distance horizontally or vertically.',
    attack: 'Send a heavy shockwave straight down a row or column.',
    maxHp: 170, damage: 34, moveCooldown: 1250, attackCooldown: 1750,
    moveDuration: 500, windup: 650,
  }),
  queen: Object.freeze({
    name: 'Queen', glyph: '♛',
    description: 'Master of every lane. Supreme mobility rewards careful timing.',
    movement: 'Dash any distance horizontally, vertically, or diagonally.',
    attack: 'Cast a directional energy slash. Powerful reach, long recovery.',
    maxHp: 100, damage: 28, moveCooldown: 1250, attackCooldown: 2300,
    moveDuration: 460, windup: 720,
  }),
  king: Object.freeze({
    name: 'King', glyph: '♚',
    description: 'A durable close-range brawler. Every adjacent square is a threat.',
    movement: 'Move exactly one square in any direction.',
    attack: 'Crush any adjacent square with a powerful royal strike.',
    maxHp: 200, damage: 42, moveCooldown: 700, attackCooldown: 1100,
    moveDuration: 330, windup: 350,
  }),
});

const DIAGONALS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const STRAIGHTS = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const ALL_DIRECTIONS = [...DIAGONALS, ...STRAIGHTS];
const KNIGHT_STEPS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

/** Accepts a square, or a player with a `pos` square. Never coerces input. */
const position = value => value?.pos ?? value;
const sameSquare = (a, b) => !!a && !!b && a.x === b.x && a.z === b.z;

export function isInside(square) {
  return !!square && Number.isInteger(square.x) && Number.isInteger(square.z)
    && square.x >= 0 && square.x < BOARD_SIZE
    && square.z >= 0 && square.z < BOARD_SIZE;
}

export function squareName(square) {
  return isInside(square) ? `${String.fromCharCode(97 + square.x)}${8 - square.z}` : '—';
}

function steppedSquares(from, steps, opponent, capture) {
  return steps.map(([dx, dz]) => ({ x: from.x + dx, z: from.z + dz }))
    .filter(square => isInside(square) && (capture || !sameSquare(square, opponent)));
}

function raySquares(from, directions, opponent, capture) {
  const squares = [];
  for (const [dx, dz] of directions) {
    for (let distance = 1; distance < BOARD_SIZE; distance++) {
      const square = { x: from.x + dx * distance, z: from.z + dz * distance };
      if (!isInside(square)) break;
      if (sameSquare(square, opponent)) {
        if (capture) squares.push(square);
        break;
      }
      squares.push(square);
    }
  }
  return squares;
}

function destinations(piece, color, from, opponent, hasMoved, capture) {
  from = position(from);
  opponent = position(opponent);
  if (!Object.hasOwn(PIECES, piece) || !isInside(from)) return [];

  if (piece === 'pawn') {
    if (color !== 'white' && color !== 'black') return [];
    const forward = color === 'white' ? -1 : 1;
    if (capture) return steppedSquares(from, [[-1, forward], [1, forward]], opponent, true);
    const first = { x: from.x, z: from.z + forward };
    if (!isInside(first) || sameSquare(first, opponent)) return [];
    const squares = [first];
    const second = { x: from.x, z: from.z + forward * 2 };
    if (!hasMoved && isInside(second) && !sameSquare(second, opponent)) squares.push(second);
    return squares;
  }

  if (piece === 'knight') return steppedSquares(from, KNIGHT_STEPS, opponent, capture);
  if (piece === 'king') return steppedSquares(from, ALL_DIRECTIONS, opponent, capture);
  const directions = piece === 'bishop' ? DIAGONALS : piece === 'rook' ? STRAIGHTS : ALL_DIRECTIONS;
  return raySquares(from, directions, opponent, capture);
}

/** All reachable, unoccupied squares. This deliberately never permits a capture move. */
export function legalMoves(piece, color, from, opponent = null, hasMoved = false) {
  return destinations(piece, color, from, opponent, hasMoved, false);
}

/** All threatened squares, including an opponent square but never beyond a blocker. */
export function legalAttacks(piece, color, from, opponent = null) {
  return destinations(piece, color, from, opponent, true, true);
}

/** Geometric checks only: the authoritative server enforces health, timing, and occupancy. */
export function canMove(player, target, opponent = null) {
  return !!player && isInside(target)
    && legalMoves(player.piece, player.color, player, opponent, player.hasMoved)
      .some(square => sameSquare(square, target));
}

/** Attacks may target empty legal squares and miss; illegal patterns are always rejected. */
export function canAttack(player, target, opponent = null) {
  return !!player && isInside(target)
    && legalAttacks(player.piece, player.color, player, opponent)
      .some(square => sameSquare(square, target));
}

const squareIndex = square => square.z * BOARD_SIZE + square.x;

/** Future movement without blockers is a superset of every actual movement path. */
function reachableSquares(player) {
  const start = position(player);
  const queue = [{ x: start.x, z: start.z, hasMoved: !!player.hasMoved }];
  const stateKey = square => squareIndex(square) * 2 + Number(square.hasMoved);
  const visitedStates = new Set([stateKey(queue[0])]);
  const squares = new Map([[squareIndex(start), { x: start.x, z: start.z }]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const from = queue[cursor];
    for (const target of legalMoves(player.piece, player.color, from, null, from.hasMoved)) {
      const next = { ...target, hasMoved: true };
      const key = stateKey(next);
      if (visitedStates.has(key)) continue;
      visitedStates.add(key);
      queue.push(next);
      squares.set(squareIndex(target), target);
    }
  }
  return squares;
}

/**
 * A draw is provable only when neither fighter can ever threaten any square the
 * other could reach. Ignore blockers and timing to avoid falsely declaring a
 * draw merely because a route is currently obstructed or an attack is cooling.
 * The server should call this after pending attacks and movement resolve.
 */
export function isDeadPosition(players) {
  if (!Array.isArray(players) || players.length !== 2 || players.some(player =>
    !player || !Object.hasOwn(PIECES, player.piece) || !isInside(position(player))
    || !['white', 'black'].includes(player.color))) return false;
  if (sameSquare(position(players[0]), position(players[1]))) return false;

  const reachable = players.map(reachableSquares);
  for (let index = 0; index < 2; index++) {
    const player = players[index];
    const enemySquares = reachable[1 - index];
    for (const from of reachable[index].values()) {
      if (legalAttacks(player.piece, player.color, from)
        .some(target => enemySquares.has(squareIndex(target)))) return false;
    }
  }
  return true;
}
