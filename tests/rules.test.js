import test from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, isInside, squareName, legalMoves, legalAttacks, canMove, canAttack, isDeadPosition } from '../shared/rules.js';

const keys = squares => squares.map(({ x, z }) => `${x},${z}`).sort();
const has = (squares, x, z) => squares.some(square => square.x === x && square.z === z);
const center = { x: 3, z: 3 };

test('all six classes expose positive combat timings and balanced stats', () => {
  assert.deepEqual(Object.keys(PIECES).sort(), ['bishop', 'king', 'knight', 'pawn', 'queen', 'rook']);
  for (const stats of Object.values(PIECES)) {
    for (const field of ['maxHp', 'damage', 'moveCooldown', 'attackCooldown', 'moveDuration', 'windup']) {
      assert.ok(Number.isFinite(stats[field]) && stats[field] > 0, field);
    }
    for (const field of ['name', 'glyph', 'description', 'movement', 'attack']) assert.ok(stats[field]);
  }
  assert.ok(PIECES.queen.attackCooldown > PIECES.bishop.attackCooldown);
  assert.ok(PIECES.king.maxHp > PIECES.queen.maxHp);
  assert.ok(PIECES.king.damage > PIECES.queen.damage);
});

test('board boundaries require finite integer coordinates and use chess notation', () => {
  assert.equal(isInside({ x: 0, z: 0 }), true);
  assert.equal(isInside({ x: 7, z: 7 }), true);
  for (const value of [null, undefined, {}, { x: -1, z: 2 }, { x: 8, z: 0 }, { x: 0, z: 8 },
    { x: 0, z: -1 }, { x: 0.5, z: 0 }, { x: '1', z: 0 }, { x: NaN, z: 0 }, { x: 0, z: Infinity }]) {
    assert.equal(isInside(value), false);
  }
  assert.equal(squareName({ x: 0, z: 0 }), 'a8');
  assert.equal(squareName({ x: 7, z: 7 }), 'h1');
  assert.equal(squareName({ x: 4, z: 4 }), 'e4');
  assert.equal(squareName({ x: 8, z: 0 }), '—');
});

test('pawns move in opposite directions, with a first-move double and diagonal attacks', () => {
  assert.deepEqual(keys(legalMoves('pawn', 'white', { x: 3, z: 6 })), ['3,4', '3,5']);
  assert.deepEqual(keys(legalMoves('pawn', 'black', { x: 3, z: 1 })), ['3,2', '3,3']);
  assert.deepEqual(legalMoves('pawn', 'white', { x: 3, z: 6 }, null, true), [{ x: 3, z: 5 }]);
  assert.deepEqual(legalMoves('pawn', 'black', { x: 3, z: 1 }, null, true), [{ x: 3, z: 2 }]);
  assert.deepEqual(keys(legalAttacks('pawn', 'white', center)), ['2,2', '4,2']);
  assert.deepEqual(keys(legalAttacks('pawn', 'black', center)), ['2,4', '4,4']);
  assert.deepEqual(legalMoves('pawn', 'white', { x: 0, z: 0 }), []);
  assert.deepEqual(legalMoves('pawn', 'black', { x: 7, z: 7 }), []);
  assert.deepEqual(legalAttacks('pawn', 'white', { x: 0, z: 0 }), []);
  assert.deepEqual(legalAttacks('pawn', 'black', { x: 7, z: 7 }), []);
});

test('pawns cannot move onto or through an opponent, or capture straight forward', () => {
  const pawn = { piece: 'pawn', color: 'white', x: 3, z: 6, hasMoved: false };
  assert.deepEqual(legalMoves('pawn', 'white', pawn, { x: 3, z: 5 }), []);
  assert.deepEqual(legalMoves('pawn', 'white', pawn, { x: 3, z: 4 }), [{ x: 3, z: 5 }]);
  assert.equal(canMove(pawn, { x: 2, z: 5 }), false);
  assert.equal(canMove(pawn, { x: 3, z: 7 }), false);
  assert.equal(canAttack(pawn, { x: 3, z: 5 }, { x: 3, z: 5 }), false);
  assert.equal(canAttack(pawn, { x: 2, z: 5 }, { x: 2, z: 5 }), true);
  assert.equal(canAttack(pawn, { x: 4, z: 7 }, { x: 4, z: 7 }), false);
  const blackPawn = { ...pawn, color: 'black', z: 1 };
  assert.deepEqual(legalMoves('pawn', 'black', blackPawn, { x: 3, z: 2 }), []);
  assert.equal(canAttack(blackPawn, { x: 4, z: 2 }, { x: 4, z: 2 }), true);
});

test('knights have eight exact L destinations and jump over the opponent', () => {
  const expected = ['1,2', '1,4', '2,1', '2,5', '4,1', '4,5', '5,2', '5,4'];
  assert.deepEqual(keys(legalMoves('knight', 'white', center)), expected);
  assert.deepEqual(keys(legalMoves('knight', 'white', center, { x: 3, z: 4 })), expected);
  assert.deepEqual(keys(legalAttacks('knight', 'white', center, { x: 3, z: 4 })), expected);
  assert.equal(legalMoves('knight', 'white', center, { x: 5, z: 4 }).length, 7);
  assert.equal(has(legalAttacks('knight', 'white', center, { x: 5, z: 4 }), 5, 4), true);
  assert.deepEqual(keys(legalMoves('knight', 'black', { x: 0, z: 0 })), ['1,2', '2,1']);
});

test('kings only threaten adjacent squares and cannot move onto their opponent', () => {
  assert.equal(legalMoves('king', 'white', center).length, 8);
  assert.equal(legalMoves('king', 'white', { x: 0, z: 0 }).length, 3);
  assert.equal(legalMoves('king', 'white', center, { x: 4, z: 4 }).length, 7);
  assert.equal(has(legalAttacks('king', 'white', center, { x: 4, z: 4 }), 4, 4), true);
  assert.equal(canAttack({ ...center, piece: 'king', color: 'white' }, { x: 5, z: 3 }), false);
});

test('sliders stop before an opponent when moving and include it as the last attack square', () => {
  const directions = {
    bishop: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
    rook: [[1, 0], [-1, 0], [0, 1], [0, -1]],
    queen: [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]],
  };
  for (const [piece, rays] of Object.entries(directions)) {
    for (const [dx, dz] of rays) {
      const enemy = { x: center.x + 2 * dx, z: center.z + 2 * dz };
      const moves = legalMoves(piece, 'white', center, enemy);
      const attacks = legalAttacks(piece, 'white', center, enemy);
      assert.equal(has(moves, center.x + dx, center.z + dz), true, `${piece} before blocker`);
      assert.equal(has(moves, enemy.x, enemy.z), false, `${piece} occupied square`);
      assert.equal(has(attacks, enemy.x, enemy.z), true, `${piece} captures blocker`);
      assert.equal(has(moves, center.x + 3 * dx, center.z + 3 * dz), false, `${piece} moving through blocker`);
      assert.equal(has(attacks, center.x + 3 * dx, center.z + 3 * dz), false, `${piece} attacking through blocker`);
      assert.equal(has(moves, center.x - dx, center.z - dz), true, `${piece} opposite ray stays free`);
    }
  }
});

test('every origin/destination pair follows its exact piece pattern across all 64 squares', () => {
  for (const piece of Object.keys(PIECES)) {
    for (const color of ['white', 'black']) {
      for (let x = 0; x < 8; x++) {
        for (let z = 0; z < 8; z++) {
          const from = { x, z };
          const moves = legalMoves(piece, color, from, null, true);
          const attacks = legalAttacks(piece, color, from);
          assert.equal(new Set(keys(moves)).size, moves.length);
          assert.equal(new Set(keys(attacks)).size, attacks.length);
          assert.ok(moves.every(isInside) && attacks.every(isInside));
          for (let tx = 0; tx < 8; tx++) {
            for (let tz = 0; tz < 8; tz++) {
              const dx = Math.abs(tx - x), dz = Math.abs(tz - z);
              const diagonal = dx === dz && dx > 0;
              const straight = (dx === 0) !== (dz === 0);
              let moveExpected, attackExpected;
              switch (piece) {
                case 'pawn': {
                  const forward = color === 'white' ? -1 : 1;
                  moveExpected = tx === x && tz - z === forward;
                  attackExpected = dx === 1 && tz - z === forward;
                  break;
                }
                case 'knight': moveExpected = attackExpected = dx * dz === 2; break;
                case 'bishop': moveExpected = attackExpected = diagonal; break;
                case 'rook': moveExpected = attackExpected = straight; break;
                case 'queen': moveExpected = attackExpected = diagonal || straight; break;
                case 'king': moveExpected = attackExpected = Math.max(dx, dz) === 1; break;
              }
              assert.equal(has(moves, tx, tz), moveExpected, `${piece} ${color} move ${x},${z} to ${tx},${tz}`);
              assert.equal(has(attacks, tx, tz), attackExpected, `${piece} ${color} attack ${x},${z} to ${tx},${tz}`);
            }
          }
        }
      }
    }
  }
});

test('every enemy position blocks occupied move destinations; attacks still include legal captures', () => {
  for (const piece of Object.keys(PIECES)) {
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) {
        const enemy = { x, z };
        assert.equal(has(legalMoves(piece, 'white', center, enemy), x, z), false);
        const expectedCapture = has(legalAttacks(piece, 'white', center), x, z);
        assert.equal(has(legalAttacks(piece, 'white', center, enemy), x, z), expectedCapture);
      }
    }
  }
});

test('invalid input cannot unlock movement and checks support flat player coordinates', () => {
  for (const piece of ['dragon', '__proto__', 'toString', undefined, null]) {
    assert.deepEqual(legalMoves(piece, 'white', center), []);
    assert.deepEqual(legalAttacks(piece, 'white', center), []);
  }
  assert.deepEqual(legalMoves('pawn', 'purple', center), []);
  assert.deepEqual(legalMoves('king', 'white', { x: 9, z: 3 }), []);
  assert.equal(canMove(null, center), false);
  assert.equal(canAttack(null, center), false);
  const player = { piece: 'rook', color: 'white', x: 3, z: 3, hasMoved: true };
  assert.equal(canMove(player, { x: 3, z: 2 }), true);
  assert.equal(canMove(player, { x: 3.5, z: 2 }), false);
  assert.equal(canMove(player, center), false);
  assert.equal(canAttack(player, center), false);
  assert.equal(canMove({ ...player, pos: center }, { x: 3, z: 2 }), true);
  assert.equal(canAttack(player, { x: 3, z: 0 }, { x: 3, z: 2 }), false);
  assert.equal(canAttack(player, { x: 3, z: 2 }, { x: 3, z: 2 }), true);
});

test('rule queries never mutate player or opponent state', () => {
  const player = Object.freeze({ piece: 'queen', color: 'white', x: 3, z: 3, hasMoved: true });
  const opponent = Object.freeze({ x: 6, z: 6 });
  const snapshot = JSON.stringify({ player, opponent });
  legalMoves(player.piece, player.color, player, opponent, player.hasMoved);
  legalAttacks(player.piece, player.color, player, opponent);
  canMove(player, { x: 5, z: 5 }, opponent);
  canAttack(player, opponent, opponent);
  assert.equal(JSON.stringify({ player, opponent }), snapshot);
});

const fighter = (piece, color, x, z, hasMoved = true) => ({ piece, color, x, z, hasMoved });

test('passed, distant-file, and terminal pawns are provably dead positions', () => {
  const deadPairs = [
    [fighter('pawn', 'white', 3, 0), fighter('pawn', 'black', 4, 7)],
    [fighter('pawn', 'white', 3, 2), fighter('pawn', 'black', 4, 4)],
    [fighter('pawn', 'white', 3, 3), fighter('pawn', 'black', 4, 3)],
    [fighter('pawn', 'white', 0, 6), fighter('pawn', 'black', 7, 1)],
    [fighter('pawn', 'white', 3, 6), fighter('pawn', 'black', 3, 1)],
  ];
  for (const pair of deadPairs) {
    assert.equal(isDeadPosition(pair), true, JSON.stringify(pair));
    assert.equal(isDeadPosition([...pair].reverse()), true, 'player order is irrelevant');
  }
});

test('pawns that may still meet remain live, with or without their initial double advance', () => {
  for (const hasMoved of [false, true]) {
    assert.equal(isDeadPosition([
      fighter('pawn', 'white', 3, 6, hasMoved), fighter('pawn', 'black', 4, 1, hasMoved),
    ]), false);
  }
  assert.equal(isDeadPosition([
    fighter('pawn', 'white', 3, 1), fighter('pawn', 'black', 4, 0),
  ]), false, 'an immediate capture prevents a draw');
});

test('opposite-square-color bishops draw while same-square-color bishops can reconnect', () => {
  assert.equal(isDeadPosition([
    fighter('bishop', 'white', 0, 0), fighter('bishop', 'black', 1, 0),
  ]), true);
  assert.equal(isDeadPosition([
    fighter('bishop', 'white', 0, 0), fighter('bishop', 'black', 2, 0),
  ]), false, 'not currently aligned, but future diagonal attacks remain possible');
});

test('pawn versus bishop considers the pawn future square colors and both capture directions', () => {
  assert.equal(isDeadPosition([
    fighter('pawn', 'white', 0, 0), fighter('bishop', 'black', 1, 0),
  ]), true, 'terminal pawn is marooned on the opposite square color');
  assert.equal(isDeadPosition([
    fighter('pawn', 'white', 0, 0), fighter('bishop', 'black', 1, 1),
  ]), false, 'bishop can still damage an immobile pawn');
  assert.equal(isDeadPosition([
    fighter('pawn', 'white', 3, 1), fighter('bishop', 'black', 0, 1),
  ]), false, 'pawn can advance onto the bishop square color');
  assert.equal(isDeadPosition([
    fighter('pawn', 'black', 7, 7), fighter('bishop', 'white', 0, 1),
  ]), true, 'black terminal pawn uses the opposite forward direction');
});

test('mobile king, queen, rook and knight can always reconnect with any opponent class', () => {
  for (const piece of ['king', 'queen', 'rook', 'knight']) {
    for (const enemyPiece of Object.keys(PIECES)) {
      assert.equal(isDeadPosition([
        fighter(piece, 'white', 0, 0), fighter(enemyPiece, 'black', 7, 7),
      ]), false, `${piece} versus ${enemyPiece}`);
    }
  }
});

test('a legal present capture never produces a false draw for any class matchup', () => {
  for (const piece of Object.keys(PIECES)) {
    const player = fighter(piece, 'white', 3, 3);
    for (const target of legalAttacks(piece, player.color, player)) {
      for (const enemyPiece of Object.keys(PIECES)) {
        const enemy = fighter(enemyPiece, 'black', target.x, target.z);
        assert.equal(isDeadPosition([player, enemy]), false, `${piece} captures ${enemyPiece}`);
      }
    }
  }
});

test('dead-position checks reject malformed game states and preserve frozen input', () => {
  const white = Object.freeze(fighter('bishop', 'white', 0, 0));
  const black = Object.freeze(fighter('bishop', 'black', 1, 0));
  const pair = Object.freeze([white, black]);
  assert.equal(isDeadPosition(pair), true);
  assert.equal(isDeadPosition([{ ...white, pos: { x: 0, z: 0 } }, black]), true);
  for (const input of [undefined, {}, [], [white], [white, black, white], [white, null],
    [white, { ...black, x: -1 }], [white, { ...black, piece: 'dragon' }],
    [white, { ...black, color: 'purple' }], [white, { ...black, x: 0 }]]) {
    assert.equal(isDeadPosition(input), false);
  }
});
