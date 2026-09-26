import { Block, VoxelWorld } from '../game/World';
import { fbm2, hash2 } from '../utils/noise';

export type Decor =
  | { type: 'banner'; x: number; y: number; z: number; yaw: number; color: 'red' | 'blue' | 'gold'; length: number }
  | { type: 'lamp'; x: number; y: number; z: number; color: number; intensity: number }
  | { type: 'flag'; x: number; y: number; z: number; color: 'red' | 'blue' | 'gold' };

export interface ArenaData {
  world: VoxelWorld;
  decor: Decor[];
}

const WATER_LEVEL = -4.6;
const BED = -9;

/**
 * "Bastion" — the first SIEGEprac duel arena.
 *
 *            N (-Z)
 *      ┌──── HIGH PLATFORM (spawn, y=5) ────┐
 *      │  stairs ↓                stairs ↓  │
 *   ┌──┴──────────── MAIN ARENA (y=0) ──────┴──┐
 *   │ west ledge (y=2)   pillars    east pit (y=-1)
 *   │                 center dais (y=1)        │
 *   └────────┬ bridge ┬──────────┬ bridge ┬────┘
 *        WEST PLATFORM (y=0) ── EAST PLATFORM (y=2)
 *                      lake (y=-4.6)
 */
export function buildArena(): ArenaData {
  const w = new VoxelWorld(112, 56, 112, -56, -24, -56);
  w.waterLevel = WATER_LEVEL;
  const decor: Decor[] = [];

  terrain(w);

  // ── Main arena plaza ──────────────────────────────────────────────────────
  const AX0 = -18, AX1 = 18, AZ0 = -14, AZ1 = 18;
  w.fill(AX0, BED, AZ0, AX1, -2, AZ1, Block.Stone);
  // Weathered foundation walls
  for (let x = AX0; x <= AX1; x++)
    for (let z = AZ0; z <= AZ1; z++) {
      const edge = x === AX0 || x === AX1 || z === AZ0 || z === AZ1;
      if (!edge) continue;
      for (let y = BED; y <= -2; y++) {
        const n = hash2(x * 3 + y, z * 5 - y, 7);
        w.set(x, y, z, y > -4 && n < 0.35 ? Block.Moss : n < 0.5 ? Block.Basalt : Block.StoneBrick);
      }
    }
  // Floor with a 4-block grid of darker lines — helps read distance and speed.
  for (let x = AX0; x <= AX1; x++)
    for (let z = AZ0; z <= AZ1; z++) {
      const line = (x - AX0) % 6 === 0 || (z - AZ0) % 6 === 0;
      w.set(x, -1, z, line ? Block.StoneBrick : Block.Tile);
    }
  // Rim wall (1 high) with trim, gaps for the bridges.
  for (let x = AX0; x <= AX1; x++)
    for (let z = AZ0; z <= AZ1; z++) {
      const edge = x === AX0 || x === AX1 || z === AZ0 || z === AZ1;
      if (!edge) continue;
      if (z === AZ1 && ((x >= -9 && x <= -7) || (x >= 7 && x <= 9))) continue;
      if (z === AZ0 && x >= -9 && x <= 9) continue;
      w.set(x, 0, z, (x + z) % 2 === 0 ? Block.Trim : Block.StoneBrick);
    }

  // ── North high platform (spawn) ──────────────────────────────────────────
  const PX0 = -9, PX1 = 9, PZ0 = -25, PZ1 = -15;
  w.fill(PX0, BED, PZ0, PX1, 3, PZ1, Block.StoneBrick);
  for (let x = PX0; x <= PX1; x++)
    for (let z = PZ0; z <= PZ1; z++) {
      w.set(x, 4, z, Block.Tile);
      if (x === PX0 || x === PX1 || z === PZ0 || z === PZ1) w.set(x, 4, z, Block.Trim);
    }
  // Facade detail on the arena-facing wall
  for (let x = PX0; x <= PX1; x++) {
    for (let y = 0; y <= 3; y++) w.set(x, y, PZ1, x % 3 === 0 ? Block.Basalt : Block.StoneBrick);
    w.set(x, 2, PZ1, x % 3 === 0 ? Block.Basalt : Block.Trim);
  }
  // Rear arch + corner lamps
  w.fill(-3, 5, PZ0, -2, 9, PZ0, Block.StoneBrick);
  w.fill(2, 5, PZ0, 3, 9, PZ0, Block.StoneBrick);
  w.fill(-3, 10, PZ0, 3, 10, PZ0, Block.Trim);
  w.fill(-1, 9, PZ0, 1, 9, PZ0, Block.StoneBrick);
  w.set(0, 11, PZ0, Block.Crystal);
  for (const [x, z] of [
    [PX0, PZ0],
    [PX1, PZ0],
  ]) {
    w.fill(x, 5, z, x, 6, z, Block.StoneBrick);
    w.set(x, 7, z, Block.Lamp);
    decor.push({ type: 'lamp', x: x + 0.5, y: 7.5, z: z + 0.5, color: 0xffb46b, intensity: 1 });
  }
  decor.push({ type: 'banner', x: -4.5, y: 4.85, z: PZ1 + 1.02, yaw: Math.PI, color: 'blue', length: 3.2 });
  decor.push({ type: 'banner', x: 4.5, y: 4.85, z: PZ1 + 1.02, yaw: Math.PI, color: 'blue', length: 3.2 });
  decor.push({ type: 'banner', x: 0.5, y: 9.9, z: PZ0 + 1.02, yaw: Math.PI, color: 'gold', length: 3.4 });

  // Stairs down both sides of the platform: half-block steps you can walk.
  for (const [sx0, sx1] of [
    [-8, -5],
    [5, 8],
  ]) {
    for (let k = 0; k <= 8; k++) {
      const z = -14 + k;
      const top = 4.5 - 0.5 * k;
      stepColumn(w, sx0, sx1, z, top, Block.StoneBrick, Block.SlabStone);
    }
    // side walls on the outer edge of each stair for a clean silhouette
  }

  // ── Pillars ──────────────────────────────────────────────────────────────
  for (const px of [-9, 9]) {
    const pz = 3;
    w.fill(px - 1, 0, pz - 1, px + 1, 5, pz + 1, Block.StoneBrick);
    w.fill(px - 1, 0, pz - 1, px + 1, 0, pz + 1, Block.Basalt);
    w.fill(px - 1, 3, pz - 1, px + 1, 3, pz + 1, Block.Trim);
    w.fill(px - 1, 6, pz - 1, px + 1, 6, pz + 1, Block.Trim);
    w.set(px, 7, pz, Block.Lamp);
    decor.push({ type: 'lamp', x: px + 0.5, y: 7.6, z: pz + 0.5, color: 0xffc27a, intensity: 1.2 });
    const color = px < 0 ? 'blue' : 'red';
    decor.push({ type: 'banner', x: px + 0.5, y: 5.9, z: pz - 1 - 0.02, yaw: 0, color, length: 2.4 });
    decor.push({ type: 'banner', x: px + 0.5, y: 5.9, z: pz + 2 + 0.02, yaw: Math.PI, color, length: 2.4 });
  }

  // ── Center dais ──────────────────────────────────────────────────────────
  for (let x = -3; x <= 3; x++)
    for (let z = 0; z <= 4; z++) {
      const inner = x >= -2 && x <= 2 && z >= 1 && z <= 3;
      w.set(x, 0, z, inner ? ((x + z) % 2 === 0 ? Block.Trim : Block.Tile) : Block.SlabStone);
    }
  w.set(0, 0, 2, Block.Crystal);

  // ── West ledge (y=2) with half-steps at both ends ─────────────────────────
  w.fill(-17, 0, -8, -14, 1, 10, Block.StoneBrick);
  w.fill(-17, 1, -8, -14, 1, 10, Block.Tile);
  for (let z = -8; z <= 10; z++) w.set(-14, 1, z, Block.Trim);
  // Parapet so the ledge is a vantage point, not a death trap.
  for (let z = -11; z <= 13; z++) w.fill(AX0, 1, z, AX0, 2, z, z % 2 === 0 ? Block.Trim : Block.StoneBrick);
  for (let k = 1; k <= 3; k++) {
    stepColumn(w, -17, -14, 10 + k, 2 - 0.5 * k, Block.StoneBrick, Block.SlabStone);
    stepColumn(w, -17, -14, -8 - k, 2 - 0.5 * k, Block.StoneBrick, Block.SlabStone);
  }

  // ── East pit (y=-1) ──────────────────────────────────────────────────────
  for (let x = 13; x <= 17; x++)
    for (let z = -8; z <= 10; z++) {
      w.set(x, -1, z, Block.Air);
      w.set(x, -2, z, (x + z) % 3 === 0 ? Block.Clay : Block.Sand);
    }
  for (let x = 13; x <= 17; x++) {
    w.set(x, -1, -8, Block.SlabStone);
    w.set(x, -1, 10, Block.SlabStone);
  }
  for (let z = -7; z <= 9; z += 4) w.set(15, -2, z, Block.Trim);

  // Corner lamp posts
  for (const [x, z] of [
    [AX0, AZ1],
    [AX1, AZ1],
    [AX0, -14],
    [AX1, -14],
  ]) {
    w.fill(x, 1, z, x, 2, z, Block.StoneBrick);
    w.set(x, 3, z, Block.Lamp);
    decor.push({ type: 'lamp', x: x + 0.5, y: 3.6, z: z + 0.5, color: 0xffb46b, intensity: 0.9 });
  }

  // ── Bridges south ────────────────────────────────────────────────────────
  // West bridge: flat. East bridge: ramps up to the higher east platform.
  for (let z = 19; z <= 27; z++) {
    for (let x = -9; x <= -7; x++) w.set(x, -1, z, Block.Planks);
    for (let x = 7; x <= 9; x++) {
      const top = z <= 22 ? 0 : Math.min(2, 0.5 * (z - 22));
      stepColumnSingle(w, x, z, top, Block.Planks, Block.SlabPlanks, -1);
    }
  }
  for (const bx of [-9, -7, 7, 9])
    for (const bz of [20, 24]) w.fill(bx, BED + 1, bz, bx, -2, bz, Block.Log);

  // ── South platforms ──────────────────────────────────────────────────────
  platform(w, -15, -5, 28, 36, 0);
  platform(w, 5, 15, 28, 36, 2);
  // Connecting bridge between the platforms, ramping west(0) → east(2)
  for (let x = -4; x <= 4; x++) {
    const top = x <= -1 ? 0 : Math.min(2, 0.5 * (x + 1));
    for (let z = 31; z <= 33; z++) stepColumnSingle(w, x, z, top, Block.Planks, Block.SlabPlanks, -1);
  }
  w.fill(0, BED + 1, 32, 0, -2, 32, Block.Log);
  // Ruins for cover
  w.fill(-13, 0, 33, -13, 1, 35, Block.StoneBrick);
  w.fill(-13, 0, 35, -10, 1, 35, Block.StoneBrick);
  w.set(-13, 2, 35, Block.Moss);
  w.fill(13, 2, 29, 13, 3, 31, Block.StoneBrick);
  w.fill(10, 2, 29, 13, 3, 29, Block.StoneBrick);
  w.set(13, 4, 29, Block.Moss);
  tree(w, -7, 0, 35, 5);
  tree(w, 7, 2, 35, 4);
  for (const [x, y, z] of [
    [-15, 0, 28],
    [-5, 0, 28],
    [5, 2, 28],
    [15, 2, 28],
  ]) {
    w.set(x, y, z, Block.StoneBrick);
    w.set(x, y + 1, z, Block.Lamp);
    decor.push({ type: 'lamp', x: x + 0.5, y: y + 1.6, z: z + 0.5, color: 0xffb46b, intensity: 0.8 });
  }
  decor.push({ type: 'flag', x: -9.5, y: 0, z: 31.5, color: 'blue' });
  decor.push({ type: 'flag', x: 10.5, y: 2, z: 32.5, color: 'red' });

  // ── Invisible boundary ───────────────────────────────────────────────────
  for (let y = BED; y < w.oy + w.sy; y++)
    for (let i = w.ox; i < w.ox + w.sx; i++) {
      w.set(i, y, w.oz, Block.Barrier);
      w.set(i, y, w.oz + w.sz - 1, Block.Barrier);
      w.set(w.ox, y, i, Block.Barrier);
      w.set(w.ox + w.sx - 1, y, i, Block.Barrier);
    }

  // ── Markers ─────────────────────────────────────────────────────────────
  w.addMarker('spawn_blue', 0.5, 0, -9.5, Math.PI);
  w.addMarker('spawn_red', 0.5, 0, 13.5, 0);
  w.addMarker('platform', 0.5, 5, -20.5, Math.PI);
  const cps: [number, number, number][] = [
    [0.5, 5, -19.5],
    [-6.5, 2.5, -10],
    [-15.5, 2, 0.5],
    [-9.5, 0, 8.5],
    [-8, 0, 24],
    [-10, 0, 31.5],
    [0.5, 0, 32.5],
    [10, 2, 32.5],
    [8, 0, 21],
    [15.5, -1, 1.5],
    [0.5, 1, 2.5],
    [6.5, 2.5, -10],
  ];
  for (const [x, y, z] of cps) w.addMarker('checkpoint', x, y, z, 0);
  const aimPts: [number, number, number][] = [
    [0.5, 0, 6.5],
    [-5.5, 0, 10.5],
    [6.5, 0, 10.5],
  ];
  for (const [x, y, z] of aimPts) w.addMarker('drill', x, y, z, 0);

  return { world: w, decor };
}

/** Fill a column-strip so its walkable top is at `top` (multiples of 0.5). */
function stepColumn(w: VoxelWorld, x0: number, x1: number, z: number, top: number, full: Block, slab: Block) {
  for (let x = x0; x <= x1; x++) stepColumnSingle(w, x, z, top, full, slab, BED);
}

function stepColumnSingle(w: VoxelWorld, x: number, z: number, top: number, full: Block, slab: Block, from: number) {
  const whole = Math.floor(top);
  for (let y = from; y < whole; y++) w.set(x, y, z, full);
  if (top - whole >= 0.5) w.set(x, whole, z, slab);
}

function platform(w: VoxelWorld, x0: number, x1: number, z0: number, z1: number, top: number) {
  w.fill(x0, BED, z0, x1, top - 2, z1, Block.Stone);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      w.set(x, top - 1, z, edge ? Block.Trim : hash2(x, z, 3) < 0.15 ? Block.Moss : Block.Grass);
      if (edge) for (let y = BED; y < top - 1; y++) w.set(x, y, z, hash2(x + y, z, 9) < 0.3 ? Block.Moss : Block.StoneBrick);
    }
}

function tree(w: VoxelWorld, x: number, y: number, z: number, h: number) {
  for (let i = 0; i < h; i++) w.set(x, y + i, z, Block.Log);
  const top = y + h;
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy <= -1 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && hash2(x + dx, z + dz + dy, 5) < 0.6) continue;
        if (w.get(x + dx, top + dy, z + dz) === Block.Air) w.set(x + dx, top + dy, z + dz, Block.Leaves);
      }
  }
}

function terrain(w: VoxelWorld) {
  for (let x = w.ox; x < w.ox + w.sx; x++)
    for (let z = w.oz; z < w.oz + w.sz; z++) {
      // Lake bed
      const bed = BED + Math.floor(fbm2(x * 0.08, z * 0.08, 3, 1) * 3);
      for (let y = BED - 3; y <= bed; y++) w.set(x, y, z, y === bed ? (hash2(x, z) < 0.5 ? Block.Sand : Block.Clay) : Block.Stone);
      // Hills ring (elliptical, centred on the arena)
      const dx = x / 50;
      const dz = (z - 6) / 52;
      const r = Math.hypot(dx, dz);
      const n = fbm2(x * 0.06, z * 0.06, 4, 11);
      const rise = (r - 0.8) * 34 + (n - 0.5) * 9;
      if (rise <= 0) continue;
      const h = Math.min(11, Math.floor(-4 + rise));
      if (h < bed + 1) continue;
      for (let y = bed + 1; y <= h; y++) {
        let b: Block = Block.Stone;
        if (y === h) b = h < WATER_LEVEL + 1 ? Block.Sand : Block.Grass;
        else if (y >= h - 2) b = h < WATER_LEVEL + 1 ? Block.Sand : Block.Dirt;
        else if (hash2(x + y * 7, z, 2) < 0.12) b = Block.Basalt;
        w.set(x, y, z, b);
      }
      if (h > WATER_LEVEL + 1 && hash2(x, z, 99) < 0.018 && h < 14) tree(w, x, h + 1, z, 4 + Math.floor(hash2(z, x) * 3));
    }
  // A few rocks breaking the lake surface
  for (const [x, z, s] of [
    [-26, 4, 2],
    [27, -6, 3],
    [24, 26, 2],
    [-28, 24, 2],
    [-22, -24, 2],
  ]) {
    for (let dx = -s; dx <= s; dx++)
      for (let dz = -s; dz <= s; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > s + 0.3) continue;
        const top = -4 + Math.floor((s - d) * 1.2 + hash2(x + dx, z + dz) * 1.5);
        for (let y = BED; y <= top; y++) w.set(x + dx, y, z + dz, y === top ? Block.Moss : Block.Stone);
      }
  }
}
