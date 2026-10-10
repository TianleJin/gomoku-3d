import * as THREE from 'three';
import { metricBox, pbr } from './assets';
import { ROOM } from './cabin';
import { endGrainTexture, rng, woodTexture } from './textures';

/*
 * The fireplace wall on the left: a timber-clad chimney breast with a wide,
 * low firebox, an open log store beside it and shelves above the logs.
 * Local frame: +z points into the room (world +x), +x runs towards the back
 * of the room (world -z); the origin is on the wall, at floor level.
 */
const BREAST_W = 2.4;
const BREAST_D = 0.42;
/** Firebox opening: centre (local x), width, height, height of its bottom, depth. */
const FIRE = { x: 0.3, w: 1.0, h: 0.48, y: 0.52, depth: 0.34 };
/** Open log store beside the fire, and the shelf niche above it. */
const NICHE = { x: -0.62, w: 0.6, y: 0.06, h: 1.02, depth: 0.36 };
const SHELVES = { x: -0.62, w: 0.6, y: 1.2, h: 1.35, depth: 0.3 };
/** Candela of the fire's light. */
const FIRE_POWER = 5;
/** World z of the breast's centre along the left wall. */
export const FIREPLACE_Z = -1.55;
export const FIREPLACE_DEPTH = BREAST_D;
/** World positions (x, y, z) of the shelf boards above the log store, for dressing them. */
export const FIRE_SHELVES = {
  x: ROOM.minX + BREAST_D - 0.04 - SHELVES.depth / 2,
  z: FIREPLACE_Z - SHELVES.x,
  width: SHELVES.w,
  depth: SHELVES.depth,
  ys: [SHELVES.y + 0.01, SHELVES.y + SHELVES.h * 0.36 + 0.0125, SHELVES.y + SHELVES.h * 0.7 + 0.0125],
};

const flameVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flameFragment = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uIntensity;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    float n = fbm(vec2(uv.x * 3.0 + uSeed, uv.y * 2.2 - uTime * 1.7));
    float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 0.7 * uv.y;
    // Tongues of flame: wide at the base, narrowing and breaking up towards the top.
    float width = mix(0.85, 0.05, pow(uv.y, 0.7));
    float shape = 1.0 - smoothstep(width * 0.5, width, abs(x));
    float body = shape * (1.0 - smoothstep(0.15, 0.95, uv.y + (n - 0.5) * 0.6));
    body *= smoothstep(0.0, 0.06, uv.y);
    float heat = clamp(body * 1.7 - uv.y * 0.35, 0.0, 1.0);
    vec3 col = mix(vec3(0.9, 0.12, 0.0), vec3(1.0, 0.5, 0.08), smoothstep(0.1, 0.55, heat));
    col = mix(col, vec3(1.0, 0.85, 0.5), smoothstep(0.6, 1.0, heat));
    float a = smoothstep(0.03, 0.45, body);
    gl_FragColor = vec4(col * a * uIntensity, a);
  }
`;

export interface Fireplace {
  group: THREE.Group;
  update(time: number, dt: number, camera: THREE.Camera): void;
}

export function createFireplace(): Fireplace {
  const group = new THREE.Group();
  group.name = 'fireplace';
  group.rotation.y = Math.PI / 2;
  group.position.set(ROOM.minX, 0, FIREPLACE_Z);

  const boards = pbr('hinoki_planks', { size: 1.4, rotation: Math.PI / 2, color: 0xc8b29c, normalScale: 0.8 });
  const darkWood = pbr('hinoki_planks', { size: 1.4, rotation: Math.PI / 2, color: 0x3a2a1e, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x0f0f10, metalness: 0.35, roughness: 0.5 });
  const box = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, cast = false) => {
    const m = new THREE.Mesh(metricBox(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Front face of the breast, with the three openings cut out.
  const H = ROOM.eave;
  const T = 0.04;
  const face = new THREE.Shape();
  face.moveTo(-BREAST_W / 2, 0);
  face.lineTo(BREAST_W / 2, 0);
  face.lineTo(BREAST_W / 2, H);
  face.lineTo(-BREAST_W / 2, H);
  face.closePath();
  const rect = (x: number, w: number, y: number, h: number) =>
    new THREE.Path().moveTo(x - w / 2, y).lineTo(x - w / 2, y + h).lineTo(x + w / 2, y + h).lineTo(x + w / 2, y).closePath();
  face.holes.push(rect(FIRE.x, FIRE.w + 0.12, FIRE.y - 0.06, FIRE.h + 0.12));
  face.holes.push(rect(NICHE.x, NICHE.w, NICHE.y, NICHE.h));
  face.holes.push(rect(SHELVES.x, SHELVES.w, SHELVES.y, SHELVES.h));
  const front = new THREE.Mesh(new THREE.ExtrudeGeometry(face, { depth: T, bevelEnabled: false }), boards);
  front.position.z = BREAST_D - T;
  front.receiveShadow = true;
  group.add(front);
  for (const s of [-1, 1]) box(boards, T, H, BREAST_D, s * (BREAST_W / 2 - T / 2), H / 2, BREAST_D / 2);
  // A thin black hearth ledge under the fire.
  box(steel, FIRE.w + 0.5, 0.03, 0.12, FIRE.x, FIRE.y - 0.075, BREAST_D + 0.05, true);

  // Dark-lined niches: the log store, and the shelves above it.
  const niche = (n: typeof NICHE) => {
    const z = BREAST_D - T - n.depth / 2;
    box(darkWood, n.w, n.h, 0.02, n.x, n.y + n.h / 2, BREAST_D - T - n.depth);
    for (const s of [-1, 1]) box(darkWood, 0.02, n.h, n.depth, n.x + (s * n.w) / 2, n.y + n.h / 2, z);
    box(darkWood, n.w, 0.02, n.depth, n.x, n.y, z);
    box(darkWood, n.w, 0.02, n.depth, n.x, n.y + n.h, z);
  };
  niche(NICHE);
  group.add(logStack(NICHE.w - 0.03, NICHE.h - 0.03, NICHE.depth - 0.02, NICHE.x, NICHE.y + 0.01, BREAST_D - T - NICHE.depth / 2, 5));
  niche(SHELVES);
  for (const y of [SHELVES.y + SHELVES.h * 0.36, SHELVES.y + SHELVES.h * 0.7]) {
    box(darkWood, SHELVES.w, 0.025, SHELVES.depth, SHELVES.x, y, BREAST_D - T - SHELVES.depth / 2);
  }

  // Firebox: a black steel frame around a sooty lining.
  const fz = BREAST_D - FIRE.depth / 2;
  const FR = 0.06;
  box(steel, FIRE.w + FR * 2, FR, 0.05, FIRE.x, FIRE.y + FIRE.h + FR / 2, BREAST_D + 0.005, true);
  box(steel, FIRE.w + FR * 2, FR, 0.05, FIRE.x, FIRE.y - FR / 2, BREAST_D + 0.005, true);
  for (const s of [-1, 1]) box(steel, FR, FIRE.h, 0.05, FIRE.x + s * (FIRE.w / 2 + FR / 2), FIRE.y + FIRE.h / 2, BREAST_D + 0.005, true);
  const lining = new THREE.Mesh(
    new THREE.BoxGeometry(FIRE.w, FIRE.h, FIRE.depth),
    new THREE.MeshStandardMaterial({ color: 0x241a15, roughness: 1, emissive: 0x3a1004, side: THREE.BackSide }),
  );
  lining.position.set(FIRE.x, FIRE.y + FIRE.h / 2, fz);
  group.add(lining);
  const doorGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(FIRE.w, FIRE.h),
    new THREE.MeshPhysicalMaterial({ color: 0x302820, roughness: 0.05, transparent: true, opacity: 0.1, depthWrite: false }),
  );
  doorGlass.position.set(FIRE.x, FIRE.y + FIRE.h / 2, BREAST_D - 0.01);
  doorGlass.renderOrder = 3;
  group.add(doorGlass);

  // Logs and embers on the grate.
  const fireY = FIRE.y + 0.01;
  const barkTex = woodTexture(20, 16, 71);
  barkTex.rotation = Math.PI / 2;
  const bark = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1, emissive: 0xff3a00, emissiveIntensity: 0.15 });
  const logGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.5, 12);
  for (const [lx, ly, lz, yaw] of [
    [-0.12, 0.038, -0.05, 0.08],
    [0.14, 0.038, 0.04, -0.1],
    [0.02, 0.1, 0, 0.35],
  ] as [number, number, number, number][]) {
    const log = new THREE.Mesh(logGeo, bark);
    log.rotation.set(0, yaw, Math.PI / 2);
    log.position.set(FIRE.x + lx, fireY + ly, fz + lz);
    group.add(log);
  }
  const embersBed = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.35, 0.05) }));
  embersBed.rotation.x = -Math.PI / 2;
  embersBed.scale.set(2.1, 0.6, 1);
  embersBed.position.set(FIRE.x, fireY + 0.003, fz);
  group.add(embersBed);

  // Flames: noise-driven billboards along the logs, each turning to face the camera.
  const flames: THREE.Group[] = [];
  const flameMats: THREE.ShaderMaterial[] = [];
  for (const [fx, fw, fh, seed] of [
    [-0.3, 0.26, 0.26, 0],
    [-0.1, 0.32, 0.36, 3.1],
    [0.12, 0.3, 0.32, 7.7],
    [0.32, 0.24, 0.24, 12.3],
    [0.02, 0.2, 0.22, 17.9],
  ] as [number, number, number, number][]) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uIntensity: { value: 1.3 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    flameMats.push(mat);
    const holder = new THREE.Group();
    holder.position.set(FIRE.x + fx, fireY + 0.03, fz + (seed % 3) * 0.01);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), mat);
    plane.position.y = fh / 2;
    plane.renderOrder = 2;
    holder.add(plane);
    group.add(holder);
    flames.push(holder);
  }

  // Sparks rising inside the box.
  const SPARKS = 30;
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkVel: number[] = [];
  const rand = rng(17);
  const resetSpark = (i: number, initial: boolean) => {
    sparkPos[i * 3] = (rand() - 0.5) * FIRE.w * 0.8;
    sparkPos[i * 3 + 1] = initial ? rand() * FIRE.h : 0.04;
    sparkPos[i * 3 + 2] = (rand() - 0.5) * 0.15;
    sparkVel[i] = 0.12 + rand() * 0.25;
  };
  for (let i = 0; i < SPARKS; i++) resetSpark(i, true);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(
    sparkGeo,
    new THREE.PointsMaterial({ color: new THREE.Color(3, 1.2, 0.3), size: 0.01, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  sparks.position.set(FIRE.x, fireY, fz);
  group.add(sparks);

  // The fire's light, just in front of the opening so it reaches the room.
  // No shadows: a cube shadow map would redraw the scene six times a frame.
  const light = new THREE.PointLight(0xff8a3a, FIRE_POWER, 0, 2);
  const lightBase = new THREE.Vector3(FIRE.x, fireY + 0.18, BREAST_D + 0.15);
  light.position.copy(lightBase);
  group.add(light);

  const toCamera = new THREE.Vector3();
  const local = new THREE.Vector3();
  return {
    group,
    update(time, dt, camera) {
      // Layered sines at unrelated frequencies read as a natural flicker.
      const f = 0.75 + 0.12 * Math.sin(time * 7.3) + 0.08 * Math.sin(time * 13.1 + 1.3) + 0.05 * Math.sin(time * 23.7 + 0.4);
      light.intensity = FIRE_POWER * f;
      light.position.set(lightBase.x + Math.sin(time * 5.1) * 0.05, lightBase.y + Math.sin(time * 6.7) * 0.02, lightBase.z);
      bark.emissiveIntensity = 0.12 + 0.1 * f;
      for (const mat of flameMats) mat.uniforms.uTime!.value = time;
      // Billboard the flames around their vertical axis, in the group's frame.
      group.worldToLocal(local.copy(camera.position));
      for (const h of flames) {
        toCamera.subVectors(local, h.position);
        h.rotation.y = Math.atan2(toCamera.x, toCamera.z);
      }
      for (let i = 0; i < SPARKS; i++) {
        const y = sparkPos[i * 3 + 1]! + sparkVel[i]! * dt;
        sparkPos[i * 3 + 1] = y;
        sparkPos[i * 3] = sparkPos[i * 3]! + Math.sin(time * 3 + i) * 0.02 * dt;
        if (y > FIRE.h * 0.9) resetSpark(i, false);
      }
      sparkGeo.attributes.position!.needsUpdate = true;
    },
  };
}

/**
 * Logs stacked end-on (pointing along z), filling a w x h box whose bottom
 * centre is at (x, y, z).
 */
export function logStack(w: number, h: number, depth: number, x: number, y: number, z: number, seed: number): THREE.InstancedMesh {
  const rand = rng(seed);
  const barkTex = woodTexture(22, 20, seed + 100);
  barkTex.rotation = Math.PI / 2;
  const bark = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1 });
  const ends = new THREE.MeshStandardMaterial({ map: endGrainTexture(seed), roughness: 0.95 });
  const geo = new THREE.CylinderGeometry(1, 1, 1, 9);
  geo.rotateX(Math.PI / 2);

  const slots: [number, number, number][] = [];
  const r0 = 0.055;
  let row = 0;
  for (let cy = r0; cy + r0 * 0.6 < h; cy += r0 * 1.75, row++) {
    for (let cx = -w / 2 + r0 + (row % 2) * r0; cx + r0 * 0.8 < w / 2; cx += r0 * 2) {
      slots.push([cx, cy, r0 * (0.8 + rand() * 0.35)]);
    }
  }
  // Cylinder groups: 0 is the side, 1 and 2 are the caps.
  const mesh = new THREE.InstancedMesh(geo, [bark, ends, ends], slots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  slots.forEach(([cx, cy, r], i) => {
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.06, (rand() - 0.5) * 0.06, rand() * 6));
    m.compose(p.set(x + cx, y + cy, z + (rand() - 0.5) * 0.04), q, s.set(r, r, depth * (0.92 + rand() * 0.1)));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setScalar(0.75 + rand() * 0.3));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
