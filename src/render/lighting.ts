import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { BACK_WINDOW, DOWNLIGHTS, GABLE_WINDOW, ROOM, SIDE_WINDOW, downlightY, roofY } from './cabin';
import { TABLE_TOP } from './table';

/** Luminance (nits) of the blue-hour sky as seen through the glass. */
const WINDOW_NITS = 2.4;
const SKY_LIGHT = 0x9db2d6;
/** Candela of each recessed light; dimmed for the evening. */
const DOWNLIGHT_CD = 14;
/** Candela of the lamp over the table that gives the stones their shadows. */
const TABLE_SPOT_CD = 16;

/**
 * Lighting apart from the fire, lamps and candles: the cool sky coming in
 * through the back and side glass, warm recessed lights, and one narrow
 * spot from the roof onto the table that casts the stones' shadows.
 */
export function createLighting(): THREE.Group {
  RectAreaLightUniformsLib.init();
  const group = new THREE.Group();
  group.name = 'lighting';

  const area = (w: number, h: number, nits: number, pos: THREE.Vector3, look: THREE.Vector3) => {
    const l = new THREE.RectAreaLight(SKY_LIGHT, nits, w, h);
    l.position.copy(pos);
    l.lookAt(look);
    group.add(l);
  };
  const bw = BACK_WINDOW;
  const back = new THREE.Vector3((bw.x0 + bw.x1) / 2, (bw.y0 + bw.y1) / 2, ROOM.minZ - 0.02);
  area(bw.x1 - bw.x0, bw.y1 - bw.y0, WINDOW_NITS, back, back.clone().setZ(0));
  const gw = GABLE_WINDOW;
  const gTop = roofY((gw.x0 + gw.x1) / 2) - 0.6;
  const gable = new THREE.Vector3((gw.x0 + gw.x1) / 2, (gw.y0 + gTop) / 2, ROOM.minZ - 0.02);
  area(gw.x1 - gw.x0, gTop - gw.y0, WINDOW_NITS, gable, gable.clone().add(new THREE.Vector3(0, -2, 5)));
  const sw = SIDE_WINDOW;
  const side = new THREE.Vector3(ROOM.maxX + 0.02, (sw.y0 + sw.y1) / 2, (sw.z0 + sw.z1) / 2);
  area(sw.z1 - sw.z0, sw.y1 - sw.y0, WINDOW_NITS * 0.8, side, side.clone().setX(0));

  DOWNLIGHTS.forEach(([x, z], i) => {
    const y = downlightY(x, z);
    const spot = new THREE.SpotLight(0xffd2a0, DOWNLIGHT_CD, 0, 0.6, 0.85, 2);
    // Every other recessed light is switched off in low quality (see BoardScene.setQuality).
    spot.userData.lowQualityOff = i % 2 === 1;
    spot.position.set(x, y - 0.03, z);
    spot.target.position.set(x, 0, z);
    group.add(spot, spot.target);
  });

  // A tight spot from the roof onto the board: the stones' shadows and a pool of warm light on the table.
  const key = new THREE.SpotLight(0xffd6a8, TABLE_SPOT_CD, 0, 0.42, 0.85, 2);
  key.position.set(0.35, roofY(0.35) - 0.1, 0.6);
  key.target.position.set(0, TABLE_TOP, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.004;
  key.shadow.radius = 3;
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 7;
  group.add(key, key.target);
  return group;
}
