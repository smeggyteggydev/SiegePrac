import * as THREE from 'three';
import { hash2 } from '../utils/noise';

/**
 * Procedural 64×64 skins in the classic player UV layout, painted as
 * original "Siege knight" designs. Team colour lives on the armour so
 * opponents read instantly at range.
 */

export type Team = 'blue' | 'red';

const ARMOR: Record<Team, string[]> = {
  blue: ['#23467e', '#2f5da3', '#3f76c4', '#5a92dd', '#86b6f2'],
  red: ['#6e1a16', '#9a2a22', '#bf3a2f', '#dc5646', '#f68670'],
};
const TRIM: Record<Team, string> = { blue: '#e8d9a8', red: '#f0c35a' };
const SKIN = ['#a8765a', '#b98466', '#c79472', '#d4a27f'];
const HAIR = ['#2e1f16', '#3a281c', '#473224'];
const CLOTH = ['#23262e', '#2b2f38', '#343945'];

type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';
type Painter = (face: Face, x: number, y: number, w: number, h: number) => string | null;

function pick(pal: string[], x: number, y: number, seed: number, bias = 0): string {
  const n = hash2(x, y, seed) * 0.8 + hash2(x >> 1, y >> 1, seed + 3) * 0.2 + bias;
  return pal[Math.max(0, Math.min(pal.length - 1, Math.floor(n * pal.length)))];
}

/** Paint a box region laid out like the classic skin format. */
function paintBox(g: CanvasRenderingContext2D, u: number, v: number, w: number, h: number, d: number, paint: Painter) {
  const faces: [Face, number, number, number, number][] = [
    ['top', u + d, v, w, d],
    ['bottom', u + d + w, v, w, d],
    ['right', u, v + d, d, h],
    ['front', u + d, v + d, w, h],
    ['left', u + d + w, v + d, d, h],
    ['back', u + d + w + d, v + d, w, h],
  ];
  for (const [face, fx, fy, fw, fh] of faces)
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const c = paint(face, x, y, fw, fh);
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect(fx + x, fy + y, 1, 1);
      }
}

const cache = new Map<Team, THREE.CanvasTexture>();

export function skinTexture(team: Team): THREE.CanvasTexture {
  const hit = cache.get(team);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const A = ARMOR[team];
  const armor = (x: number, y: number, s: number, bias = 0) => pick(A.slice(1, 4), x, y, s, bias);

  // ── base layer ──
  paintBox(g, 0, 0, 8, 8, 8, (f, x, y) => {
    if (f === 'top') return pick(HAIR, x, y, 1);
    if (f === 'front') {
      if (y < 2) return pick(HAIR, x, y, 2);
      if (y === 4 && (x === 1 || x === 6)) return '#f2f2f2';
      if (y === 4 && (x === 2 || x === 5)) return team === 'blue' ? '#2a5aa8' : '#7a2a1a';
      if (y === 6 && x >= 3 && x <= 4) return '#7a4a38';
      return pick(SKIN, x, y, 3, 0.1);
    }
    if (f === 'back') return pick(HAIR, x, y, 4);
    if (y < 3) return pick(HAIR, x, y, 5);
    return pick(SKIN, x, y, 6);
  });
  paintBox(g, 16, 16, 8, 12, 4, (f, x, y) => {
    // body: dark gambeson with a tabard in team colour
    if ((f === 'front' || f === 'back') && x >= 2 && x <= 5 && y >= 2) return armor(x, y, 7, 0.1);
    if (y === 8) return '#4a3622';
    return pick(CLOTH, x, y, 8);
  });
  const limb = (seed: number, arm: boolean): Painter => (f, x, y) => {
    if (arm && y >= 9) return pick(SKIN, x, y, seed);
    if (arm && y === 8) return TRIM[team];
    if (!arm && y >= 10) return '#2a1d14';
    if (f === 'top' || f === 'bottom') return pick(CLOTH, x, y, seed + 1);
    return pick(CLOTH, x, y, seed);
  };
  paintBox(g, 40, 16, 4, 12, 4, limb(9, true)); // right arm
  paintBox(g, 32, 48, 4, 12, 4, limb(10, true)); // left arm
  paintBox(g, 0, 16, 4, 12, 4, limb(11, false)); // right leg
  paintBox(g, 16, 48, 4, 12, 4, limb(12, false)); // left leg

  // ── overlay layer: armour ──
  paintBox(g, 32, 0, 8, 8, 8, (f, x, y) => {
    // helmet with an open face so the player still reads as a person
    if (f === 'front' && y >= 3 && y <= 6 && x >= 1 && x <= 6) return y === 3 ? A[0] : null;
    if (f === 'bottom') return null;
    if (y === 7) return TRIM[team];
    if (f === 'top' && x >= 3 && x <= 4) return A[4];
    return armor(x, y, 13, y < 2 ? 0.15 : 0);
  });
  paintBox(g, 16, 32, 8, 12, 4, (f, x, y, w) => {
    if (y >= 9) return null;
    if (y === 8) return TRIM[team];
    if (f === 'front' && (x === 0 || x === w - 1)) return A[1];
    if (f === 'front' && y === 1 && x >= 2 && x <= 5) return A[4];
    return armor(x, y, 14);
  });
  const sleeve: Painter = (f, x, y) => {
    if (y > 5) return null;
    if (f === 'bottom') return null;
    if (y === 5) return TRIM[team];
    return armor(x, y, 15, y < 2 ? 0.15 : 0);
  };
  paintBox(g, 40, 32, 4, 12, 4, sleeve);
  paintBox(g, 48, 48, 4, 12, 4, sleeve);
  const pants: Painter = (f, x, y) => {
    if (f === 'top' || f === 'bottom') return null;
    if (y < 1) return null;
    if (y >= 10) return y === 10 ? TRIM[team] : A[0];
    return armor(x, y, 16, -0.05);
  };
  paintBox(g, 0, 32, 4, 12, 4, pants);
  paintBox(g, 0, 48, 4, 12, 4, pants);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  cache.set(team, tex);
  return tex;
}

/** Apply classic-layout UVs (64×64) to a BoxGeometry. */
export function mapBoxUV(geo: THREE.BoxGeometry, u: number, v: number, w: number, h: number, d: number): void {
  const S = 64;
  // three's face order: +x, -x, +y, -y, +z, -z.  Our models face -Z.
  const rects: [number, number, number, number, boolean?][] = [
    [u, v + d, d, h], // +x: fighter's right side
    [u + d + w, v + d, d, h], // -x: left side
    [u + d, v, w, d], // +y top
    [u + d + w, v, w, d, true], // -y bottom
    [u + d + w + d, v + d, w, h], // +z back
    [u + d, v + d, w, h], // -z front
  ];
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const [x, y, rw, rh, flip] = rects[f];
    const u0 = x / S;
    const u1 = (x + rw) / S;
    let v0 = 1 - (y + rh) / S;
    let v1 = 1 - y / S;
    if (flip) [v0, v1] = [v1, v0];
    // vertex order per face: (0,1) (1,1) (0,0) (1,0)
    uv.setXY(f * 4 + 0, u0, v1);
    uv.setXY(f * 4 + 1, u1, v1);
    uv.setXY(f * 4 + 2, u0, v0);
    uv.setXY(f * 4 + 3, u1, v0);
  }
  uv.needsUpdate = true;
}

export const SKIN_PARTS = {
  head: [0, 0, 8, 8, 8],
  hat: [32, 0, 8, 8, 8],
  body: [16, 16, 8, 12, 4],
  jacket: [16, 32, 8, 12, 4],
  rightArm: [40, 16, 4, 12, 4],
  rightSleeve: [40, 32, 4, 12, 4],
  leftArm: [32, 48, 4, 12, 4],
  leftSleeve: [48, 48, 4, 12, 4],
  rightLeg: [0, 16, 4, 12, 4],
  rightPants: [0, 32, 4, 12, 4],
  leftLeg: [16, 48, 4, 12, 4],
  leftPants: [0, 48, 4, 12, 4],
} as const;

export type SkinPart = keyof typeof SKIN_PARTS;

/** A box mesh of `part`, sized in pixels × `px`, optionally inflated (overlay layers). */
export function skinnedBox(team: Team, part: SkinPart, px: number, inflate = 0, material?: THREE.Material): THREE.Mesh {
  const [u, v, w, h, d] = SKIN_PARTS[part];
  const geo = new THREE.BoxGeometry((w + inflate * 2) * px, (h + inflate * 2) * px, (d + inflate * 2) * px);
  mapBoxUV(geo, u, v, w, h, d);
  const mat = material ?? skinMaterial(team, inflate > 0 ? 'overlay' : 'base');
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function skinMaterial(team: Team, kind: 'base' | 'overlay' | 'arm'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: skinTexture(team),
    roughness: kind === 'overlay' ? 0.55 : 0.85,
    metalness: kind === 'overlay' ? 0.2 : 0,
    alphaTest: 0.5,
    transparent: false,
  });
}
