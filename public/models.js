import * as THREE from 'three';

// All pieces share finishes so a full board stays inexpensive to render.
const finishes = {
  white: new THREE.MeshStandardMaterial({ color: 0xece6d4, metalness: 0.2, roughness: 0.3 }),
  black: new THREE.MeshStandardMaterial({ color: 0x14252b, metalness: 0.5, roughness: 0.29 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xbd9654, metalness: 0.82, roughness: 0.3 }),
  paleGold: new THREE.MeshStandardMaterial({ color: 0xd8bb7c, metalness: 0.7, roughness: 0.28 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x071113, metalness: 0.45, roughness: 0.42 }),
  inset: new THREE.MeshStandardMaterial({ color: 0x061011, metalness: 0.25, roughness: 0.5 }),
  tileLight: new THREE.MeshStandardMaterial({ color: 0xd4cbb3, metalness: 0.12, roughness: 0.58 }),
  tileDark: new THREE.MeshStandardMaterial({ color: 0x28413b, metalness: 0.22, roughness: 0.44 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x152c2a, metalness: 0.5, roughness: 0.35 }),
  foundation: new THREE.MeshStandardMaterial({ color: 0x0a191b, metalness: 0.25, roughness: 0.6 }),
  glow: new THREE.MeshStandardMaterial({ color: 0xb79653, emissive: 0x6b4c1c, emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.35 }),
};

const sphereGeometry = new THREE.SphereGeometry(1, 20, 14);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

function mesh(parent, geometry, material, position = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function box(parent, material, size, position) {
  const object = mesh(parent, boxGeometry, material, position);
  object.scale.set(...size);
  return object;
}

function sphere(parent, material, radius, position, scale = [1, 1, 1]) {
  const object = mesh(parent, sphereGeometry, material, position);
  object.scale.set(radius * scale[0], radius * scale[1], radius * scale[2]);
  return object;
}

function lathe(parent, material, points, segments = 48) {
  return mesh(parent, new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments), material);
}

function band(parent, material, radius, height, thickness = 0.035) {
  const object = mesh(parent, new THREE.TorusGeometry(radius, thickness, 8, 48), material, [0, height, 0]);
  object.rotation.x = Math.PI / 2;
  return object;
}

function stem(parent, material, top = 1.65, radius = 0.25) {
  const body = lathe(parent, material, [
    [0, 0.32], [0.49, 0.32], [0.50, 0.39], [0.44, 0.48], [0.39, 0.51],
    [0.35, 0.57], [0.29, 0.73], [0.23, 1.0], [0.21, top - 0.28],
    [radius, top - 0.12], [radius + 0.075, top - 0.06], [radius + 0.08, top], [0, top],
  ]);
  body.name = 'body';
  return body;
}

function foot(parent, material) {
  lathe(parent, material, [
    [0, 0.015], [0.50, 0.015], [0.59, 0.055], [0.63, 0.115], [0.63, 0.17],
    [0.61, 0.215], [0.56, 0.245], [0.54, 0.29], [0.52, 0.32], [0, 0.32],
  ]);
  band(parent, finishes.gold, 0.604, 0.11, 0.018);
  band(parent, finishes.gold, 0.544, 0.275, 0.017);
  lathe(parent, finishes.dark, [[0, 0.005], [0.49, 0.005], [0.50, 0.02], [0, 0.02]], 32);
}

function collar(parent, material, height, radius = 0.4) {
  lathe(parent, material, [[0, height], [radius - 0.06, height], [radius, height + 0.04], [radius, height + 0.1], [radius - 0.08, height + 0.15], [0, height + 0.15]]);
  band(parent, finishes.gold, radius - 0.005, height + 0.071, 0.016);
}

function pawn(parent, material) {
  stem(parent, material, 1.6, 0.23);
  collar(parent, material, 1.59, 0.345);
  sphere(parent, material, 0.37, [0, 2.08, 0], [1, 1.06, 1]);
  band(parent, finishes.gold, 0.22, 1.805, 0.019);
  return 2.47;
}

function rook(parent, material) {
  lathe(parent, material, [[0, 0.3], [0.49, 0.3], [0.46, 0.5], [0.36, 0.64], [0.30, 1.75], [0.36, 1.85], [0.46, 1.91], [0.48, 2.04], [0.44, 2.14], [0, 2.14]]).name = 'body';
  band(parent, finishes.gold, 0.465, 1.99, 0.022);
  lathe(parent, material, [[0.34, 2.10], [0.45, 2.10], [0.46, 2.27], [0.34, 2.27], [0.34, 2.10]]);
  mesh(parent, new THREE.CylinderGeometry(0.335, 0.335, 0.045, 32), finishes.inset, [0, 2.135, 0]);
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    const tooth = box(parent, material, [0.25, 0.33, 0.23], [Math.sin(angle) * 0.352, 2.335, Math.cos(angle) * 0.352]);
    tooth.rotation.y = angle;
    const cap = box(parent, finishes.gold, [0.251, 0.025, 0.231], [Math.sin(angle) * 0.352, 2.503, Math.cos(angle) * 0.352]);
    cap.rotation.y = angle;
  }
  return 2.52;
}

function bishop(parent, material) {
  stem(parent, material, 1.72, 0.25);
  collar(parent, material, 1.68, 0.405);
  lathe(parent, material, [[0, 1.81], [0.24, 1.81], [0.32, 1.94], [0.355, 2.09], [0.30, 2.27], [0.21, 2.45], [0.10, 2.59], [0, 2.68]]);
  // A dark, recessed-looking diagonal seam identifies the bishop's mitre.
  const cutPoints = [new THREE.Vector3(-0.16, 2.05, -0.319), new THREE.Vector3(-0.065, 2.18, -0.328), new THREE.Vector3(0.035, 2.32, -0.276), new THREE.Vector3(0.11, 2.43, -0.193)];
  mesh(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cutPoints), 16, 0.027, 5, false), finishes.inset);
  sphere(parent, finishes.gold, 0.075, [0, 2.70, 0]);
  return 2.775;
}

function queen(parent, material) {
  stem(parent, material, 1.89, 0.29);
  collar(parent, material, 1.83, 0.41);
  lathe(parent, material, [[0, 1.97], [0.25, 1.97], [0.32, 2.06], [0.36, 2.22], [0.46, 2.45], [0.43, 2.49], [0.29, 2.18], [0, 2.14]]);
  band(parent, finishes.gold, 0.355, 2.22, 0.025);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const tip = sphere(parent, finishes.paleGold, 0.075, [Math.sin(angle) * 0.438, 2.49, Math.cos(angle) * 0.438]);
    tip.scale.y *= 1.2;
  }
  sphere(parent, material, 0.165, [0, 2.48, 0]);
  sphere(parent, finishes.gold, 0.09, [0, 2.695, 0]);
  return 2.79;
}

function king(parent, material) {
  stem(parent, material, 1.88, 0.3);
  collar(parent, material, 1.83, 0.425);
  lathe(parent, material, [[0, 1.98], [0.28, 1.98], [0.37, 2.1], [0.37, 2.22], [0.28, 2.34], [0.19, 2.4], [0, 2.4]]);
  band(parent, finishes.gold, 0.365, 2.175, 0.025);
  sphere(parent, material, 0.13, [0, 2.39, 0]);
  box(parent, finishes.gold, [0.145, 0.55, 0.135], [0, 2.715, 0]);
  box(parent, finishes.gold, [0.43, 0.135, 0.135], [0, 2.76, 0]);
  // Ivory/obsidian inlays give the cross the same finish as the body.
  box(parent, material, [0.073, 0.42, 0.14], [0, 2.715, 0]);
  box(parent, material, [0.32, 0.067, 0.14], [0, 2.76, 0]);
  return 3;
}

function knight(parent, material) {
  lathe(parent, material, [[0, 0.3], [0.47, 0.3], [0.42, 0.52], [0.35, 0.65], [0.34, 0.84], [0.28, 0.92], [0, 0.92]]).name = 'body';
  band(parent, finishes.gold, 0.38, 0.565, 0.022);
  const horse = new THREE.Group();
  horse.rotation.y = Math.PI / 2;
  parent.add(horse);
  const silhouette = new THREE.Shape();
  silhouette.moveTo(-0.34, 0.77);
  silhouette.bezierCurveTo(-0.53, 1.13, -0.54, 1.55, -0.40, 1.95);
  silhouette.bezierCurveTo(-0.36, 2.15, -0.23, 2.39, -0.05, 2.49);
  silhouette.lineTo(0.02, 2.72);
  silhouette.lineTo(0.16, 2.53);
  silhouette.lineTo(0.32, 2.47);
  silhouette.bezierCurveTo(0.36, 2.36, 0.48, 2.23, 0.64, 2.13);
  silhouette.lineTo(0.64, 1.92);
  silhouette.quadraticCurveTo(0.56, 1.84, 0.43, 1.91);
  silhouette.lineTo(0.13, 2.07);
  silhouette.quadraticCurveTo(-0.01, 1.98, 0.05, 1.76);
  silhouette.bezierCurveTo(0.14, 1.53, 0.30, 1.21, 0.33, 0.8);
  silhouette.closePath();
  const horseGeometry = new THREE.ExtrudeGeometry(silhouette, { depth: 0.36, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.06, bevelThickness: 0.055, curveSegments: 16 });
  horseGeometry.translate(-0.055, 0, -0.18);
  mesh(horse, horseGeometry, material);
  // Gold mane ridge and small sculpted tufts make the silhouette readable at a distance.
  const manePoints = [new THREE.Vector3(-0.42, 1.04, 0), new THREE.Vector3(-0.49, 1.49, 0), new THREE.Vector3(-0.42, 1.94, 0), new THREE.Vector3(-0.24, 2.33, 0), new THREE.Vector3(-0.10, 2.47, 0)];
  mesh(horse, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(manePoints), 20, 0.071, 8, false), finishes.gold);
  for (let i = 0; i < 5; i++) {
    const tuft = box(horse, material, [0.15, 0.11, 0.29], [-0.48 + i * 0.035, 1.55 + i * 0.15, 0]);
    tuft.rotation.z = -0.27;
  }
  for (const side of [-1, 1]) {
    sphere(horse, finishes.dark, 0.053, [0.205, 2.315, side * 0.224], [1, 0.8, 0.34]);
    sphere(horse, finishes.paleGold, 0.022, [0.211, 2.32, side * 0.243], [1, 1, 0.5]);
    sphere(horse, finishes.dark, 0.029, [0.533, 2.085, side * 0.23], [1, 0.7, 0.32]);
  }
  return 2.79;
}

const builders = { pawn, knight, bishop, rook, queen, king };

/** Create a chess piece standing at y=0 and facing local -Z. */
export function createPiece(type, color = 'white', scale = 1) {
  const kind = String(type).toLowerCase();
  const side = String(color).toLowerCase() === 'black' ? 'black' : 'white';
  const group = new THREE.Group();
  group.name = `${side}-${kind}`;
  foot(group, finishes[side]);
  const height = (builders[kind] || pawn)(group, finishes[side]);
  group.scale.setScalar(scale);
  group.userData = { type: kind, color: side, height: height * scale };
  return group;
}

function frameStrips(parent, halfExtent, y, width, thickness, material) {
  const length = halfExtent * 2;
  for (const sign of [-1, 1]) {
    box(parent, material, [length, thickness, width], [0, y, sign * halfExtent]);
    box(parent, material, [width, thickness, length], [sign * halfExtent, y, 0]);
  }
}

/** The 8 x 8 board covers [-12,12] on X/Z. Tile surfaces are exactly y=0. */
export function createArena() {
  const arena = new THREE.Group();
  arena.name = 'royal-arena';
  box(arena, finishes.foundation, [26.7, 0.50, 26.7], [0, -1.18, 0]);
  box(arena, finishes.frame, [26.15, 0.74, 26.15], [0, -0.65, 0]);
  box(arena, finishes.dark, [25.8, 0.22, 25.8], [0, -0.205, 0]);
  // Keep the continuous backing below tile bottoms (-0.12) to avoid z-fighting.
  box(arena, finishes.frame, [25.65, 0.17, 25.65], [0, -0.215, 0]);
  frameStrips(arena, 13.27, -0.961, 0.08, 0.055, finishes.gold);
  frameStrips(arena, 12.925, -0.306, 0.07, 0.045, finishes.gold);
  frameStrips(arena, 12.745, 0.012, 0.035, 0.025, finishes.paleGold);
  frameStrips(arena, 12.06, 0.009, 0.028, 0.02, finishes.gold);
  const tileGeometry = new THREE.BoxGeometry(2.986, 0.12, 2.986);
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 8; z++) {
      const tile = mesh(arena, tileGeometry, (x + z) % 2 === 0 ? finishes.tileLight : finishes.tileDark, [(x - 3.5) * 3, -0.06, (z - 3.5) * 3]);
      tile.name = `tile-${x}-${z}`;
      tile.userData = { x, z, boardTile: true };
      tile.castShadow = false;
    }
  }

  // Restrained inlaid corner ornaments and side fluting.
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const ornament = box(arena, finishes.gold, [0.24, 0.025, 0.24], [x * 12.42, 0.018, z * 12.42]);
      ornament.rotation.y = Math.PI / 4;
      box(arena, finishes.foundation, [1.0, 1.18, 1.0], [x * 11.75, -1.85, z * 11.75]);
      box(arena, finishes.gold, [1.07, 0.06, 1.07], [x * 11.75, -2.36, z * 11.75]);
    }
  }
  const fluting = new THREE.InstancedMesh(boxGeometry, finishes.dark, 92);
  const fluteTransform = new THREE.Object3D();
  let fluteIndex = 0;
  for (let i = -11; i <= 11; i += 1) {
    for (const side of [-1, 1]) {
      fluteTransform.position.set(i, -0.64, side * 13.08);
      fluteTransform.scale.set(0.045, 0.35, 0.018);
      fluteTransform.updateMatrix();
      fluting.setMatrixAt(fluteIndex++, fluteTransform.matrix);
      fluteTransform.position.set(side * 13.08, -0.64, i);
      fluteTransform.scale.set(0.018, 0.35, 0.045);
      fluteTransform.updateMatrix();
      fluting.setMatrixAt(fluteIndex++, fluteTransform.matrix);
    }
  }
  fluting.receiveShadow = true;
  fluting.instanceMatrix.needsUpdate = true;
  arena.add(fluting);

  // A sunken circular dais frames the board without interfering with play.
  mesh(arena, new THREE.CylinderGeometry(21.2, 22, 0.6, 96), finishes.foundation, [0, -3.15, 0]);
  mesh(arena, new THREE.CylinderGeometry(20.6, 20.6, 0.12, 96), finishes.frame, [0, -2.8, 0]);
  band(arena, finishes.gold, 20.75, -2.8, 0.055);
  band(arena, finishes.dark, 18.8, -2.72, 0.13);
  band(arena, finishes.gold, 17.8, -2.721, 0.025);
  // Four distant sentinels occupy the diagonal edges of the dais.
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    const column = new THREE.Group();
    column.position.set(Math.sin(angle) * 20.3, -2.73, Math.cos(angle) * 20.3);
    arena.add(column);
    box(column, finishes.dark, [1.25, 0.3, 1.25], [0, 0.15, 0]);
    box(column, finishes.gold, [1.14, 0.06, 1.14], [0, 0.32, 0]);
    lathe(column, finishes.frame, [[0, 0.34], [0.48, 0.34], [0.42, 0.49], [0.29, 2.42], [0.40, 2.55], [0.4, 2.70], [0, 2.70]], 12);
    band(column, finishes.gold, 0.41, 0.5, 0.025);
    band(column, finishes.gold, 0.4, 2.6, 0.035);
    sphere(column, finishes.glow, 0.23, [0, 2.94, 0]);
  }
  return arena;
}
