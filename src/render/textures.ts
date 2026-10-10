import * as THREE from 'three';

/** Small procedural canvas textures (logs, sparks); the large surfaces use the scanned sets in public/assets. */

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Small seeded PRNG (mulberry32) so textures look the same on every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

/** Per-pixel brightness noise. */
function addNoise(ctx: Ctx, w: number, h: number, amount: number, rand: () => number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Wavy grain lines running along x inside a rectangle. */
function drawGrain(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  hue: number,
  light: number,
  rand: () => number,
): void {
  const lines = Math.max(4, Math.round(h / 3));
  for (let i = 0; i < lines; i++) {
    const y0 = y + rand() * h;
    const amp = 1 + rand() * 4;
    const freq = 0.004 + rand() * 0.012;
    const phase = rand() * 10;
    ctx.strokeStyle = hsl(hue, 45, light - 8 - rand() * 12, 0.15 + rand() * 0.35);
    ctx.lineWidth = 0.5 + rand() * 1.8;
    ctx.beginPath();
    for (let px = x; px <= x + w; px += 6) {
      const py = y0 + Math.sin(px * freq + phase) * amp + Math.sin(px * freq * 3.1) * amp * 0.3;
      if (px === x) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

/** Plain wood, grain along u. */
export function woodTexture(hue = 28, light = 34, seed = 1): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const [c, ctx] = makeCanvas(w, h);
  const rand = rng(seed);
  ctx.fillStyle = hsl(hue, 45, light);
  ctx.fillRect(0, 0, w, h);
  // Broad bands of lighter and darker wood.
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = hsl(hue, 40, light + (rand() - 0.5) * 10, 0.35);
    ctx.fillRect(0, rand() * h, w, 10 + rand() * 50);
  }
  drawGrain(ctx, 0, 0, w, h, hue, light, rand);
  // A couple of knots.
  for (let i = 0; i < 2; i++) {
    const kx = rand() * w;
    const ky = rand() * h;
    for (let r = 14; r > 2; r -= 3) {
      ctx.strokeStyle = hsl(hue, 50, light - 14, 0.4);
      ctx.beginPath();
      ctx.ellipse(kx, ky, r * 2.2, r * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  addNoise(ctx, w, h, 14, rand);
  return toTexture(c);
}

/** Sawn log end: growth rings, a darker heart and a bark rim. */
export function endGrainTexture(seed = 37): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = makeCanvas(size, size);
  const rand = rng(seed);
  const mid = size / 2;
  ctx.fillStyle = hsl(28, 30, 22);
  ctx.fillRect(0, 0, size, size);
  for (let r = mid - 8; r > 0; r -= 3 + rand() * 4) {
    ctx.fillStyle = hsl(30 + rand() * 6, 40, 52 - (r / mid) * 14 + rand() * 6);
    ctx.beginPath();
    ctx.ellipse(mid + rand() * 3, mid + rand() * 3, r, r * (0.94 + rand() * 0.06), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // A drying crack.
  ctx.strokeStyle = 'rgba(30,15,5,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mid, mid);
  ctx.lineTo(mid + (rand() - 0.5) * mid, mid - mid * 0.8);
  ctx.stroke();
  addNoise(ctx, size, size, 20, rand);
  return toTexture(c);
}

/** Soft round dot for snowflakes and sparks. */
export function dotTexture(): THREE.CanvasTexture {
  const size = 64;
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c);
}
