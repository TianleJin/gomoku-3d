import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * Loading for the CC0 assets in public/assets (textures, models and the sky
 * from Poly Haven). Everything shares one LoadingManager so the scene can
 * wait for the lot before it bakes its environment lighting.
 */

const BASE = `${import.meta.env.BASE_URL}assets/`;

export const manager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(manager);
const gltfLoader = new GLTFLoader(manager);
const hdrLoader = new HDRLoader(manager);

/** Resolves once every asset requested so far (and any requested meanwhile) has loaded. */
export function allLoaded(): Promise<void> {
  return new Promise((resolve) => {
    const prev = manager.onLoad;
    manager.onLoad = () => {
      prev?.();
      resolve();
    };
  });
}

const textureCache = new Map<string, THREE.Texture>();

/** A texture from public/assets, loaded once and shared. */
export function texture(path: string, srgb = false): THREE.Texture {
  let tex = textureCache.get(path);
  if (!tex) {
    tex = textureLoader.load(BASE + path);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(path, tex);
  }
  return tex;
}

export interface PbrOptions {
  /** Size in metres that one texture repeat covers on the surface. */
  size?: number;
  /** Extra repeat multipliers, for when UVs aren't in metres. */
  repeat?: [number, number];
  rotation?: number;
  color?: THREE.ColorRepresentation;
  roughness?: number;
  normalScale?: number;
  aoIntensity?: number;
  /** Skip the colour map and use `color` alone (for re-colouring a fabric's weave). */
  noMap?: boolean;
  physical?: THREE.MeshPhysicalMaterialParameters;
}

/**
 * A PBR material from a Poly Haven texture set: `<name>_diff.jpg`,
 * `<name>_nor.jpg` (OpenGL normals) and `<name>_arm.jpg` (AO, roughness,
 * metalness packed in R, G, B). UVs are assumed to be in metres.
 */
export function pbr(name: string, opts: PbrOptions = {}): THREE.MeshPhysicalMaterial {
  const size = opts.size ?? 1;
  const [ru, rv] = opts.repeat ?? [1, 1];
  const set = (t: THREE.Texture) => {
    const c = t.clone();
    c.repeat.set(ru / size, rv / size);
    c.rotation = opts.rotation ?? 0;
    c.center.set(0.5, 0.5);
    return c;
  };
  const arm = set(texture(`textures/${name}_arm.jpg`));
  const mat = new THREE.MeshPhysicalMaterial({
    map: opts.noMap ? null : set(texture(`textures/${name}_diff.jpg`, true)),
    normalMap: set(texture(`textures/${name}_nor.jpg`)),
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
    roughnessMap: arm,
    aoMap: arm,
    aoMapIntensity: opts.aoIntensity ?? 1,
    roughness: opts.roughness ?? 1,
    color: opts.color ?? 0xffffff,
    ...opts.physical,
  });
  return mat;
}

/**
 * Rewrites a BoxGeometry's UVs so that one UV unit is one metre on every
 * face, so a texture keeps its real-world scale whatever the box's size.
 */
export function metricBoxUVs(geo: THREE.BufferGeometry, w: number, h: number, d: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv!;
  // BoxGeometry faces in order: +x, -x, +y, -y, +z, -z; each spans (u, v) dims.
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  const perFace = uv.count / 6;
  for (let i = 0; i < uv.count; i++) {
    const [du, dv] = dims[Math.floor(i / perFace)]!;
    uv.setXY(i, uv.getX(i) * du, uv.getY(i) * dv);
  }
  return geo;
}

/**
 * Box-projects UVs in metres from vertex positions and normals, for
 * rounded or lathed shapes whose own UVs don't keep a texture's scale.
 */
export function projectUVs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position!;
  const nor = geo.attributes.normal!;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) [u, v] = [pos.getX(i), pos.getZ(i)];
    else if (ax >= az) [u, v] = [pos.getZ(i), pos.getY(i)];
    else [u, v] = [pos.getX(i), pos.getY(i)];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** A box whose UVs are in metres. */
export function metricBox(w: number, h: number, d: number): THREE.BufferGeometry {
  return metricBoxUVs(new THREE.BoxGeometry(w, h, d), w, h, d);
}

/** A glTF model from public/assets/models/<name>/<name>.gltf. */
export function model(name: string): Promise<THREE.Group> {
  return gltfLoader.loadAsync(`${BASE}models/${name}/${name}.gltf`).then((g) => g.scene);
}

/** The sky: an HDR for lighting and reflections outdoors, and a sharp 4k backdrop. */
export function skyHdr(): Promise<THREE.DataTexture> {
  return hdrLoader.loadAsync(`${BASE}hdri/sky_1k.hdr`).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  });
}

export function skyBackdrop(): THREE.Texture {
  const t = texture('hdri/sky_4k.jpg', true);
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
