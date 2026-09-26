import * as THREE from 'three';
import type { ItemId } from './Items';

/**
 * 16×16 pixel-art items extruded one pixel deep — the classic PvP item look.
 * Designs are original. Geometry is centred like a generated item model:
 * pixel (0,0) is top-left, the sprite spans −0.5…0.5 on X/Y, 1/16 thick on Z.
 */

type Pixels = (string | null)[][];

const OUTLINE: Record<ItemId, string> = { sword: '#171b24', axe: '#1c1510', gapple: '#5a3a08' };

const PALETTES: Record<ItemId, Record<string, string>> = {
  sword: {
    S: '#f4f7fa', // steel highlight
    s: '#c3ccd6', // steel
    d: '#7f8a98', // steel shadow
    c: '#8ff0ff', // glowing core (emissive)
    G: '#ffd76a', // gold light
    g: '#b27b22', // gold dark
    h: '#3d2616', // grip
    H: '#6a4428', // grip light
    p: '#5fe0ff', // pommel gem (emissive)
  },
  axe: {
    w: '#7a5530',
    W: '#9c7040',
    S: '#eef2f6',
    s: '#b8c1cb',
    d: '#7a8390',
    e: '#ffb35c', // hot edge (emissive)
    b: '#3a2a1a',
  },
  gapple: {
    Y: '#fff2a8',
    G: '#ffd23f',
    g: '#e6a622',
    o: '#b87814',
    t: '#5a3a1a',
    l: '#5fb03a',
    L: '#8ad65a',
  },
};

const EMISSIVE = new Set(['c', 'p', 'e']);

function grid(): Pixels {
  return Array.from({ length: 16 }, () => new Array<string | null>(16).fill(null));
}

function set(p: Pixels, x: number, y: number, c: string) {
  if (x >= 0 && y >= 0 && x < 16 && y < 16) p[y][x] = c;
}

function outline(p: Pixels): void {
  const add: [number, number][] = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (p[y][x]) continue;
      const n = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ].some(([a, b]) => a >= 0 && b >= 0 && a < 16 && b < 16 && p[b][a] && p[b][a] !== 'O');
      if (n) add.push([x, y]);
    }
  for (const [x, y] of add) p[y][x] = 'O';
}

function swordPixels(): Pixels {
  const p = grid();
  // Blade: diagonal from the tip (top-right) to the guard.
  for (let i = 0; i <= 8; i++) {
    const cx = 14 - i;
    const cy = 1 + i;
    set(p, cx, cy, i === 0 ? 'S' : 'c');
    set(p, cx - 1, cy, 'S');
    set(p, cx, cy + 1, i === 0 ? 's' : 'd');
    if (i > 0 && i < 8) set(p, cx - 1, cy - 1 + 1, 'S');
  }
  // Crossguard perpendicular to the blade
  for (let k = -3; k <= 3; k++) set(p, 5 + k, 10 + k, k <= 0 ? 'G' : 'g');
  set(p, 4, 10, 'g');
  // Grip + pommel
  set(p, 4, 11, 'H');
  set(p, 3, 12, 'h');
  set(p, 2, 13, 'H');
  set(p, 1, 14, 'p');
  outline(p);
  return p;
}

function axePixels(): Pixels {
  const p = grid();
  for (let i = 0; i <= 10; i++) set(p, 3 + i, 14 - i, i % 3 === 0 ? 'W' : 'w');
  const rows: [number, number, number][] = [
    [1, 7, 10],
    [2, 6, 11],
    [3, 5, 11],
    [4, 5, 11],
    [5, 6, 10],
    [6, 7, 9],
  ];
  for (const [y, x0, x1] of rows)
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0;
      set(p, x, y, edge ? 'e' : x === x0 + 1 ? 'S' : y > 4 ? 'd' : 's');
    }
  set(p, 11, 4, 'b');
  set(p, 12, 3, 'b');
  set(p, 10, 5, 'w');
  outline(p);
  return p;
}

function gapplePixels(): Pixels {
  const p = grid();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const dy = (y - 9.2) * 1.08;
      const d = Math.hypot(dx, dy);
      if (d > 5.6) continue;
      const light = -dx * 0.5 - dy * 0.6;
      const c = d > 4.8 ? 'o' : light > 2.6 ? 'Y' : light > 0.5 ? 'G' : light > -2 ? 'g' : 'o';
      set(p, x, y, c);
    }
  set(p, 7, 3, 't');
  set(p, 8, 2, 't');
  set(p, 9, 2, 'l');
  set(p, 10, 2, 'L');
  set(p, 10, 1, 'l');
  set(p, 11, 1, 'L');
  outline(p);
  return p;
}

const PIXELS: Record<ItemId, () => Pixels> = { sword: swordPixels, axe: axePixels, gapple: gapplePixels };

function colorOf(id: ItemId, ch: string): string {
  return ch === 'O' ? OUTLINE[id] : PALETTES[id][ch] ?? '#ff00ff';
}

const geoCache = new Map<ItemId, { solid: THREE.BufferGeometry; glow: THREE.BufferGeometry | null }>();

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function build(id: ItemId) {
  const px = PIXELS[id]();
  const P = 1 / 16;
  const out = { solid: { pos: [] as number[], nor: [] as number[], col: [] as number[] }, glow: { pos: [] as number[], nor: [] as number[], col: [] as number[] } };
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && !!px[y][x];
  const quad = (t: typeof out.solid, v: number[][], n: number[], c: number[]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      t.pos.push(...v[i]);
      t.nor.push(...n);
      t.col.push(...c);
    }
  };
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const ch = px[y][x];
      if (!ch) continue;
      const hex = parseInt(colorOf(id, ch).slice(1), 16);
      const c = [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)];
      const t = EMISSIVE.has(ch) ? out.glow : out.solid;
      const x0 = x * P - 0.5;
      const x1 = x0 + P;
      const y1 = 0.5 - y * P;
      const y0 = y1 - P;
      const z0 = -P / 2;
      const z1 = P / 2;
      quad(t, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], c);
      quad(t, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], c);
      const shade = c.map((v) => v * 0.8);
      if (!filled(x + 1, y)) quad(t, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], shade);
      if (!filled(x - 1, y)) quad(t, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], shade);
      if (!filled(x, y - 1)) quad(t, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], shade);
      if (!filled(x, y + 1)) quad(t, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], shade);
    }
  const mk = (t: typeof out.solid) => {
    if (!t.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
    return g;
  };
  return { solid: mk(out.solid)!, glow: mk(out.glow) };
}

/** A fresh mesh group for the item, centred like a generated item model. */
export function buildPixelItem(id: ItemId): THREE.Group {
  let g = geoCache.get(id);
  if (!g) {
    g = build(id);
    geoCache.set(id, g);
  }
  const group = new THREE.Group();
  const metal = id !== 'gapple';
  const solid = new THREE.Mesh(
    g.solid,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: metal ? 0.45 : 0.5, metalness: metal ? 0.25 : 0.3 }),
  );
  solid.castShadow = true;
  group.add(solid);
  if (g.glow) {
    const glow = new THREE.Mesh(g.glow, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    glow.onBeforeRender = () => {};
    // push the glow a bit over 1.0 so bloom picks it up
    (glow.material as THREE.MeshBasicMaterial).color.setScalar(1.6);
    group.add(glow);
  }
  // Pixel-space anchors (for trails): sword tip / guard
  const pxToLocal = (x: number, y: number) => new THREE.Vector3((x + 0.5) / 16 - 0.5, 0.5 - (y + 0.5) / 16, 0);
  group.userData.tipLocal = id === 'axe' ? pxToLocal(6, 3) : pxToLocal(14.5, 0.5);
  group.userData.baseLocal = id === 'axe' ? pxToLocal(11, 5) : pxToLocal(6, 9);
  return group;
}

/** The item sprite as a crisp PNG (hotbar / inventory icons). */
export function itemIconUrl(id: ItemId, scale = 4): string {
  const px = PIXELS[id]();
  const c = document.createElement('canvas');
  c.width = c.height = 16 * scale;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const ch = px[y][x];
      if (!ch) continue;
      g.fillStyle = colorOf(id, ch);
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  return c.toDataURL('image/png');
}
