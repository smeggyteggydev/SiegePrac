import * as THREE from 'three';
import { Block } from '../game/World';
import { hash2 } from '../utils/noise';

/**
 * 16×16 pixel-art block textures (original designs, PvP-pack style: clean,
 * readable, low noise) painted procedurally and packed into a texture array.
 * Sharp magnification + mipmapped minification = crisp up close, no shimmer far away.
 */

const SIZE = 16;

export interface LayerInfo {
  /** emissive strength */
  emit: number;
  /** extra metalness (0..1) */
  metal: number;
  /** foliage sway amount */
  wave: number;
}

type Px = (x: number, y: number) => string | null;
const LAYERS: { name: string; info: LayerInfo; paint: Px }[] = [];
const layerIndex = new Map<string, number>();

function layer(name: string, info: Partial<LayerInfo>, paint: Px) {
  layerIndex.set(name, LAYERS.length);
  LAYERS.push({ name, info: { emit: 0, metal: 0, wave: 0, ...info }, paint });
}

/** Pick from a palette (dark→light) with deterministic per-pixel noise. */
function pal(colors: string[], x: number, y: number, seed: number, bias = 0): string {
  const n = hash2(x, y, seed) * 0.75 + hash2(x >> 1, y >> 1, seed + 1) * 0.25 + bias;
  const i = Math.max(0, Math.min(colors.length - 1, Math.floor(n * colors.length)));
  return colors[i];
}

const STONE = ['#6d7076', '#7a7d83', '#83868c', '#8c8f95', '#969a9f'];
const BRICK = ['#646770', '#6f727b', '#787b84', '#81848d'];
const MORTAR = '#48494f';
const GRASS = ['#4f8a35', '#5a9a3c', '#63a443', '#6db04a', '#79bc52'];
const DIRT = ['#6a4b33', '#76553a', '#80603f', '#8a6946'];
const SAND = ['#cdb883', '#d6c28c', '#dcc995', '#e2d09d'];
const PLANK = ['#8a6238', '#96703f', '#a17a46', '#ab844d'];
const BARK = ['#4a3421', '#553c26', '#5f442b', '#6a4c30'];
const LEAF = ['#2f6a2a', '#377731', '#3f8338', '#4a9040', '#56a048'];
const BASALT = ['#34363c', '#3b3d44', '#42454c', '#4a4d54'];
const GOLD = ['#9c6f2a', '#b5853a', '#c99a48', '#dcb05a', '#efcb78'];
const TILE = ['#a8a296', '#b2ac9f', '#bbb5a8', '#c3bdb0'];
const CLAY = ['#94796a', '#9e8373', '#a88d7c', '#b19685'];

layer('stone', {}, (x, y) => pal(STONE, x, y, 1, hash2(x >> 2, y >> 2, 9) * 0.15 - 0.07));

layer('stonebrick', {}, (x, y) => {
  const row = y >> 2; // 4px bricks
  const off = row % 2 ? 4 : 0;
  const bx = (x + off) % 8;
  if (y % 4 === 3 || bx === 7) return MORTAR;
  const brickShade = hash2((x + off) >> 3, row, 3) * 0.3 - 0.15;
  let c = pal(BRICK, x, y, 2, brickShade);
  if (y % 4 === 0 || bx === 0) c = BRICK[Math.min(3, BRICK.indexOf(c) + 1)];
  return c;
});

layer('grass_top', { wave: 0 }, (x, y) => pal(GRASS, x, y, 4, hash2(x >> 2, y >> 2, 5) * 0.2 - 0.1));

layer('grass_side', {}, (x, y) => {
  // y=0 is the top row of the painted image
  const drip = 3 + Math.floor(hash2(x, 0, 6) * 3);
  if (y < drip) return pal(GRASS, x, y, 7);
  if (y === drip && hash2(x, 1, 6) < 0.5) return GRASS[0];
  return pal(DIRT, x, y, 8);
});

layer('dirt', {}, (x, y) => pal(DIRT, x, y, 9));
layer('sand', {}, (x, y) => pal(SAND, x, y, 10, -0.05));

layer('planks', {}, (x, y) => {
  const board = y >> 2;
  if (y % 4 === 3) return '#5e4127';
  const seam = (board % 2 ? 11 : 4) === x;
  if (seam) return '#5e4127';
  const c = pal(PLANK, x, y, 11 + board, hash2(board, 0, 12) * 0.2 - 0.1);
  return hash2(x, y, 13) < 0.08 ? PLANK[0] : c;
});

layer('log_side', {}, (x, y) => {
  const stripe = hash2(x, 0, 14) < 0.3;
  return stripe ? BARK[0] : pal(BARK, x, y >> 1, 15, 0.1);
});

layer('log_top', {}, (x, y) => {
  const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
  if (d > 6.5) return pal(BARK, x, y, 16);
  return Math.round(d) % 2 ? '#a07a4a' : '#b8905a';
});

layer('leaves', { wave: 1 }, (x, y) => {
  if (hash2(x, y, 17) < 0.14) return null; // cutout
  return pal(LEAF, x, y, 18, hash2(x >> 1, y >> 1, 19) * 0.2 - 0.1);
});

layer('basalt', {}, (x, y) => {
  if (x === 0 || y === 0) return BASALT[3];
  if (x === 15 || y === 15) return BASALT[0];
  return pal(BASALT, x, y, 20, -0.1);
});

layer('trim', { metal: 0.7 }, (x, y) => {
  if (x === 0 || y === 0) return GOLD[4];
  if (x === 15 || y === 15) return GOLD[0];
  if ((x === 3 || x === 12) && (y === 3 || y === 12)) return '#6e4c1c';
  if (x === 1 || y === 1) return GOLD[3];
  if (x === 14 || y === 14) return GOLD[1];
  return pal(GOLD.slice(1, 4), x, y, 21);
});

layer('crystal', { emit: 1.5 }, (x, y) => {
  const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
  const c = ['#1f7fb0', '#2f9ed0', '#4fc2ea', '#8fe6ff', '#d8f8ff'];
  return c[Math.max(0, Math.min(4, 4 - Math.floor(d / 3.2) + (hash2(x, y, 22) < 0.2 ? 1 : 0)))];
});

layer('tile', {}, (x, y) => {
  // polished slab: soft border, calm centre — the arena floor stays readable
  if (x === 0 || y === 0) return TILE[3];
  if (x === 15 || y === 15) return '#8f897d';
  return pal(TILE, x, y, 23, -0.05);
});

layer('moss', {}, (x, y) => {
  const base = LAYERS[layerIndex.get('stonebrick')!].paint(x, y);
  const m = hash2(x >> 1, y >> 1, 24) * 0.6 + hash2(x >> 2, y >> 2, 25) * 0.6;
  if (base !== MORTAR && m > 0.7) return pal(['#4c6e30', '#58803a', '#628c40'], x, y, 26);
  return base;
});

layer('clay', {}, (x, y) => pal(CLAY, x, y, 27, -0.1));

layer('lamp', { emit: 1.7 }, (x, y) => {
  if (x === 0 || y === 0 || x === 15 || y === 15) return '#3c2a18';
  if (x === 7 || x === 8 || y === 7 || y === 8) return '#5a3e22';
  const c = ['#e88a2a', '#f5a73e', '#ffc55c', '#ffe08a', '#fff1c0'];
  const d = Math.min(Math.abs(x - 3.5), Math.abs(x - 11.5)) + Math.min(Math.abs(y - 3.5), Math.abs(y - 11.5));
  return c[Math.max(0, Math.min(4, 4 - Math.floor(d) + (hash2(x, y, 28) < 0.3 ? -1 : 0)))];
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
  [Block.SlabStone]: ['tile', 'tile', 'stone'],
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
  LAYERS.forEach((l, i) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const col = l.paint(x, y);
        // row flip: painted y=0 is the top, texture v=0 is the bottom
        const o = i * SIZE * SIZE * 4 + ((SIZE - 1 - y) * SIZE + x) * 4;
        if (col === null) {
          data[o + 3] = 0;
          continue;
        }
        const v = parseInt(col.slice(1), 16);
        data[o] = (v >> 16) & 255;
        data[o + 1] = (v >> 8) & 255;
        data[o + 2] = v & 255;
        data[o + 3] = 255;
      }
  });
  const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}

/** Paint a layer to a canvas (used for UI swatches / particles). */
export function layerColorAt(name: string, x: number, y: number): string | null {
  const i = layerIndex.get(name);
  return i === undefined ? null : LAYERS[i].paint(x, y);
}
