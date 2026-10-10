import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pbr, skyBackdrop } from './assets';
import { RIDGE_X, ROOM } from './cabin';
import { dotTexture, rng } from './textures';

/**
 * Brightness of the outdoors relative to the photographed sky: blue hour,
 * the sun just down. Used for the backdrop, the outdoor environment light
 * and the haze, so the three stay consistent.
 */
export const DUSK = 0.95;
/** The sky itself reads brighter than what it lights: it's the brightest thing in view. */
const SKY_EXPOSURE = 0.8;
/** Sky tint for the blue hour: cooler and less saturated than the photo. */
const SKY_TINT = new THREE.Color(0.32, 0.56, 1.45);
/** Colour the far landscape fades into; matches the sky near the horizon. */
export const HAZE = new THREE.Color(0.36, 0.43, 0.56).multiplyScalar(DUSK);

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 1800.0, 1.0);
  }
`;
// Equirectangular lookup of the 4k backdrop by view direction.
const skyFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uTint;
  uniform float uExposure;
  uniform float uYaw;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float u = atan(d.x, -d.z) / 6.2831853 + 0.5 + uYaw;
    float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
    vec3 col = texture2D(uMap, vec2(u, v)).rgb;
    float grey = dot(col, vec3(0.3, 0.55, 0.15));
    col = mix(vec3(grey), col, 0.75) * uTint * uExposure;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface Outdoors {
  group: THREE.Group;
  /** Gives every outdoor material the sky's light (an equirect env map from the HDR). */
  setSkyLight(env: THREE.Texture): void;
  update(time: number, dt: number): void;
}

/** Smooth value noise in 2D, from a seeded lattice. */
function makeNoise(seed: number): (x: number, y: number) => number {
  const rand = rng(seed);
  const N = 256;
  const table = new Float32Array(N * N).map(() => rand());
  const at = (i: number, j: number) => table[((i & (N - 1)) * N + (j & (N - 1))) | 0]!;
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}
const noise = makeNoise(7);
function fbm(x: number, y: number, octaves = 5): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += a * noise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return v;
}
function ridged(x: number, y: number, octaves = 6): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x * f, y * f) * 2 - 1);
    v += a * n * n;
    f *= 2.1;
    a *= 0.5;
  }
  return v;
}

/** Radius from the cabin where the far terrain mesh takes over from the near ground. */
const VALLEY_R0 = 170;
/** Individual trees stop here; beyond, the terrain's colouring carries the forest. */
const FOREST_R = 140;

/** Level snow runs this far out from the back glass before the hillside drops away. */
const DECK = 3.0;
const DECK_Z = ROOM.minZ - 0.2 - DECK;

/**
 * Ground height outside: level snow around the cabin and its deck, then a
 * slope falling away into the forested valley.
 */
function valleyFloor(d: number): number {
  return -0.2 - Math.min(d, 25) * 0.6 - Math.max(0, d - 25) * 0.11;
}

export function groundHeight(x: number, z: number): number {
  const dz = Math.max(0, DECK_Z - z);
  const dx = Math.max(0, x - (ROOM.maxX + 4));
  const d = Math.hypot(dz, dx * 0.7);
  const fall = valleyFloor(d);
  const lumps = (fbm(x * 0.08, z * 0.08, 3) - 0.5) * Math.min(1.5, 0.15 + d * 0.06);
  return fall + lumps;
}

/** Snowy blue-hour landscape: sky, mountains, a forested valley, the deck and falling snow. */
export function createOutdoors(): Outdoors {
  const group = new THREE.Group();
  group.name = 'outdoors';
  const outdoorMats: THREE.MeshStandardMaterial[] = [];

  // Sky backdrop, drawn at infinity.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: {
        uMap: { value: skyBackdrop() },
        uTint: { value: SKY_TINT },
        uExposure: { value: SKY_EXPOSURE },
        // Turn the sunset glow off to the right, out of the main view.
        uYaw: { value: 0.22 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  group.add(sky);

  group.add(createMountains(outdoorMats));

  // Snow ground: level near the cabin, then falling away down the valley.
  const ground = new THREE.PlaneGeometry(400, 400, 260, 260);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position!;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i);
    const z = gp.getZ(i);
    // Past where the far terrain takes over, dip below it so the seam never shows.
    const r = Math.hypot(x, z);
    gp.setY(i, groundHeight(x, z) - Math.max(0, r - VALLEY_R0 - 5) * 0.6);
  }
  ground.computeVertexNormals();
  const guv = ground.attributes.uv!;
  for (let i = 0; i < guv.count; i++) guv.setXY(i, gp.getX(i), gp.getZ(i));
  const snowMat = pbr('snow_02', { size: 2.2, color: 0xe8eef8, normalScale: 0.7 });
  outdoorMats.push(snowMat);
  const snow = new THREE.Mesh(ground, snowMat);
  snow.receiveShadow = true;
  group.add(snow);

  group.add(createForest(outdoorMats));

  // A lantern glowing in the snow outside the back windows.
  const lantern = createDeckLantern();
  lantern.position.set(RIDGE_X - 1.1, groundHeight(RIDGE_X - 1.1, ROOM.minZ - 1.4) + 0.02, ROOM.minZ - 1.4);
  group.add(lantern);

  // Light snowfall outside the glass.
  const FLAKES = 1400;
  const flakePos = new Float32Array(FLAKES * 3);
  const flakeSpeed = new Float32Array(FLAKES);
  const rand = rng(101);
  const AREA = { x0: -14, x1: 18, z0: -26, z1: ROOM.minZ - 0.4, top: 9 };
  for (let i = 0; i < FLAKES; i++) {
    flakePos[i * 3] = AREA.x0 + rand() * (AREA.x1 - AREA.x0);
    flakePos[i * 3 + 1] = rand() * AREA.top - 2;
    flakePos[i * 3 + 2] = AREA.z0 + rand() * (AREA.z1 - AREA.z0);
    flakeSpeed[i] = 0.3 + rand() * 0.45;
  }
  const flakeGeo = new THREE.BufferGeometry();
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3));
  const flakes = new THREE.Points(
    flakeGeo,
    new THREE.PointsMaterial({
      map: dotTexture(),
      color: new THREE.Color(0.55, 0.6, 0.7),
      size: 0.03,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  );
  flakes.frustumCulled = false;
  group.add(flakes);

  return {
    group,
    setSkyLight(env) {
      for (const m of outdoorMats) {
        m.envMap = env;
        m.envMapIntensity = DUSK;
        m.needsUpdate = true;
      }
    },
    update(time, dt) {
      for (let i = 0; i < FLAKES; i++) {
        let y = flakePos[i * 3 + 1]! - flakeSpeed[i]! * dt;
        if (y < -2) y += AREA.top;
        flakePos[i * 3 + 1] = y;
        flakePos[i * 3] = flakePos[i * 3]! + Math.sin(time * 0.7 + i) * 0.1 * dt;
      }
      flakeGeo.attributes.position!.needsUpdate = true;
    },
  };
}

/**
 * A band of snow-capped mountains across the far side of the valley:
 * ridged noise on a fan of terrain, snow on the gentler slopes, dark rock on
 * the steep ones.
 */
function createMountains(mats: THREE.MeshStandardMaterial[]): THREE.Mesh {
  const A = 360; // samples around
  const R = 130; // samples outwards
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= R; j++) {
    const t = j / R;
    const r = VALLEY_R0 + t * t * 1300;
    for (let i = 0; i <= A; i++) {
      const a = -1.45 + (i / A) * 2.9; // angle from -z, towards +x
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      // Peaks rise with distance; a broad saddle straight ahead opens the valley view.
      // The valley floor carries on from the near slope, then the peaks rise
      // beyond it; a broad saddle straight ahead opens the view.
      const floor = Math.max(-70, valleyFloor(r));
      const envelope = THREE.MathUtils.smoothstep(r, 360, 700) * (0.6 + 0.4 * Math.min(1, Math.abs(a - 0.05) * 2.2));
      const h = ridged(x * 0.0032 + 3, z * 0.0032 + 7, 8) * 280 * envelope + fbm(x * 0.02, z * 0.02, 4) * (6 + 20 * envelope);
      pos.push(x, floor + h, z);
    }
  }
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < A; i++) {
      const a = j * (A + 1) + i;
      const b = a + 1;
      const c = a + A + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // Colour: dark snowy forest on the lower slopes; above the tree line,
  // snow where it can lie and rock in gullies and on steep faces.
  const nor = geo.attributes.normal!;
  const colors = new Float32Array(nor.count * 3);
  const snow = new THREE.Color(0.92, 0.96, 1.05);
  const rock = new THREE.Color(0.07, 0.08, 0.1);
  const woods = new THREE.Color(0.05, 0.07, 0.075);
  const c = new THREE.Color();
  for (let i = 0; i < nor.count; i++) {
    const x = pos[i * 3]!;
    const y = pos[i * 3 + 1]!;
    const z = pos[i * 3 + 2]!;
    // Streaks stretched down the slope read as gullies.
    const streak = fbm(x * 0.03 + z * 0.01, y * 0.09, 4);
    const s = THREE.MathUtils.smoothstep(nor.getY(i) + (streak - 0.5) * 0.7, 0.5, 0.7);
    c.copy(rock).lerp(snow, s);
    const treeLine = -15 + fbm(x * 0.01, z * 0.01, 3) * 60;
    const forest = 1 - THREE.MathUtils.smoothstep(y, treeLine - 10, treeLine + 10);
    const speckle = 0.2 + 0.3 * noise(x * 0.5, z * 0.5);
    c.lerp(woods.clone().lerp(snow, speckle), forest * THREE.MathUtils.smoothstep(nor.getY(i), 0.3, 0.6));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  mats.push(mat);
  return new THREE.Mesh(geo, mat);
}

/** A small black lantern with a candle, standing in the snow. */
function createDeckLantern(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.6, roughness: 0.4 });
  const w = 0.16;
  const h = 0.26;
  for (const [px, pz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as [number, number][]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.01, h, 0.01), metal);
    post.position.set((px * w) / 2, h / 2, (pz * w) / 2);
    g.add(post);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.8, 0.07, 4), metal);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = h + 0.035;
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.9, h * 0.9, w * 0.9),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.95, 0.45) }),
  );
  glow.position.y = h / 2;
  const light = new THREE.PointLight(0xffa860, 1.2, 0, 2);
  light.position.y = h * 0.5;
  g.add(roof, glow, light);
  return g;
}

/**
 * A snow-laden fir as geometry: tiers of drooping, ragged skirts. Each tier
 * has a snowy top surface and a dark underside, with green showing through
 * the snow at the branch tips.
 */
function firGeometry(tiers: number, segs: number, seed: number, girth = 0.19): THREE.BufferGeometry {
  const rand = rng(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const snow = [0.9, 0.93, 1.0];
  const green = [0.06, 0.1, 0.09];
  const dark = [0.05, 0.075, 0.075];
  const shade = [0.45, 0.52, 0.66];
  const uvs: number[] = [];
  const vert = (x: number, y: number, z: number, c: number[]) => {
    pos.push(x, y, z);
    col.push(c[0]!, c[1]!, c[2]!);
    // Wrapped around the trunk, for the snow's surface detail.
    uvs.push((Math.atan2(z, x) / (Math.PI * 2)) * 3, y * 14 + Math.hypot(x, z) * 10);
    return pos.length / 3 - 1;
  };
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);

  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = 0.08 + 0.84 * t + (rand() - 0.5) * (0.4 / tiers);
    // Spruces are narrow: about a sixth as wide as they are tall.
    const R = (girth * Math.pow(1 - t, 0.85) + 0.012) * (0.85 + rand() * 0.3);
    // Each tier hangs at least past the one below, so no gaps show near the top.
    const droop = Math.max(R * (0.7 + rand() * 0.3), (1.2 * 0.84) / tiers);
    const ring = (r: number, dy: number, jag: boolean, c: () => number[]) => {
      const ids: number[] = [];
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2 + k * 0.7;
        // Ragged branch tips: random reach, and some hang lower than others.
        const j = jag ? 0.8 + rand() * 0.3 : 1;
        const sag = jag ? (rand() - 0.3) * 0.5 * Math.abs(dy) : 0;
        ids.push(vert(Math.cos(a) * r * j, y + dy * (jag ? j : 1) - sag, Math.sin(a) * r * j, c()));
      }
      return ids;
    };
    // Top surface: trunk, a snow-covered mid ring, ragged tips.
    // Snow near the trunk sits in the shade of the tier above: bluer and darker.
    const top0 = ring(0.012, 0.06 * R, false, () => mix(snow, shade, 0.7));
    const top1 = ring(R * 0.55, -droop * 0.35, false, () =>
      rand() < 0.3 ? mix(snow, green, 0.5 + rand() * 0.4) : mix(snow, shade, rand() * 0.45),
    );
    const top2 = ring(R, -droop, true, () => mix(snow, green, 0.45 + rand() * 0.55));
    // Underside, slightly lower: dark needles.
    const bot1 = ring(R * 0.5, -droop * 0.6, false, () => dark);
    const bot0 = ring(0.012, -droop * 0.3, false, () => dark);
    // Ring angles run clockwise seen from above, so this winding faces the
    // top surface up and the underside down.
    const strip = (a: number[], b: number[]) => {
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(a[s]!, a[s1]!, b[s]!, a[s1]!, b[s1]!, b[s]!);
      }
    };
    strip(top0, top1);
    strip(top1, top2);
    strip(top2, bot1);
    strip(bot1, bot0);
  }
  // Leader at the top.
  const tip = vert(0, 0.97, 0, snow);
  const base: number[] = [];
  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * Math.PI * 2;
    base.push(vert(Math.cos(a) * 0.015, 0.9, Math.sin(a) * 0.015, mix(snow, green, 0.5)));
  }
  for (let s = 0; s < 5; s++) idx.push(tip, base[(s + 1) % 5]!, base[s]!);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Trunk, running up inside the whole tree as a dark core.
  const trunk = new THREE.CylinderGeometry(0.002, 0.016, 0.86, 6).toNonIndexed();
  trunk.translate(0, 0.43, 0);
  const tc = new Float32Array(trunk.attributes.position!.count * 3).fill(0.03);
  trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  return mergeGeometries([geo.toNonIndexed(), trunk])!;
}

/** Firs over the valley slope: big ones near the cabin, a dense stand further down. */
function createForest(mats: THREE.MeshStandardMaterial[]): THREE.Group {
  const forest = new THREE.Group();
  const rand = rng(202);
  const mat = pbr('snow_02', { size: 1, color: 0xffffff, normalScale: 1.2, physical: { vertexColors: true, side: THREE.DoubleSide } });
  mats.push(mat);
  // Detail drops with distance: ~4k triangles a tree close up, a few hundred far away.
  const near = [firGeometry(30, 28, 1), firGeometry(28, 26, 2)];
  // Distant trees read as fuller cones; thin ones look like spires from afar.
  const mid = firGeometry(10, 6, 3, 0.23);
  const far = firGeometry(7, 5, 4, 0.26);

  const spots: [number, number, number][] = [];
  const tryPlace = (x: number, z: number, h: number, minGap: number) => {
    if (spots.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < minGap * minGap)) return;
    spots.push([x, z, h]);
  };
  // Near stand: tall trees just past the deck and right of the cabin.
  // A dense stand just below the deck; the slope drops away fast enough
  // that their tops sit below the mountains.
  for (let n = 0; n < 3000 && spots.length < 130; n++) {
    const x = -24 + rand() * 48;
    const z = DECK_Z - 10 - rand() * 28;
    // A snowy clearing straight ahead, so the stove stands against open sky.
    if (Math.abs(x - RIDGE_X) < 4.5 && z > DECK_Z - 14) continue;
    tryPlace(x, z, 9 + rand() * 7, 2.2);
  }
  // Tall trees off to the right, seen through the side window.
  for (let n = 0; n < 400 && spots.length < 160; n++) {
    const x = ROOM.maxX + 15 + rand() * 18;
    const z = ROOM.minZ + 6 - rand() * 16;
    tryPlace(x, z, 12 + rand() * 8, 2.4);
  }
  const nearCount = spots.length;
  // The valley: many smaller-looking trees, thinning with distance.
  for (let n = 0; n < 60000 && spots.length < 4200; n++) {
    const a = -1.25 + rand() * 2.5;
    const r = 22 + Math.pow(rand(), 1.1) * (FOREST_R - 22);
    const x = Math.sin(a) * r;
    const z = DECK_Z - Math.cos(a) * r;
    tryPlace(x, z, 10 + rand() * 7, 1.8 + r * 0.008);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();
  const build = (geo: THREE.BufferGeometry, list: [number, number, number][]) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, z, h], i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI * 2);
      const w = h * (0.85 + rand() * 0.3);
      m.compose(p.set(x, groundHeight(x, z) - 0.3, z), q, s.set(w, h, w));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tint.setScalar(0.85 + rand() * 0.25));
    });
    mesh.frustumCulled = false;
    return mesh;
  };
  const nearList = spots.slice(0, nearCount);
  forest.add(build(near[0]!, nearList.filter((_, i) => i % 2 === 0)));
  forest.add(build(near[1]!, nearList.filter((_, i) => i % 2 === 1)));
  const valley = spots.slice(nearCount);
  const dist = ([x, z]: [number, number, number]) => Math.hypot(x, z - DECK_Z);
  forest.add(build(mid, valley.filter((t) => dist(t) < 45)));
  forest.add(build(far, valley.filter((t) => dist(t) >= 45)));
  return forest;
}
