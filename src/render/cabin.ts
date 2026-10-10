import * as THREE from 'three';
import { metricBox, pbr } from './assets';

/**
 * The great room, in metres. The dining table stands at the origin, the
 * player sits on its +z side, and the gable wall with the loft and the big
 * windows is at -z. The roof rises from eaves on both side walls to a ridge
 * running front to back.
 */
export const ROOM = { minX: -3.6, maxX: 3.9, minZ: -5.4, maxZ: 3.4, eave: 3.5, ridge: 6.1 };
/** x of the ridge: the middle of the room. */
export const RIDGE_X = (ROOM.minX + ROOM.maxX) / 2;
/** The loft across the back of the room: its floor height, depth and side edges. */
export const LOFT = { y: 2.75, depth: 1.6, x0: RIDGE_X - 2.45, x1: RIDGE_X + 2.45, slab: 0.26 };
/** Glazed openings. Back: under the loft and in the gable above it. Right: the long side wall. */
export const BACK_WINDOW = { x0: RIDGE_X - 1.75, x1: RIDGE_X + 1.75, y0: 0.06, y1: LOFT.y - 0.12 };
export const GABLE_WINDOW = { x0: RIDGE_X - 1.35, x1: RIDGE_X + 1.35, y0: LOFT.y + LOFT.slab + 0.2 };
export const SIDE_WINDOW = { z0: -5.0, z1: -0.55, y0: 0.06, y1: 3.25 };
export const WALL_T = 0.16;

/** Height of the underside of the roof at `x`. */
export function roofY(x: number): number {
  const half = (ROOM.maxX - ROOM.minX) / 2;
  return ROOM.eave + (ROOM.ridge - ROOM.eave) * (1 - Math.min(1, Math.abs(x - RIDGE_X) / half));
}

export interface Cabin {
  group: THREE.Group;
  /** Window glass, whose reflection map is filled in once the room has been captured. */
  glass: THREE.ShaderMaterial;
}

const glassVertex = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
// Reflection only, added on top of the view: a dark room behind the camera
// reflects little, the lamps and the fire reflect clearly.
const glassFragment = /* glsl */ `
  uniform samplerCube uEnv;
  uniform float uStrength;
  uniform vec3 uCapturePos;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec3 v = normalize(vWorldPos - cameraPosition);
    vec3 n = normalize(vNormal);
    if (dot(n, v) > 0.0) n = -n;
    vec3 r = reflect(v, n);
    // Crude parallax: look up the reflection from the reflected point's
    // direction as seen from where the room was captured.
    vec3 p = vWorldPos + r * 4.0;
    vec3 dir = normalize(p - uCapturePos);
    float cosT = clamp(-dot(v, n), 0.0, 1.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
    vec3 col = textureCube(uEnv, dir).rgb;
    gl_FragColor = vec4(col * fresnel * uStrength, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The vaulted timber room: walls, roof and rafters, the loft, window frames and glass, floor. */
export function createCabin(): Cabin {
  const group = new THREE.Group();
  group.name = 'cabin';
  const { minX, maxX, minZ, maxZ, eave } = ROOM;

  // Honey-toned boards running vertically on the walls and up the slope on the roof.
  const boards = pbr('hinoki_planks', { size: 1.4, rotation: Math.PI / 2, color: 0xd2bca6, normalScale: 0.8 });
  const roofBoards = pbr('hinoki_planks', { size: 1.4, color: 0xc4ab92, normalScale: 0.8 });
  const beamWood = pbr('oak_veneer_01', { size: 2.2, color: 0x6a4a34, roughness: 0.85 });
  beamWood.roughnessMap = null;
  const frameMetal = new THREE.MeshStandardMaterial({ color: 0x141312, metalness: 0.35, roughness: 0.55 });

  const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const box = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) =>
    add(new THREE.Mesh(metricBox(w, h, d), mat), x, y, z);

  // Floor: wide oak boards running towards the windows.
  box(
    pbr('laminate_floor_02', { size: 1.7, rotation: Math.PI / 2, color: 0xe0b98c, normalScale: 0.6 }),
    maxX - minX,
    0.05,
    maxZ - minZ,
    (minX + maxX) / 2,
    -0.025,
    (minZ + maxZ) / 2,
  ).name = 'floor';

  // Gable walls. The back one has the windows under the loft and in the gable.
  const gable = (holes: THREE.Path[]) => {
    const s = new THREE.Shape();
    s.moveTo(minX - WALL_T, 0);
    s.lineTo(maxX + WALL_T, 0);
    s.lineTo(maxX + WALL_T, eave);
    s.lineTo(RIDGE_X, ROOM.ridge + 0.1);
    s.lineTo(minX - WALL_T, eave);
    s.closePath();
    s.holes.push(...holes);
    return new THREE.ExtrudeGeometry(s, { depth: WALL_T, bevelEnabled: false });
  };
  const bw = BACK_WINDOW;
  const gw = GABLE_WINDOW;
  const gableTop = (x: number) => roofY(x) - 0.35;
  const lowerHole = new THREE.Path().moveTo(bw.x0, bw.y0).lineTo(bw.x1, bw.y0).lineTo(bw.x1, bw.y1).lineTo(bw.x0, bw.y1);
  const upperHole = new THREE.Path()
    .moveTo(gw.x0, gw.y0)
    .lineTo(gw.x1, gw.y0)
    .lineTo(gw.x1, gableTop(gw.x1))
    .lineTo(RIDGE_X, gableTop(RIDGE_X))
    .lineTo(gw.x0, gableTop(gw.x0));
  add(new THREE.Mesh(gable([lowerHole, upperHole]), boards), 0, 0, minZ - WALL_T);
  add(new THREE.Mesh(gable([]), boards), 0, 0, maxZ);

  // Side walls. The right one is glazed along most of its length.
  box(boards, WALL_T, eave, maxZ - minZ, minX - WALL_T / 2, eave / 2, (minZ + maxZ) / 2);
  const sw = SIDE_WINDOW;
  const right = new THREE.Shape();
  right.moveTo(minZ, 0);
  right.lineTo(maxZ, 0);
  right.lineTo(maxZ, eave);
  right.lineTo(minZ, eave);
  right.closePath();
  right.holes.push(new THREE.Path().moveTo(sw.z0, sw.y0).lineTo(sw.z1, sw.y0).lineTo(sw.z1, sw.y1).lineTo(sw.z0, sw.y1));
  const rightWall = add(new THREE.Mesh(new THREE.ExtrudeGeometry(right, { depth: WALL_T, bevelEnabled: false }), boards), maxX, 0, 0);
  // Shape x runs along world +z and the extrusion towards -x, ending flush with the room.
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.x = maxX + WALL_T;

  // Roof: two slopes of boards, rafters under them and a ridge beam.
  const half = (maxX - minX) / 2;
  const slopeLen = Math.hypot(half, ROOM.ridge - eave) + 0.35;
  const pitch = Math.atan2(ROOM.ridge - eave, half);
  const depth = maxZ - minZ + WALL_T * 2;
  for (const side of [-1, 1]) {
    const roof = box(roofBoards, slopeLen, 0.06, depth, RIDGE_X + (side * half) / 2, (eave + ROOM.ridge) / 2 + 0.03, (minZ + maxZ) / 2);
    roof.rotation.z = -side * pitch;
    // Rafters: dark timber beams, every 1.5 m, from the eaves to the ridge.
    for (let z = minZ + 0.45; z < maxZ - 0.2; z += 1.5) {
      const r = box(beamWood, slopeLen - 0.3, 0.22, 0.12, RIDGE_X + (side * half) / 2, (eave + ROOM.ridge) / 2 - 0.1, z);
      r.rotation.z = -side * pitch;
      r.castShadow = true;
    }
  }
  box(beamWood, 0.24, 0.3, depth, RIDGE_X, ROOM.ridge - 0.12, (minZ + maxZ) / 2);
  // Wall plates along the tops of the side walls.
  for (const x of [minX + 0.09, maxX - 0.09]) box(beamWood, 0.18, 0.2, maxZ - minZ, x, eave - 0.06, (minZ + maxZ) / 2);

  createLoft(group, boards, beamWood);
  const glass = createWindows(group, frameMetal);
  group.add(createDownlights());
  group.add(createPicture());
  return { group, glass };
}

/** The loft across the back: a slab on two posts, a timber railing, and furniture glimpsed behind it. */
function createLoft(group: THREE.Group, boards: THREE.Material, beam: THREE.Material): void {
  const { y, depth, x0, x1, slab } = LOFT;
  const z0 = ROOM.minZ;
  const z1 = ROOM.minZ + depth;
  const w = x1 - x0;
  const add = (mat: THREE.Material, bw: number, bh: number, bd: number, x: number, yy: number, z: number, cast = true) => {
    const m = new THREE.Mesh(metricBox(bw, bh, bd), mat);
    m.position.set(x, yy, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // Slab with a thick timber fascia.
  add(boards, w, slab, depth, (x0 + x1) / 2, y + slab / 2, (z0 + z1) / 2);
  add(beam, w + 0.1, slab + 0.06, 0.14, (x0 + x1) / 2, y + slab / 2 - 0.03, z1 + 0.04);
  // Posts at the loft's front corners, framing the windows below.
  for (const x of [x0, x1]) add(beam, 0.18, y, 0.18, x, y / 2, z1 - 0.02);
  // Floor on the loft.
  const top = y + slab;
  // Railing: posts, a handrail, a bottom rail and close-set balusters.
  const railH = 0.98;
  const rail = (len: number, x: number, z: number, alongX: boolean) => {
    const rw = alongX ? len : 0.07;
    const rd = alongX ? 0.07 : len;
    add(beam, rw, 0.06, rd, x, top + railH, z);
    add(beam, alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, x, top + 0.09, z);
    const n = Math.round(len / 0.13);
    const geo = metricBox(0.032, railH - 0.12, 0.032);
    const balusters = new THREE.InstancedMesh(geo, beam, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      m.makeTranslation(alongX ? x + t * len : x, top + 0.06 + (railH - 0.12) / 2, alongX ? z : z + t * len);
      balusters.setMatrixAt(i, m);
    }
    balusters.castShadow = true;
    group.add(balusters);
  };
  rail(w, (x0 + x1) / 2, z1 - 0.05, true);
  for (const x of [x0 + 0.04, x1 - 0.04]) {
    rail(depth - 0.1, x, (z0 + z1) / 2, false);
    add(beam, 0.1, railH + 0.06, 0.1, x, top + (railH + 0.06) / 2, z1 - 0.05);
  }

  // Up in the loft: a low bookcase on the left and a daybed under the gable window.
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c221a, roughness: 0.8 });
  add(beam, 1.1, 0.9, 0.35, x0 + 0.75, top + 0.45, z0 + 0.22);
  add(dark, 1.0, 0.8, 0.3, x0 + 0.75, top + 0.45, z0 + 0.24, false);
  const linen = new THREE.MeshStandardMaterial({ color: 0xcfc3b0, roughness: 0.95 });
  add(linen, 1.6, 0.42, 0.8, x1 - 1.2, top + 0.21, z0 + 0.6);
  add(linen, 0.45, 0.35, 0.16, x1 - 1.6, top + 0.55, z0 + 0.32);
  add(linen, 0.45, 0.35, 0.16, x1 - 0.9, top + 0.55, z0 + 0.32);
  // A small lamp glowing up there.
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.13, 0.2, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf1e6d2, emissive: new THREE.Color(1, 0.6, 0.28), emissiveIntensity: 1.1, side: THREE.DoubleSide }),
  );
  shade.position.set(x0 + 1.05, top + 1.1, z0 + 0.22);
  const lamp = new THREE.PointLight(0xffb070, 0.8, 0, 2);
  lamp.position.set(x0 + 1.05, top + 1.08, z0 + 0.3);
  group.add(shade, lamp);
}

/** Dark steel frames and mullions, plus reflection-only glass in every opening. */
function createWindows(group: THREE.Group, metal: THREE.Material): THREE.ShaderMaterial {
  const F = 0.055;
  const frame = (w: number, h: number, d: number, x: number, y: number, z: number, rotZ = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), metal);
    m.position.set(x, y, z);
    m.rotation.z = rotZ;
    m.receiveShadow = true;
    group.add(m);
  };
  const glass = new THREE.ShaderMaterial({
    vertexShader: glassVertex,
    fragmentShader: glassFragment,
    uniforms: {
      uEnv: { value: null },
      uStrength: { value: 0 },
      uCapturePos: { value: new THREE.Vector3() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pane = (geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, glass);
    m.renderOrder = 5;
    group.add(m);
    return m;
  };

  // Back wall, under the loft: two tall panes split by a mullion.
  const bw = BACK_WINDOW;
  const bz = ROOM.minZ - WALL_T / 2;
  const D = WALL_T + 0.02;
  const bwW = bw.x1 - bw.x0;
  frame(bwW, F, D, (bw.x0 + bw.x1) / 2, bw.y0 + F / 2, bz);
  frame(bwW, F, D, (bw.x0 + bw.x1) / 2, bw.y1 - F / 2, bz);
  for (const x of [bw.x0 + F / 2, (bw.x0 + bw.x1) / 2, bw.x1 - F / 2]) frame(F, bw.y1 - bw.y0, D, x, (bw.y0 + bw.y1) / 2, bz);
  pane(new THREE.PlaneGeometry(bwW, bw.y1 - bw.y0)).position.set((bw.x0 + bw.x1) / 2, (bw.y0 + bw.y1) / 2, bz);

  // Gable window: two panes whose tops follow the roof.
  const gw = GABLE_WINDOW;
  const top = (x: number) => roofY(x) - 0.35;
  const gs = new THREE.Shape()
    .moveTo(gw.x0, gw.y0)
    .lineTo(gw.x1, gw.y0)
    .lineTo(gw.x1, top(gw.x1))
    .lineTo(RIDGE_X, top(RIDGE_X))
    .lineTo(gw.x0, top(gw.x0));
  pane(new THREE.ShapeGeometry(gs)).position.z = bz;
  frame(gw.x1 - gw.x0, F, D, RIDGE_X, gw.y0 + F / 2, bz);
  frame(F, top(RIDGE_X) - gw.y0, D, RIDGE_X, (gw.y0 + top(RIDGE_X)) / 2, bz);
  for (const x of [gw.x0 + F / 2, gw.x1 - F / 2]) frame(F, top(x) - gw.y0, D, x, (gw.y0 + top(x)) / 2, bz);
  const pitch = Math.atan2(ROOM.ridge - ROOM.eave, (ROOM.maxX - ROOM.minX) / 2);
  const slant = Math.hypot(RIDGE_X - gw.x0, top(RIDGE_X) - top(gw.x0));
  frame(slant, F, D, (gw.x0 + RIDGE_X) / 2, (top(gw.x0) + top(RIDGE_X)) / 2 - F / 2, bz, pitch);
  frame(slant, F, D, (gw.x1 + RIDGE_X) / 2, (top(gw.x1) + top(RIDGE_X)) / 2 - F / 2, bz, -pitch);

  // Right wall: three tall panes.
  const sw = SIDE_WINDOW;
  const sx = ROOM.maxX + WALL_T / 2;
  const swL = sw.z1 - sw.z0;
  frame(D, F, swL, sx, sw.y0 + F / 2, (sw.z0 + sw.z1) / 2);
  frame(D, F, swL, sx, sw.y1 - F / 2, (sw.z0 + sw.z1) / 2);
  for (let k = 0; k <= 3; k++) frame(D, sw.y1 - sw.y0, F * (k === 0 || k === 3 ? 1 : 1.3), sx, (sw.y0 + sw.y1) / 2, sw.z0 + F / 2 + (k / 3) * (swL - F));
  const side = pane(new THREE.PlaneGeometry(swL, sw.y1 - sw.y0));
  side.rotation.y = -Math.PI / 2;
  side.position.set(sx, (sw.y0 + sw.y1) / 2, (sw.z0 + sw.z1) / 2);
  return glass;
}

/** Positions (x, z) of the recessed lights in the roof slopes and under the loft. */
export const DOWNLIGHTS: [number, number][] = [
  [-2.3, -2.6],
  [2.5, -2.6],
  [-2.3, 0.3],
  [2.5, 0.3],
  [-1.2, -4.9],
  [1.5, -4.9],
];

/** Height of a downlight: in the roof, or under the loft slab. */
export function downlightY(x: number, z: number): number {
  return z < ROOM.minZ + LOFT.depth && x > LOFT.x0 && x < LOFT.x1 ? LOFT.y : roofY(x) - 0.02;
}

function createDownlights(): THREE.Group {
  const lights = new THREE.Group();
  const trim = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 });
  const lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.3) });
  const ring = new THREE.CylinderGeometry(0.05, 0.05, 0.03, 24);
  const disc = new THREE.CircleGeometry(0.034, 20);
  const pitch = Math.atan2(ROOM.ridge - ROOM.eave, (ROOM.maxX - ROOM.minX) / 2);
  for (const [x, z] of DOWNLIGHTS) {
    const y = downlightY(x, z);
    const tilt = y === LOFT.y ? 0 : x < RIDGE_X ? pitch : -pitch;
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.z = tilt;
    const r = new THREE.Mesh(ring, trim);
    const l = new THREE.Mesh(disc, lens);
    l.rotation.x = Math.PI / 2;
    l.position.y = -0.016;
    holder.add(r, l);
    lights.add(holder);
  }
  return lights;
}

/** A framed print of a mountain on the back wall, right of the loft. */
function createPicture(): THREE.Group {
  const pic = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 360;
  const ctx = c.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 360);
  sky.addColorStop(0, '#2c3442');
  sky.addColorStop(1, '#7d8794');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 256, 360);
  ctx.fillStyle = '#c9d0d8';
  ctx.beginPath();
  ctx.moveTo(0, 270);
  ctx.lineTo(80, 160);
  ctx.lineTo(120, 190);
  ctx.lineTo(175, 105);
  ctx.lineTo(256, 230);
  ctx.lineTo(256, 360);
  ctx.lineTo(0, 360);
  ctx.fill();
  ctx.fillStyle = '#3c434c';
  ctx.fillRect(0, 300, 256, 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const art = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  art.position.z = 0.016;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.03), new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 0.6 }));
  pic.add(frame, art);
  pic.position.set((LOFT.x1 + ROOM.maxX) / 2 + 0.05, 1.75, ROOM.minZ + 0.02);
  return pic;
}
