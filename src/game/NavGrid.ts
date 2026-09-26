import { blockShape, VoxelWorld } from './World';
import { VOID_Y } from '../config/constants';

/**
 * Coarse 2.5D navigation grid: one walkable surface height per column.
 * Built once from the voxel world; used by bots to path around height changes
 * and to avoid walking off lethal edges.
 */
export class NavGrid {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly d: number;
  /** Surface height per cell, NaN when not walkable. */
  readonly h: Float32Array;

  constructor(
    readonly world: VoxelWorld,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    maxY = 8,
  ) {
    this.x0 = x0;
    this.z0 = z0;
    this.w = x1 - x0 + 1;
    this.d = z1 - z0 + 1;
    this.h = new Float32Array(this.w * this.d).fill(NaN);
    for (let iz = 0; iz < this.d; iz++)
      for (let ix = 0; ix < this.w; ix++) {
        const x = x0 + ix;
        const z = z0 + iz;
        for (let y = maxY; y >= VOID_Y - 1; y--) {
          const b = world.get(x, y, z);
          const s = blockShape(b);
          if (s === 'none') continue;
          const top = s === 'slab' ? y + 0.5 : y + 1;
          const clear =
            blockShape(world.get(x, y + 1, z)) === 'none' && blockShape(world.get(x, y + 2, z)) === 'none';
          if (clear && top > VOID_Y + 0.5) this.h[iz * this.w + ix] = top;
          break;
        }
      }
  }

  heightAt(x: number, z: number): number {
    const ix = Math.floor(x) - this.x0;
    const iz = Math.floor(z) - this.z0;
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return NaN;
    return this.h[iz * this.w + ix];
  }

  /** Can a fighter move from cell a to adjacent cell b? */
  private passable(ha: number, hb: number): boolean {
    if (Number.isNaN(ha) || Number.isNaN(hb)) return false;
    const up = hb - ha;
    return up <= 1.05 && up >= -3.2;
  }

  /** A* over the grid (8-connected). Returns world-space waypoints (cell centres). */
  findPath(sx: number, sz: number, tx: number, tz: number, maxNodes = 4000): { x: number; z: number; y: number }[] | null {
    const W = this.w;
    const s = this.cellOf(sx, sz);
    const t = this.cellOf(tx, tz);
    if (s < 0 || t < 0) return null;
    if (Number.isNaN(this.h[s]) || Number.isNaN(this.h[t])) return null;
    const g = new Float32Array(W * this.d).fill(Infinity);
    const came = new Int32Array(W * this.d).fill(-1);
    const closed = new Uint8Array(W * this.d);
    const open: number[] = [s];
    const f = new Float32Array(W * this.d).fill(Infinity);
    g[s] = 0;
    const heur = (i: number) => Math.hypot((i % W) - (t % W), Math.floor(i / W) - Math.floor(t / W));
    f[s] = heur(s);
    let expanded = 0;
    while (open.length && expanded < maxNodes) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === t) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      expanded++;
      const cx = cur % W;
      const cz = Math.floor(cur / W);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= this.d) continue;
          const n = nz * W + nx;
          if (closed[n]) continue;
          if (!this.passable(this.h[cur], this.h[n])) continue;
          if (dx && dz) {
            // no corner cutting
            if (!this.passable(this.h[cur], this.h[cz * W + nx]) || !this.passable(this.h[cur], this.h[nz * W + cx])) continue;
          }
          const up = Math.max(0, this.h[n] - this.h[cur]);
          // Prefer staying away from lethal edges.
          const cost = (dx && dz ? 1.414 : 1) + up * 0.6 + this.edgePenalty(nx, nz);
          const ng = g[cur] + cost;
          if (ng < g[n]) {
            g[n] = ng;
            f[n] = ng + heur(n);
            came[n] = cur;
            open.push(n);
          }
        }
    }
    if (came[t] < 0 && s !== t) return null;
    const out: { x: number; z: number; y: number }[] = [];
    for (let c = t; c !== -1 && c !== s; c = came[c]) {
      out.push({ x: this.x0 + (c % W) + 0.5, z: this.z0 + Math.floor(c / W) + 0.5, y: this.h[c] });
    }
    out.reverse();
    return out;
  }

  private edgePenalty(ix: number, iz: number): number {
    let p = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = ix + dx;
        const z = iz + dz;
        if (x < 0 || z < 0 || x >= this.w || z >= this.d || Number.isNaN(this.h[z * this.w + x])) p += 0.6;
      }
    return p;
  }

  cellOf(x: number, z: number): number {
    const ix = Math.floor(x) - this.x0;
    const iz = Math.floor(z) - this.z0;
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return -1;
    return iz * this.w + ix;
  }

  /** Is there a lethal drop (or non-walkable) at this point? */
  isHazard(x: number, z: number, fromY: number): boolean {
    const h = this.heightAt(x, z);
    return Number.isNaN(h) || fromY - h > 3.2;
  }
}
