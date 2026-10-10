import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Player } from '../core/board';
import { allLoaded, skyHdr } from './assets';
import { LOFT, ROOM, roofY, createCabin, type Cabin } from './cabin';
import { FIRE_SHELVES, createFireplace, type Fireplace } from './fireplace';
import { BOARD_D, BOARD_W, Stones, createBoard, createBowl } from './goban';
import { GridInput } from './input';
import { createLighting } from './lighting';
import { HAZE, createOutdoors, type Outdoors } from './outdoors';
import {
  bookRow,
  createBasket,
  createDiningChair,
  createFloorLamp,
  createLoungeChair,
  createPendant,
  createSofa,
  createWallShelves,
  pillarCandle,
} from './props';
import { TABLE_TOP, createSideTable, createTable } from './table';

export type Quality = 'high' | 'low';
export type QualityMode = Quality | 'auto';
const WARMUP_S = 4;
const QUALITY_KEY = 'gomoku.quality';

/** Quality from `?quality=low|high` in the URL, else the saved choice, else null (automatic). */
function savedQuality(): Quality | null {
  const parse = (v: string | null): Quality | null => (v === 'low' || v === 'high' ? v : null);
  const fromUrl = parse(new URLSearchParams(location.search).get('quality'));
  if (fromUrl) return fromUrl;
  try {
    return parse(localStorage.getItem(QUALITY_KEY));
  } catch {
    return null;
  }
}

const FOV = 52;
/**
 * Playing viewpoint: the reference photo's direction (from the near side of
 * the table, looking at the loft and the windows), but seated close enough
 * that 19 lines are easy to hit. Relative to the board's centre.
 */
const VIEW_OFFSET = new THREE.Vector3(0, 0.54, 0.76);
/**
 * The establishing shot behind the menu, framed like the reference photo:
 * standing back from the near end of the table at eye height, looking level
 * at the loft and the windows.
 */
const OVERVIEW = { pos: new THREE.Vector3(0.1, 1.68, 2.45), target: new THREE.Vector3(0.1, 1.5, -5.4), fov: 56 };
/** Seconds the camera takes to move between the overview and the board. */
const VIEW_MOVE_S = 1.8;
/** Where the interior environment (reflections and bounce light) is captured from. */
const CAPTURE_POS = new THREE.Vector3(0.2, 1.7, -1.6);

/**
 * The 3D view: the cabin, the table, the goban and its stones. Knows the
 * board's intersections but nothing about rules or the bot; main.ts drives it.
 */
export class BoardScene {
  /** Called when the player picks an intersection while input is enabled. */
  onCellSelect: (cell: number) => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.03, 2500);
  private controls: OrbitControls;
  private stones = new Stones();
  private cabin: Cabin;
  private fireplace: Fireplace;
  private outdoors: Outdoors;
  private updaters: ((time: number) => void)[] = [];
  private input: GridInput;
  private target = new THREE.Vector3(0, TABLE_TOP, 0.02);
  private inputPlayer: Player | null = null;
  private canPlay: (cell: number) => boolean = () => false;
  private lastTime = performance.now();
  private time = 0;
  /** 0 = overview, 1 = playing view; animated towards `viewGoal`. */
  private viewT = 0;
  private viewGoal = 0;
  private playPos = new THREE.Vector3();
  private playShift = 0.3;
  private lookAt = new THREE.Vector3();

  private quality: Quality = 'high';
  /** True once the player (URL or saved choice) picked a quality, which turns off the automatic downgrade. */
  private qualityPinned = false;
  /** Scene time before which frame times are ignored. */
  private watchFrom = WARMUP_S;
  private slowMs = 0;
  private slowFrames = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    container.appendChild(this.renderer.domElement);

    this.scene.background = HAZE.clone();
    // Aerial perspective: only the far valley and the mountains pick up haze.
    this.scene.fog = new THREE.Fog(HAZE, 40, 1900);
    this.outdoors = createOutdoors();
    this.cabin = createCabin();
    this.fireplace = createFireplace();
    this.scene.add(this.outdoors.group, this.cabin.group, this.fireplace.group, createLighting());
    this.addFurniture();

    // The goban on the table, its surface a pick target, with the stones on top.
    const board = createBoard();
    board.position.set(this.target.x, TABLE_TOP + 0.034, this.target.z);
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_D).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    board.add(surface, this.stones.group);
    this.scene.add(board);
    this.target.y = board.position.y;
    const black = createBowl(1, 1);
    black.position.set(0.4, TABLE_TOP, 0.2);
    black.rotation.y = 0.4;
    const white = createBowl(2, 2);
    white.position.set(-0.45, TABLE_TOP, -0.22);
    white.rotation.y = Math.PI + 0.3;
    this.scene.add(black, white);

    // Post-processing renders into a multisampled HDR target, so bloom picks out the fire and the lamps.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.5, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.target);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.5;
    this.controls.minPolarAngle = Math.PI * 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.minAzimuthAngle = -Math.PI * 0.3;
    this.controls.maxAzimuthAngle = Math.PI * 0.3;
    this.controls.enabled = false;
    this.playPos.copy(this.target).add(VIEW_OFFSET);

    this.input = new GridInput(this.renderer.domElement, this.camera, surface, {
      onHover: () => this.updateGhost(),
      onSelect: (cell) => {
        if (this.inputPlayer !== null && this.canPlay(cell)) this.onCellSelect(cell);
      },
    });

    const saved = savedQuality();
    this.qualityPinned = saved !== null;
    this.setQuality(saved ?? 'high');
    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.setAnimationLoop(() => this.frame());
    void this.bakeEnvironment();
    // Handle for inspecting the scene from the browser console during development.
    if (import.meta.env.DEV) {
      Object.assign(window, {
        __view: { scene: this.scene, camera: this.camera, controls: this.controls, renderer: this.renderer, frame: () => this.frame(), resize: () => this.resize() },
      });
    }
  }

  /** What the player chose: a fixed quality, or 'auto' (full quality, dropping to low if frames are slow). */
  getQualityMode(): QualityMode {
    return this.qualityPinned ? this.quality : 'auto';
  }

  setQualityMode(mode: QualityMode): void {
    if (mode === 'auto') {
      this.qualityPinned = false;
      this.slowMs = 0;
      this.slowFrames = 0;
      this.watchFrom = this.time + WARMUP_S;
      try {
        localStorage.removeItem(QUALITY_KEY);
      } catch {
        // Nothing saved to clear.
      }
      this.setQuality('high');
    } else {
      this.setQuality(mode, true);
    }
  }

  /**
   * Switches between full and reduced rendering. Low quality renders at pixel
   * ratio 1 without MSAA, bloom or half the recessed lights, and with a
   * smaller shadow map. `remember` stores the choice and stops the automatic
   * downgrade from overriding it.
   */
  setQuality(q: Quality, remember = false): void {
    this.quality = q;
    const low = q === 'low';
    if (remember) {
      this.qualityPinned = true;
      try {
        localStorage.setItem(QUALITY_KEY, q);
      } catch {
        // Storage can be unavailable (private mode); the choice then lasts for this visit only.
      }
    }
    const ratio = low ? 1 : Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      rt.samples = low ? 0 : 4;
      rt.dispose();
    }
    this.bloom.enabled = !low;
    this.scene.traverse((o) => {
      if (o instanceof THREE.SpotLight) {
        if (o.userData.lowQualityOff) o.visible = !low;
        if (o.castShadow) {
          const size = low ? 1024 : 2048;
          o.shadow.mapSize.set(size, size);
          o.shadow.map?.dispose();
          o.shadow.map = null;
        }
      }
    });
    this.resize();
  }

  /**
   * Watches frame times and drops to low quality once, if the first stretch
   * of rendering averages under ~30 fps. Skipped when the player chose.
   */
  private watchPerformance(rawMs: number): void {
    if (this.qualityPinned || this.quality === 'low' || document.hidden) return;
    // Ignore the first seconds: shader compilation and the environment bake are slow on any machine.
    if (this.time < this.watchFrom) return;
    this.slowMs += rawMs;
    if (++this.slowFrames < 90) return;
    const avg = this.slowMs / this.slowFrames;
    this.slowMs = 0;
    this.slowFrames = 0;
    if (avg > 34) this.setQuality('low');
  }

  /** Moves the camera back to the establishing shot (true) or down to the board (false). */
  setOverview(on: boolean): void {
    const goal = on ? 0 : 1;
    if (goal === this.viewGoal) return;
    // Leaving the board: remember where the player had orbited to.
    if (on && this.viewT === 1) this.playPos.copy(this.camera.position);
    this.viewGoal = goal;
    this.controls.enabled = false;
  }

  /** Lets `player` pick an intersection (ghost stone and clicks), or turns input off with null. */
  setInput(player: Player | null, canPlay: (cell: number) => boolean = () => false): void {
    this.inputPlayer = player;
    this.canPlay = canPlay;
    this.updateGhost();
  }

  /** Places a stone and moves the last-move marker onto it. */
  async placeStone(cell: number, player: Player): Promise<void> {
    await this.stones.place(cell, player);
    this.stones.markLast(cell, player);
  }

  /** Takes the most recent stone of `player` off the board. */
  removeStone(player: Player): void {
    this.stones.removeLast(player);
  }

  markLast(cell: number | null, player: Player): void {
    this.stones.markLast(cell, player);
  }

  highlightWin(cells: readonly number[]): void {
    this.stones.highlight(cells);
  }

  clearBoard(): void {
    this.stones.clear();
  }

  private addFurniture(): void {
    const table = createTable();
    this.scene.add(table.group);
    this.updaters.push(table.update);

    // Two upholstered chairs on the far side of the table, facing the player.
    for (const x of [-0.82, 0.82]) {
      const chair = createDiningChair();
      chair.position.set(x, 0, -0.92);
      chair.rotation.y = x * -0.05;
      this.scene.add(chair);
    }

    // Sofa along the glazed right wall, facing into the room, and a smaller one under the loft.
    const sofa = createSofa(2.5);
    sofa.rotation.y = -Math.PI / 2;
    sofa.position.set(ROOM.maxX - 0.62, 0, -2.6);
    const loveseat = createSofa(1.7, false);
    loveseat.position.set(1.25, 0, ROOM.minZ + 0.75);
    loveseat.rotation.y = -0.15;
    this.scene.add(sofa, loveseat);

    // Reading corner: the lounge chair and a floor lamp in front of the back-left window.
    const chair = createLoungeChair();
    chair.position.set(-1.25, 0, ROOM.minZ + 1.15);
    chair.rotation.y = 0.45;
    const lamp = createFloorLamp(1.42, 2.4);
    lamp.group.position.set(-1.95, 0, ROOM.minZ + 0.55);
    this.scene.add(chair, lamp.group);

    // A pendant by the right-hand glass, and a side table with a candle in the right foreground.
    const pendant = createPendant(1.6, 1.6);
    pendant.position.set(ROOM.maxX - 0.7, roofY(ROOM.maxX - 0.7), ROOM.minZ + 0.7);
    const side = createSideTable();
    side.group.position.set(ROOM.maxX - 0.55, 0, 0.45);
    this.updaters.push(side.update);
    this.scene.add(pendant, side.group);

    // Left wall: shelves of books between the fireplace and the back corner, and a log basket below.
    const shelves = createWallShelves(1.7, [1.05, 1.45, 1.85]);
    shelves.rotation.y = Math.PI / 2;
    shelves.position.set(ROOM.minX, 0, -3.05);
    const basket = createBasket();
    basket.position.set(ROOM.minX + 0.35, 0, -3.5);
    this.scene.add(shelves, basket);

    // Books and candles in the niche above the log store.
    const fs = FIRE_SHELVES;
    const niche = new THREE.Group();
    niche.rotation.y = Math.PI / 2;
    niche.position.set(fs.x, 0, fs.z + fs.width / 2);
    bookRow(niche, 0.02, fs.ys[0]!, 0, fs.width * 0.6, 21, 0.3);
    bookRow(niche, 0.02, fs.ys[2]!, 0, fs.width * 0.8, 23, 0.3);
    for (const [k, y, h] of [
      [0.47, fs.ys[0]!, 0.14],
      [0.2, fs.ys[1]!, 0.1],
      [0.32, fs.ys[1]!, 0.16],
    ] as [number, number, number][]) {
      const c = pillarCandle(h, 0.032, h > 0.12);
      c.group.position.set(k, y, 0);
      niche.add(c.group);
      this.updaters.push(c.update);
    }
    this.scene.add(niche);
    // A candle on the loft's railing post side, catching the eye up high.
    const loftCandle = pillarCandle(0.12, 0.035, false);
    loftCandle.group.position.set(LOFT.x0 + 0.6, LOFT.y + LOFT.slab + 0.9, ROOM.minZ + 0.22);
    this.updaters.push(loftCandle.update);
    this.scene.add(loftCandle.group);
  }

  /**
   * Once everything has loaded: lights the outdoors with the sky HDR, then
   * captures the room into a cube map and uses it, filtered, as the
   * interior's environment, which stands in for bounce light and gives the
   * glossy things something real to reflect. Captured twice, so the second
   * capture includes the first bounce.
   */
  private async bakeEnvironment(): Promise<void> {
    const [sky] = await Promise.all([skyHdr(), allLoaded()]);
    this.outdoors.setSkyLight(sky);
    const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(0.05, 2500, cubeRT);
    cubeCam.position.copy(CAPTURE_POS);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    let env: THREE.WebGLRenderTarget | null = null;
    for (let pass = 0; pass < 2; pass++) {
      this.stones.group.visible = false;
      cubeCam.update(this.renderer, this.scene);
      this.stones.group.visible = true;
      const next = pmrem.fromCubemap(cubeRT.texture);
      env?.dispose();
      env = next;
      this.scene.environment = env.texture;
    }
    pmrem.dispose();
    const glass = this.cabin.glass.uniforms;
    glass.uEnv!.value = cubeRT.texture;
    glass.uStrength!.value = 1;
    glass.uCapturePos!.value.copy(CAPTURE_POS);
  }

  private updateGhost(): void {
    const cell = this.input.current;
    const show = this.inputPlayer !== null && cell !== null && this.canPlay(cell);
    this.stones.showGhost(show ? cell : null, this.inputPlayer ?? 1);
  }

  /** Frames the board for the current aspect ratio, keeping the user's viewing angle. */
  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    // Shift the lens so the board sits low in the frame and the windows and
    // fireplace fill the rest, keeping verticals nearly upright.
    this.playShift = h > w ? Math.min(0.3, 0.2 + (h / w - 1) * 0.1) : 0.2;

    // On narrow screens, back off until the board fits the width.
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const fitW = (BOARD_W * 1.3) / 2 / (tan * this.camera.aspect);
    const dist = Math.max(VIEW_OFFSET.length(), fitW);
    const from = this.viewT === 1 ? this.camera.position : this.playPos;
    const dir = from.clone().sub(this.target).normalize();
    this.playPos.copy(this.target).addScaledVector(dir, dist);
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = Math.max(dist * 3, 2.8);
    this.applyView();
  }

  /** Places the camera between the overview and the playing view, by `viewT`. */
  private applyView(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    if (this.viewT === 1) {
      this.camera.fov = FOV;
      this.camera.setViewOffset(w, h, 0, -h * this.playShift, w, h);
      this.camera.updateProjectionMatrix();
      if (!this.controls.enabled) {
        this.camera.position.copy(this.playPos);
        this.controls.target.copy(this.target);
        this.controls.enabled = true;
      }
      this.controls.update();
      return;
    }
    // Smoothstep, so the move eases in and out.
    const t = this.viewT * this.viewT * (3 - 2 * this.viewT);
    this.camera.position.lerpVectors(OVERVIEW.pos, this.playPos, t);
    this.lookAt.lerpVectors(OVERVIEW.target, this.target, t);
    this.camera.lookAt(this.lookAt);
    this.camera.fov = THREE.MathUtils.lerp(OVERVIEW.fov, FOV, t);
    this.camera.setViewOffset(w, h, 0, -h * this.playShift * t, w, h);
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const now = performance.now();
    // Clamp so a background tab doesn't make stones jump when it comes back.
    const rawMs = now - this.lastTime;
    const dt = Math.min(0.05, rawMs / 1000);
    this.lastTime = now;
    this.time += dt;
    this.watchPerformance(rawMs);

    if (this.viewT !== this.viewGoal) {
      const step = dt / VIEW_MOVE_S;
      this.viewT = this.viewGoal > this.viewT ? Math.min(1, this.viewT + step) : Math.max(0, this.viewT - step);
    }
    this.applyView();
    this.stones.update(dt);
    this.fireplace.update(this.time, dt, this.camera);
    this.outdoors.update(this.time, dt);
    for (const u of this.updaters) u(this.time);
    this.composer.render(dt);
  }
}
