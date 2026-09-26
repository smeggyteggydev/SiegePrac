import * as THREE from 'three';
import { Block } from '../game/World';
import { hash2 } from '../utils/noise';

/**
 * Procedurally painted block textures packed into a texture array.
 * Each layer covers `scale` metres so large surfaces don't show a 1m grid —
 * the key to looking "voxel-inspired" instead of vanilla-blocky.
 */

const SIZE = 128;

export interface LayerInfo {
  /** metres covered by one repeat, horizontally / vertically */
  su: number;
  sv: number;
  /** emissive strength */
  emit: number;
  /** extra metalness (0..1) */
  metal: number;
}

type Painter = (ctx: CanvasRenderingContext2D, rnd: (x: number, y: number) => number) => void;

const LAYERS: { name: string; info: LayerInfo; paint: Painter }[] = [];
const layerIndex = new Map<string, number>();

function layer(name: string, info: Partial<LayerInfo>, paint: Painter) {
  layerIndex.set(name, LAYERS.length);
  LAYERS.push({ name, info: { su: 2, sv: 2, emit: 0, metal: 0, ...info }, paint });
}

// ── painting helpers ─────────────────────────────────────────────────────────
function fillNoise(ctx: CanvasRenderingContext2D, base: [number, number, number], amp: number, cell: number, seed: number) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      // two octaves of blocky-soft noise, tileable via modulo hashing
      const n1 = hash2(Math.floor(x / cell) % (SIZE / cell), Math.floor(y / cell) % (SIZE / cell), seed);
      const n2 = hash2(Math.floor(x / (cell * 4)) % (SIZE / (cell * 4)), Math.floor(y / (cell * 4)) % (SIZE / (cell * 4)), seed + 5);
      const n = (n1 - 0.5) * amp + (n2 - 0.5) * amp * 0.8;
      const i = (y * SIZE + x) * 4;
      img.data[i] = clamp255(base[0] * (1 + n));
      img.data[i + 1] = clamp255(base[1] * (1 + n));
      img.data[i + 2] = clamp255(base[2] * (1 + n));
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Soft bevel: light top-left edge, dark bottom-right edge on a rect. */
function bevel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s = 3, light = 0.18, dark = 0.28) {
  ctx.fillStyle = `rgba(255,255,255,${light})`;
  ctx.fillRect(x, y, w, s);
  ctx.fillRect(x, y, s, h);
  ctx.fillStyle = `rgba(0,0,0,${dark})`;
  ctx.fillRect(x, y + h - s, w, s);
  ctx.fillRect(x + w - s, y, s, h);
}

function speckle(ctx: CanvasRenderingContext2D, count: number, color: string, size: number, seed: number) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(hash2(i, 1, seed) * SIZE);
    const y = Math.floor(hash2(i, 2, seed) * SIZE);
    const s = 1 + Math.floor(hash2(i, 3, seed) * size);
    ctx.fillRect(x, y, s, s);
  }
}

function bricks(ctx: CanvasRenderingContext2D, rows: number, cols: number, mortar: string, lightness: number, seed: number) {
  const bh = SIZE / rows;
  const bw = SIZE / cols;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let c = -1; c <= cols; c++) {
      const x = c * bw + off;
      const y = r * bh;
      const v = (hash2(r, c, seed) - 0.5) * lightness;
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      bevel(ctx, x + 2, y + 2, bw - 4, bh - 4, 2, 0.12, 0.2);
    }
  }
  ctx.fillStyle = mortar;
  for (let r = 0; r <= rows; r++) ctx.fillRect(0, r * bh - 2, SIZE, 3);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let c = 0; c <= cols; c++) ctx.fillRect(((c * bw + off) % SIZE) - 1, r * bh, 3, bh);
  }
}

// ── layers ───────────────────────────────────────────────────────────────────
layer('stone', {}, (ctx) => {
  fillNoise(ctx, rgb('#8b8e92'), 0.12, 4, 1);
  // large soft slabs
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 64;
    const y = Math.floor(i / 2) * 64;
    bevel(ctx, x, y, 64, 64, 3, 0.08, 0.16);
  }
  speckle(ctx, 60, 'rgba(40,40,48,0.25)', 3, 2);
});

layer('stonebrick', {}, (ctx) => {
  fillNoise(ctx, rgb('#7f8189'), 0.1, 4, 3);
  bricks(ctx, 4, 2, 'rgba(38,36,40,0.75)', 0.12, 4);
  speckle(ctx, 40, 'rgba(255,255,255,0.08)', 2, 5);
});

layer('grass_top', {}, (ctx) => {
  fillNoise(ctx, rgb('#6aa246'), 0.16, 4, 6);
  speckle(ctx, 220, 'rgba(160,210,90,0.35)', 3, 7);
  speckle(ctx, 120, 'rgba(30,70,20,0.3)', 3, 8);
});

layer('grass_side', { sv: 1 }, (ctx) => {
  fillNoise(ctx, rgb('#7a5a3c'), 0.14, 4, 9);
  const g = rgb('#6aa246');
  for (let x = 0; x < SIZE; x++) {
    const h = 26 + Math.floor(hash2(x >> 2, 0, 10) * 16);
    ctx.fillStyle = `rgb(${g[0]},${g[1]},${g[2]})`;
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, 0, SIZE, 4);
  speckle(ctx, 60, 'rgba(40,25,15,0.3)', 3, 11);
});

layer('dirt', {}, (ctx) => {
  fillNoise(ctx, rgb('#7a5a3c'), 0.16, 4, 12);
  speckle(ctx, 90, 'rgba(40,25,15,0.35)', 3, 13);
});

layer('sand', {}, (ctx) => {
  fillNoise(ctx, rgb('#d8c690'), 0.07, 2, 14);
  speckle(ctx, 150, 'rgba(120,100,60,0.2)', 2, 15);
});

layer('planks', { su: 1, sv: 1 }, (ctx) => {
  fillNoise(ctx, rgb('#a87a4a'), 0.08, 2, 16);
  const rows = 4;
  const h = SIZE / rows;
  for (let r = 0; r < rows; r++) {
    const v = (hash2(r, 0, 17) - 0.5) * 0.18;
    ctx.fillStyle = v > 0 ? `rgba(255,230,200,${v})` : `rgba(0,0,0,${-v})`;
    ctx.fillRect(0, r * h, SIZE, h);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(70,40,20,0.18)';
      ctx.fillRect(0, r * h + 4 + Math.floor(hash2(r, i, 18) * (h - 8)), SIZE, 1);
    }
    bevel(ctx, 0, r * h, SIZE, h, 3, 0.1, 0.35);
    const cut = Math.floor(hash2(r, 3, 19) * SIZE);
    ctx.fillStyle = 'rgba(40,22,10,0.6)';
    ctx.fillRect(cut, r * h, 2, h);
  }
});

layer('log_side', { su: 1, sv: 1 }, (ctx) => {
  fillNoise(ctx, rgb('#6b4a2e'), 0.12, 2, 20);
  for (let x = 0; x < SIZE; x += 6 + Math.floor(hash2(x, 0, 21) * 6)) {
    ctx.fillStyle = 'rgba(30,18,8,0.4)';
    ctx.fillRect(x, 0, 2, SIZE);
  }
});

layer('log_top', { su: 1, sv: 1 }, (ctx) => {
  fillNoise(ctx, rgb('#b08a5a'), 0.06, 2, 22);
  ctx.strokeStyle = 'rgba(90,60,30,0.45)';
  ctx.lineWidth = 3;
  for (let r = 10; r < 64; r += 10) {
    ctx.beginPath();
    ctx.arc(64, 64, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(70,45,25,1)';
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, SIZE, SIZE);
});

layer('leaves', {}, (ctx) => {
  fillNoise(ctx, rgb('#4c8a3a'), 0.25, 4, 23);
  speckle(ctx, 260, 'rgba(120,190,80,0.35)', 5, 24);
  speckle(ctx, 200, 'rgba(20,50,15,0.45)', 5, 25);
});

layer('basalt', {}, (ctx) => {
  fillNoise(ctx, rgb('#43464e'), 0.12, 4, 26);
  bricks(ctx, 2, 1, 'rgba(15,15,20,0.8)', 0.1, 27);
});

layer('trim', { su: 1, sv: 1, metal: 0.75 }, (ctx) => {
  fillNoise(ctx, rgb('#c0924a'), 0.06, 1, 28);
  // brushed lines
  for (let y = 0; y < SIZE; y += 2) {
    ctx.fillStyle = `rgba(255,240,200,${hash2(y, 0, 29) * 0.12})`;
    ctx.fillRect(0, y, SIZE, 1);
  }
  bevel(ctx, 0, 0, SIZE, SIZE, 8, 0.3, 0.45);
  ctx.fillStyle = 'rgba(60,40,15,0.8)';
  for (const [x, y] of [
    [18, 18],
    [106, 18],
    [18, 106],
    [106, 106],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
});

layer('crystal', { su: 1, sv: 1, emit: 1.4 }, (ctx) => {
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, '#9ef3ff');
  g.addColorStop(0.5, '#3fb8e0');
  g.addColorStop(1, '#1a6fa0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(hash2(i, 0, 30) * SIZE, 0);
    ctx.lineTo(hash2(i, 1, 30) * SIZE, SIZE);
    ctx.stroke();
  }
  bevel(ctx, 0, 0, SIZE, SIZE, 6, 0.3, 0.3);
});

layer('tile', {}, (ctx) => {
  fillNoise(ctx, rgb('#bdb4a3'), 0.05, 4, 31);
  const n = 2;
  const s = SIZE / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = (hash2(i, j, 32) - 0.5) * 0.08;
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      ctx.fillRect(i * s, j * s, s, s);
      bevel(ctx, i * s + 1, j * s + 1, s - 2, s - 2, 3, 0.16, 0.2);
    }
  ctx.fillStyle = 'rgba(70,62,52,0.55)';
  for (let i = 0; i <= n; i++) {
    ctx.fillRect(i * s - 1, 0, 2, SIZE);
    ctx.fillRect(0, i * s - 1, SIZE, 2);
  }
  speckle(ctx, 30, 'rgba(90,80,70,0.25)', 2, 33);
});

layer('moss', {}, (ctx) => {
  fillNoise(ctx, rgb('#7f8189'), 0.1, 4, 34);
  bricks(ctx, 4, 2, 'rgba(38,36,40,0.7)', 0.1, 35);
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const m = hash2(x >> 3, y >> 3, 36) * 0.6 + hash2(x >> 4, y >> 4, 37) * 0.6;
      if (m > 0.62) {
        const i = (y * SIZE + x) * 4;
        img.data[i] = img.data[i] * 0.45 + 70 * 0.55;
        img.data[i + 1] = img.data[i + 1] * 0.45 + 120 * 0.55;
        img.data[i + 2] = img.data[i + 2] * 0.45 + 50 * 0.55;
      }
    }
  ctx.putImageData(img, 0, 0);
});

layer('clay', {}, (ctx) => {
  fillNoise(ctx, rgb('#a88a74'), 0.08, 4, 38);
  bevel(ctx, 0, 0, SIZE, SIZE, 3, 0.1, 0.2);
});

layer('lamp', { su: 1, sv: 1, emit: 1.6 }, (ctx) => {
  const g = ctx.createRadialGradient(64, 64, 5, 64, 64, 70);
  g.addColorStop(0, '#fff3c4');
  g.addColorStop(0.6, '#ffc35a');
  g.addColorStop(1, '#d9782a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(0, 0, SIZE, 10);
  ctx.fillRect(0, SIZE - 10, SIZE, 10);
  ctx.fillRect(0, 0, 10, SIZE);
  ctx.fillRect(SIZE - 10, 0, 10, SIZE);
  ctx.fillRect(60, 0, 8, SIZE);
  ctx.fillRect(0, 60, SIZE, 8);
});

/** [top, side, bottom] layer names per block. */
const FACES: Partial<Record<Block, [string, string, string]>> = {
  [Block.Stone]: ['stone', 'stone', 'stone'],
  [Block.StoneBrick]: ['stonebrick', 'stonebrick', 'stonebrick'],
  [Block.Grass]: ['grass_top', 'grass_side', 'dirt'],
  [Block.Dirt]: ['dirt', 'dirt', 'dirt'],
  [Block.Sand]: ['sand', 'sand', 'sand'],
  [Block.Planks]: ['planks', 'planks', 'planks'],
  [Block.Log]: ['log_top', 'log_side', 'log_top'],
  [Block.Leaves]: ['leaves', 'leaves', 'leaves'],
  [Block.Basalt]: ['basalt', 'basalt', 'basalt'],
  [Block.Trim]: ['trim', 'trim', 'trim'],
  [Block.Crystal]: ['crystal', 'crystal', 'crystal'],
  [Block.Tile]: ['tile', 'stonebrick', 'stone'],
  [Block.Moss]: ['moss', 'moss', 'stone'],
  [Block.SlabStone]: ['tile', 'stonebrick', 'stone'],
  [Block.SlabPlanks]: ['planks', 'planks', 'planks'],
  [Block.Clay]: ['clay', 'clay', 'clay'],
  [Block.Lamp]: ['lamp', 'lamp', 'lamp'],
};

export function faceLayer(b: Block, face: 'top' | 'side' | 'bottom'): number {
  const f = FACES[b] ?? ['stone', 'stone', 'stone'];
  const name = face === 'top' ? f[0] : face === 'side' ? f[1] : f[2];
  return layerIndex.get(name) ?? 0;
}

export function layerInfo(i: number): LayerInfo {
  return LAYERS[i].info;
}

let cached: THREE.DataArrayTexture | null = null;

export function blockTextureArray(): THREE.DataArrayTexture {
  if (cached) return cached;
  const n = LAYERS.length;
  const data = new Uint8Array(SIZE * SIZE * 4 * n);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  LAYERS.forEach((l, i) => {
    ctx.clearRect(0, 0, SIZE, SIZE);
    l.paint(ctx, (x, y) => hash2(x, y, i));
    const img = ctx.getImageData(0, 0, SIZE, SIZE).data;
    // flip rows so v=0 is the bottom of the painted image
    for (let y = 0; y < SIZE; y++) {
      const src = (SIZE - 1 - y) * SIZE * 4;
      data.set(img.subarray(src, src + SIZE * 4), i * SIZE * SIZE * 4 + y * SIZE * 4);
    }
  });
  const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
