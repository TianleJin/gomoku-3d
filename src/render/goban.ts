import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SIZE, colOf, index, rowOf, type Player } from '../core/board';
import { pbr, projectUVs } from './assets';
import { rng, woodTexture } from './textures';

/**
 * A table goban and its stones. Real boards are slightly longer than wide
 * (22 x 23.7 mm cells) so the grid looks square from a seated player's angle.
 * Local origin: the centre of the board's top surface; rows run from -z
 * (row 0, the far edge) towards the player at +z.
 */
export const CELL_X = 0.022;
export const CELL_Z = 0.0237;
const MARGIN = 0.017;
export const BOARD_W = (SIZE - 1) * CELL_X + MARGIN * 2;
export const BOARD_D = (SIZE - 1) * CELL_Z + MARGIN * 2;
export const BOARD_T = 0.034;
const STONE_R = 0.0111;
const STONE_H = 0.0092;
const HALF = (SIZE - 1) / 2;
/** Star points: the traditional 3-3, 3-9, ... marks on a 19x19 board. */
const HOSHI = [3, 9, 15];

/** Board-local position of a cell's intersection, on the board's surface. */
export function cellPosition(cell: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((colOf(cell) - HALF) * CELL_X, 0, (rowOf(cell) - HALF) * CELL_Z);
}

/** The nearest intersection to a board-local point, or null if it is off the grid. */
export function cellAt(x: number, z: number): number | null {
  const c = Math.round(x / CELL_X + HALF);
  const r = Math.round(z / CELL_Z + HALF);
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE ? index(r, c) : null;
}

/** The ink grid and star points, drawn on a transparent overlay. */
function gridTexture(): THREE.CanvasTexture {
  const px = 2048;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * BOARD_D) / BOARD_W);
  const ctx = c.getContext('2d')!;
  const sx = px / BOARD_W;
  const sz = c.height / BOARD_D;
  const X = (col: number) => (MARGIN + col * CELL_X) * sx;
  const Z = (row: number) => (MARGIN + row * CELL_Z) * sz;
  // Ink soaks into the wood a little: slightly soft, dark brown rather than black.
  ctx.strokeStyle = 'rgba(28, 18, 10, 0.92)';
  ctx.lineCap = 'square';
  for (let k = 0; k < SIZE; k++) {
    // The outer frame is drawn heavier, as on real boards.
    ctx.lineWidth = (k === 0 || k === SIZE - 1 ? 1.4 : 0.9) * 0.001 * sx;
    ctx.beginPath();
    ctx.moveTo(X(0), Z(k));
    ctx.lineTo(X(SIZE - 1), Z(k));
    ctx.moveTo(X(k), Z(0));
    ctx.lineTo(X(k), Z(SIZE - 1));
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(28, 18, 10, 0.95)';
  for (const r of HOSHI) {
    for (const col of HOSHI) {
      ctx.beginPath();
      ctx.ellipse(X(col), Z(r), 0.002 * sx, 0.002 * sz, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

/** Biconvex stone: a lathe of a superellipse, so the edge is rounded rather than sharp. */
function stoneGeometry(r: number, h: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 14;
  const p = 2.3;
  // From the top centre out to the rim, then down to the bottom centre.
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * r;
    pts.push(new THREE.Vector2(x, (h / 2) * Math.pow(1 - Math.pow(x / r, p), 1 / p)));
  }
  for (let i = N - 1; i >= 0; i--) pts.push(new THREE.Vector2(pts[i]!.x, -pts[i]!.y));
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.translate(0, h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Faint growth lines of clamshell, for the white stones. */
function shellTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const rand = rng(91);
  ctx.fillStyle = '#f3f0e8';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2 + rand() * 4) {
    ctx.fillStyle = `rgba(${200 + rand() * 20}, ${195 + rand() * 20}, ${180 + rand() * 20}, ${0.12 + rand() * 0.2})`;
    ctx.fillRect(0, y, 256, 1 + rand() * 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const STONE_MATERIALS = {
  // Slate: dark, oiled, a soft sheen rather than a gloss.
  black: new THREE.MeshPhysicalMaterial({ color: 0x18191b, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.45 }),
  // Clamshell: warm white, polished.
  white: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
};

/** The board itself: a kaya-coloured slab with the grid inked on its top. */
export function createBoard(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'goban';
  // Kaya: pale golden wood with a fine straight grain.
  const kaya = pbr('oak_veneer_01', { size: 0.9, color: 0xffffff, noMap: true, normalScale: 0.25 });
  const grain = woodTexture(38, 62, 9);
  grain.repeat.set(1 / 0.6, 1 / 0.6);
  kaya.map = grain;
  // A light lacquer: even, softly glossy.
  kaya.roughnessMap = null;
  kaya.roughness = 0.38;
  kaya.clearcoat = 0.25;
  kaya.clearcoatRoughness = 0.35;
  const slab = new THREE.Mesh(projectUVs(new RoundedBoxGeometry(BOARD_W, BOARD_T, BOARD_D, 3, 0.0025)), kaya);
  slab.position.y = -BOARD_T / 2;
  slab.castShadow = slab.receiveShadow = true;
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD_W, BOARD_D),
    new THREE.MeshStandardMaterial({ map: gridTexture(), transparent: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.0002;
  grid.receiveShadow = true;
  group.add(slab, grid);
  return group;
}

/** A turned wooden go-ke with its lid set beside it, filled with stones of one colour. */
export function createBowl(player: Player, seed: number): THREE.Group {
  const group = new THREE.Group();
  const wood = pbr('oak_veneer_01', { size: 0.5, color: 0x9a6a40, normalScale: 0.5 });
  wood.roughnessMap = null;
  wood.roughness = 0.4;
  wood.clearcoat = 0.4;
  const R = 0.068;
  const H = 0.072;
  // Outside profile up to the rim, then back down the inside.
  const prof: [number, number][] = [
    [0, 0],
    [R * 0.62, 0],
    [R * 0.66, 0.006],
    [R * 0.9, H * 0.25],
    [R, H * 0.6],
    [R * 0.95, H * 0.92],
    [R * 0.86, H],
    [R * 0.8, H * 0.96],
    [R * 0.88, H * 0.6],
    [R * 0.75, H * 0.25],
    [0, H * 0.18],
  ];
  const bowl = new THREE.Mesh(projectUVs(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 64)), wood);
  group.add(bowl);
  // A heap of stones filling the bowl.
  const rand = rng(seed);
  const geo = stoneGeometry(STONE_R, STONE_H);
  const n = 46;
  const heap = new THREE.InstancedMesh(geo, player === 1 ? STONE_MATERIALS.black : STONE_MATERIALS.white, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * R * 0.72;
    const y = H * 0.72 + (1 - rr / (R * 0.72)) * 0.014 + rand() * 0.004;
    q.setFromEuler(e.set((rand() - 0.5) * 0.9, rand() * 6, (rand() - 0.5) * 0.9));
    m.compose(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr), q, new THREE.Vector3(1, 1, 1));
    heap.setMatrixAt(i, m);
  }
  group.add(heap);
  // The lid, upside down beside the bowl.
  const lidProf: [number, number][] = [
    [0, 0.018],
    [R * 0.85, 0.016],
    [R * 0.92, 0.004],
    [R * 0.9, 0],
    [R * 0.8, 0.004],
    [0, 0.008],
  ];
  const lid = new THREE.Mesh(projectUVs(new THREE.LatheGeometry(lidProf.map(([x, y]) => new THREE.Vector2(x, y)), 64)), wood);
  lid.rotation.x = Math.PI;
  lid.position.set(R * 1.85, 0.018, R * 0.6);
  group.add(lid);
  group.traverse((o) => (o.castShadow = o.receiveShadow = true));
  return group;
}

interface Falling {
  slot: number;
  player: Player;
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  yaw: number;
  done: () => void;
}

const DROP_S = 0.22;

/**
 * Stones on the board: one instanced mesh per colour, a translucent ghost for
 * the hover position, a marker on the last move, and glowing rings for the
 * winning line.
 */
export class Stones {
  readonly group = new THREE.Group();
  private meshes: Record<Player, THREE.InstancedMesh>;
  private counts: Record<Player, number> = { 1: 0, 2: 0 };
  private ghost: Record<Player, THREE.Mesh>;
  private marker: THREE.Mesh;
  private markerMats: Record<Player, THREE.MeshBasicMaterial>;
  private winRings: THREE.InstancedMesh;
  private winMat: THREE.MeshBasicMaterial;
  private falling: Falling[] = [];
  private rand = rng(5);
  private time = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);

  constructor() {
    this.group.name = 'stones';
    const black = stoneGeometry(STONE_R, STONE_H);
    // White stones are cut a touch larger so both colours look the same size.
    const white = stoneGeometry(STONE_R * 1.02, STONE_H * 0.95);
    STONE_MATERIALS.white.map = shellTexture();
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(geo, mat, SIZE * SIZE);
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      // Stones move during the drop; recompute bounds rather than cull wrongly.
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.meshes = { 1: make(black, STONE_MATERIALS.black), 2: make(white, STONE_MATERIALS.white) };

    const ghostMat = (base: THREE.MeshPhysicalMaterial) => {
      const m = base.clone();
      m.transparent = true;
      m.opacity = 0.5;
      m.depthWrite = false;
      return m;
    };
    this.ghost = {
      1: new THREE.Mesh(black, ghostMat(STONE_MATERIALS.black)),
      2: new THREE.Mesh(white, ghostMat(STONE_MATERIALS.white)),
    };
    for (const g of Object.values(this.ghost)) {
      g.visible = false;
      this.group.add(g);
    }

    this.markerMats = {
      1: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.86, 0.8) }),
      2: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.1, 0.09) }),
    };
    this.marker = new THREE.Mesh(new THREE.RingGeometry(STONE_R * 0.3, STONE_R * 0.45, 32), this.markerMats[1]);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.group.add(this.marker);

    this.winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.6), transparent: true, depthWrite: false });
    this.winRings = new THREE.InstancedMesh(new THREE.RingGeometry(STONE_R * 1.05, STONE_R * 1.5, 40).rotateX(-Math.PI / 2), this.winMat, 24);
    this.winRings.count = 0;
    // Its bounds were computed with no instances placed; don't let them cull the rings.
    this.winRings.frustumCulled = false;
    this.group.add(this.winRings);
  }

  /** Places a stone with a short drop; resolves when it has settled. */
  place(cell: number, player: Player): Promise<void> {
    const mesh = this.meshes[player];
    const slot = mesh.count++;
    this.counts[player] = mesh.count;
    const to = cellPosition(cell);
    // Fingers never place a stone dead centre.
    to.x += (this.rand() - 0.5) * 0.0016;
    to.z += (this.rand() - 0.5) * 0.0016;
    const from = to.clone().add(new THREE.Vector3(0, 0.05, 0.03));
    const yaw = this.rand() * Math.PI * 2;
    this.setStone(mesh, slot, from, yaw);
    this.marker.visible = false;
    this.hideGhost();
    return new Promise((resolve) => {
      this.falling.push({ slot, player, t: 0, from, to, yaw, done: resolve });
    });
  }

  /** Removes the most recent stone of `player` (for undo). */
  removeLast(player: Player): void {
    const mesh = this.meshes[player];
    if (mesh.count === 0) return;
    this.falling = this.falling.filter((f) => !(f.player === player && f.slot === mesh.count - 1));
    mesh.count--;
    this.marker.visible = false;
    this.winRings.count = 0;
  }

  /** Puts the last-move marker on `cell`, coloured to contrast with `player`'s stone. */
  markLast(cell: number | null, player: Player): void {
    if (cell === null) {
      this.marker.visible = false;
      return;
    }
    cellPosition(cell, this.marker.position);
    this.marker.position.y = STONE_H + 0.0004;
    this.marker.material = this.markerMats[player];
    this.marker.visible = true;
  }

  showGhost(cell: number | null, player: Player): void {
    this.hideGhost();
    if (cell === null) return;
    const g = this.ghost[player];
    cellPosition(cell, g.position);
    g.visible = true;
  }

  highlight(cells: readonly number[]): void {
    this.winRings.count = Math.min(cells.length, 24);
    for (let i = 0; i < this.winRings.count; i++) {
      const p = cellPosition(cells[i]!);
      p.y = 0.0008;
      this.m.makeTranslation(p);
      this.winRings.setMatrixAt(i, this.m);
    }
    this.winRings.instanceMatrix.needsUpdate = true;
    this.marker.visible = false;
  }

  /** Clears every stone at once, finishing any drop in progress. */
  clear(): void {
    for (const f of this.falling) f.done();
    this.falling = [];
    this.meshes[1].count = this.meshes[2].count = 0;
    this.winRings.count = 0;
    this.marker.visible = false;
    this.hideGhost();
  }

  update(dt: number): void {
    this.time += dt;
    this.winMat.opacity = 0.6 + 0.4 * Math.sin(this.time * 4);
    if (this.falling.length === 0) return;
    const pos = new THREE.Vector3();
    this.falling = this.falling.filter((f) => {
      f.t = Math.min(1, f.t + dt / DROP_S);
      // Ease in (a hand bringing the stone down), with a tiny settle at the end.
      const k = f.t * f.t;
      pos.lerpVectors(f.from, f.to, k);
      if (f.t > 0.85) pos.y += Math.sin(((f.t - 0.85) / 0.15) * Math.PI) * 0.0008;
      this.setStone(this.meshes[f.player], f.slot, pos, f.yaw);
      if (f.t < 1) return true;
      f.done();
      return false;
    });
  }

  private setStone(mesh: THREE.InstancedMesh, slot: number, p: THREE.Vector3, yaw: number): void {
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.m.compose(p, this.q, this.one);
    mesh.setMatrixAt(slot, this.m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private hideGhost(): void {
    this.ghost[1].visible = this.ghost[2].visible = false;
  }
}
