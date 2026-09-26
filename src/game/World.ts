import { AABB } from './Physics';

/**
 * Block palette. Values are stored in a Uint8Array so keep this < 256.
 * Rendering data (colours, textures) lives in render/BlockMaterials.ts — the
 * simulation only cares about collision shape.
 */
export enum Block {
  Air = 0,
  Stone,
  StoneBrick,
  Grass,
  Dirt,
  Sand,
  Planks,
  Log,
  Leaves,
  Basalt,
  Trim,
  Crystal,
  Tile,
  Moss,
  SlabStone,
  SlabPlanks,
  Barrier,
  Clay,
  BannerRed,
  BannerBlue,
  Lamp,
  Count,
}

export type BlockShape = 'none' | 'full' | 'slab';

const SHAPES: BlockShape[] = [];
for (let i = 0; i < Block.Count; i++) SHAPES[i] = 'full';
SHAPES[Block.Air] = 'none';
SHAPES[Block.SlabStone] = 'slab';
SHAPES[Block.SlabPlanks] = 'slab';

/** Blocks the mesher treats as fully opaque cubes (cull neighbour faces, cast AO). */
const OPAQUE: boolean[] = [];
for (let i = 0; i < Block.Count; i++) OPAQUE[i] = SHAPES[i] === 'full';
OPAQUE[Block.Barrier] = false;
OPAQUE[Block.Leaves] = false; // cutout texture — neighbours stay visible

export function blockShape(b: number): BlockShape {
  return SHAPES[b] ?? 'none';
}
export function isOpaque(b: number): boolean {
  return OPAQUE[b] ?? false;
}
export function isSolid(b: number): boolean {
  return SHAPES[b] !== 'none';
}

/**
 * Dense voxel grid. Cell (x,y,z) occupies [x,x+1)×[y,y+1)×[z,z+1) in world space.
 */
export class VoxelWorld {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly data: Uint8Array;
  /** Height of the water surface, or -Infinity if none. Water is decorative/slowing, not solid. */
  waterLevel = -Infinity;
  /** Named points the game uses for spawns, drills, etc. */
  readonly markers = new Map<string, { x: number; y: number; z: number; yaw: number }[]>();

  constructor(sx: number, sy: number, sz: number, ox: number, oy: number, oz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    this.data = new Uint8Array(sx * sy * sz);
  }

  private index(x: number, y: number, z: number): number {
    const ix = x - this.ox;
    const iy = y - this.oy;
    const iz = z - this.oz;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.sx || iy >= this.sy || iz >= this.sz) return -1;
    return (iy * this.sz + iz) * this.sx + ix;
  }

  get(x: number, y: number, z: number): number {
    const i = this.index(x, y, z);
    return i < 0 ? Block.Air : this.data[i];
  }

  set(x: number, y: number, z: number, b: number): void {
    const i = this.index(x, y, z);
    if (i >= 0) this.data[i] = b;
  }

  /** Fill an inclusive box of cells. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: number): void {
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
    const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
    for (let y = ay; y <= by; y++)
      for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) this.set(x, y, z, b);
  }

  addMarker(name: string, x: number, y: number, z: number, yaw = 0): void {
    let list = this.markers.get(name);
    if (!list) this.markers.set(name, (list = []));
    list.push({ x, y, z, yaw });
  }

  marker(name: string, i = 0) {
    const list = this.markers.get(name);
    if (!list || list.length === 0) return { x: 0, y: 2, z: 0, yaw: 0 };
    return list[i % list.length];
  }

  /** Highest solid top at column (x,z) at or below `fromY`; returns -Infinity if none. */
  groundHeight(x: number, z: number, fromY = this.oy + this.sy): number {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    for (let y = Math.floor(fromY); y >= this.oy; y--) {
      const b = this.get(cx, y, cz);
      const s = blockShape(b);
      if (s === 'full') return y + 1;
      if (s === 'slab') return y + 0.5;
    }
    return -Infinity;
  }

  /** Append collision boxes intersecting `q` to `out`. */
  collectBoxes(q: AABB, out: AABB[]): AABB[] {
    const x0 = Math.floor(q.minX) - 1;
    const x1 = Math.floor(q.maxX);
    const y0 = Math.floor(q.minY) - 1;
    const y1 = Math.floor(q.maxY);
    const z0 = Math.floor(q.minZ) - 1;
    const z1 = Math.floor(q.maxZ);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const b = this.get(x, y, z);
          if (b === Block.Air) continue;
          const s = SHAPES[b];
          if (s === 'full') out.push(new AABB(x, y, z, x + 1, y + 1, z + 1));
          else if (s === 'slab') out.push(new AABB(x, y, z, x + 1, y + 0.5, z + 1));
        }
    return out;
  }

  /** True if any collision box overlaps `q`. */
  intersects(q: AABB): boolean {
    const tmp: AABB[] = [];
    this.collectBoxes(q, tmp);
    for (const b of tmp) if (b.intersects(q)) return true;
    return false;
  }

  /**
   * Ray march through the grid (Amanatides–Woo DDA). Returns the distance to the
   * first solid surface, or Infinity if nothing is hit within maxDist.
   * Barrier blocks are ignored so invisible walls never block attacks.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
    let t = 0;
    const tmp = new AABB(0, 0, 0, 0, 0, 0);
    for (let i = 0; i < 256 && t <= maxDist; i++) {
      const b = this.get(x, y, z);
      if (b !== Block.Air && b !== Block.Barrier) {
        const s = SHAPES[b];
        if (s === 'full') return t;
        if (s === 'slab') {
          tmp.set(x, y, z, x + 1, y + 0.5, z + 1);
          const th = tmp.rayHit(ox, oy, oz, dx, dy, dz);
          if (th >= 0 && th <= maxDist) return th;
        }
      }
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          x += stepX;
          t = tMaxX;
          tMaxX += tDeltaX;
        } else {
          z += stepZ;
          t = tMaxZ;
          tMaxZ += tDeltaZ;
        }
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    }
    return Infinity;
  }
}
