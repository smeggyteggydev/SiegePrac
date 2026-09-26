import type { VoxelWorld } from './World';

const EPS = 1e-7;

export class AABB {
  constructor(
    public minX: number,
    public minY: number,
    public minZ: number,
    public maxX: number,
    public maxY: number,
    public maxZ: number,
  ) {}

  set(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): this {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
    return this;
  }

  static fromFeet(x: number, y: number, z: number, halfW: number, h: number): AABB {
    return new AABB(x - halfW, y, z - halfW, x + halfW, y + h, z + halfW);
  }

  clone(): AABB {
    return new AABB(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
  }

  offset(dx: number, dy: number, dz: number): this {
    this.minX += dx;
    this.maxX += dx;
    this.minY += dy;
    this.maxY += dy;
    this.minZ += dz;
    this.maxZ += dz;
    return this;
  }

  expand(g: number): this {
    this.minX -= g;
    this.minY -= g;
    this.minZ -= g;
    this.maxX += g;
    this.maxY += g;
    this.maxZ += g;
    return this;
  }

  /** Grow toward a movement delta (swept bounds). */
  extend(dx: number, dy: number, dz: number): AABB {
    const b = this.clone();
    if (dx < 0) b.minX += dx;
    else b.maxX += dx;
    if (dy < 0) b.minY += dy;
    else b.maxY += dy;
    if (dz < 0) b.minZ += dz;
    else b.maxZ += dz;
    return b;
  }

  intersects(o: AABB): boolean {
    return (
      o.maxX > this.minX + EPS &&
      o.minX < this.maxX - EPS &&
      o.maxY > this.minY + EPS &&
      o.minY < this.maxY - EPS &&
      o.maxZ > this.minZ + EPS &&
      o.minZ < this.maxZ - EPS
    );
  }

  /** Clip movement of `mover` along X so it doesn't penetrate this box. */
  clipX(mover: AABB, dx: number): number {
    if (mover.maxY <= this.minY + EPS || mover.minY >= this.maxY - EPS) return dx;
    if (mover.maxZ <= this.minZ + EPS || mover.minZ >= this.maxZ - EPS) return dx;
    if (dx > 0 && mover.maxX <= this.minX + EPS) {
      const d = this.minX - mover.maxX;
      if (d < dx) dx = d;
    } else if (dx < 0 && mover.minX >= this.maxX - EPS) {
      const d = this.maxX - mover.minX;
      if (d > dx) dx = d;
    }
    return dx;
  }

  clipY(mover: AABB, dy: number): number {
    if (mover.maxX <= this.minX + EPS || mover.minX >= this.maxX - EPS) return dy;
    if (mover.maxZ <= this.minZ + EPS || mover.minZ >= this.maxZ - EPS) return dy;
    if (dy > 0 && mover.maxY <= this.minY + EPS) {
      const d = this.minY - mover.maxY;
      if (d < dy) dy = d;
    } else if (dy < 0 && mover.minY >= this.maxY - EPS) {
      const d = this.maxY - mover.minY;
      if (d > dy) dy = d;
    }
    return dy;
  }

  clipZ(mover: AABB, dz: number): number {
    if (mover.maxX <= this.minX + EPS || mover.minX >= this.maxX - EPS) return dz;
    if (mover.maxY <= this.minY + EPS || mover.minY >= this.maxY - EPS) return dz;
    if (dz > 0 && mover.maxZ <= this.minZ + EPS) {
      const d = this.minZ - mover.maxZ;
      if (d < dz) dz = d;
    } else if (dz < 0 && mover.minZ >= this.maxZ - EPS) {
      const d = this.maxZ - mover.minZ;
      if (d > dz) dz = d;
    }
    return dz;
  }

  /**
   * Slab-method ray test. Returns entry distance (0 if origin is inside) or -1.
   * Direction need not be normalised; result is in units of the direction length.
   */
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    let tmin = -Infinity;
    let tmax = Infinity;
    const axes: [number, number, number, number][] = [
      [ox, dx, this.minX, this.maxX],
      [oy, dy, this.minY, this.maxY],
      [oz, dz, this.minZ, this.maxZ],
    ];
    for (const [o, d, mn, mx] of axes) {
      if (Math.abs(d) < 1e-12) {
        if (o < mn || o > mx) return -1;
      } else {
        let t1 = (mn - o) / d;
        let t2 = (mx - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    if (tmax < 0) return -1;
    return tmin < 0 ? 0 : tmin;
  }

  /** Squared distance from a point to this box (0 if inside). */
  distSqToPoint(x: number, y: number, z: number): number {
    const cx = Math.max(this.minX, Math.min(x, this.maxX));
    const cy = Math.max(this.minY, Math.min(y, this.maxY));
    const cz = Math.max(this.minZ, Math.min(z, this.maxZ));
    return (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
  }
}

export interface MoveResult {
  dx: number;
  dy: number;
  dz: number;
  onGround: boolean;
  hitX: boolean;
  hitZ: boolean;
  hitCeiling: boolean;
  stepped: number;
}

const scratch: AABB[] = [];

function sweep(boxes: AABB[], box: AABB, dx: number, dy: number, dz: number) {
  for (const c of boxes) dy = c.clipY(box, dy);
  box.offset(0, dy, 0);
  for (const c of boxes) dx = c.clipX(box, dx);
  box.offset(dx, 0, 0);
  for (const c of boxes) dz = c.clipZ(box, dz);
  box.offset(0, 0, dz);
  return { dx, dy, dz };
}

/**
 * Minecraft-style axis-separated collision with step-up and optional sneak edge guard.
 * `box` is updated in place.
 */
export function moveBox(
  world: VoxelWorld,
  box: AABB,
  dx: number,
  dy: number,
  dz: number,
  canStep: number,
  edgeGuard: boolean,
  wasOnGround: boolean,
): MoveResult {
  // Sneak edge guard: never walk off a ledge while crouching on the ground.
  if (edgeGuard && wasOnGround) {
    const step = 0.05;
    const probe = (ox: number, oz: number) => {
      const p = box.clone().offset(ox, -0.6, oz);
      return !world.intersects(p);
    };
    while (dx !== 0 && probe(dx, 0)) {
      if (Math.abs(dx) < step) dx = 0;
      else dx -= Math.sign(dx) * step;
    }
    while (dz !== 0 && probe(0, dz)) {
      if (Math.abs(dz) < step) dz = 0;
      else dz -= Math.sign(dz) * step;
    }
    while (dx !== 0 && dz !== 0 && probe(dx, dz)) {
      if (Math.abs(dx) < step) dx = 0;
      else dx -= Math.sign(dx) * step;
      if (Math.abs(dz) < step) dz = 0;
      else dz -= Math.sign(dz) * step;
    }
  }

  const ox = dx;
  const oy = dy;
  const oz = dz;
  scratch.length = 0;
  const query = box.extend(dx, dy, dz);
  if (canStep > 0) {
    query.maxY += canStep;
  }
  world.collectBoxes(query, scratch);

  const start = box.clone();
  const r = sweep(scratch, box, dx, dy, dz);
  let stepped = 0;

  const blockedH = r.dx !== ox || r.dz !== oz;
  const grounded = wasOnGround || (oy < 0 && r.dy !== oy);
  if (canStep > 0 && blockedH && grounded) {
    // Try the move again from a raised position; keep it if it gets further.
    const alt = start.clone();
    let up = canStep;
    for (const c of scratch) up = c.clipY(alt, up);
    alt.offset(0, up, 0);
    let sx = ox;
    let sz = oz;
    for (const c of scratch) sx = c.clipX(alt, sx);
    alt.offset(sx, 0, 0);
    for (const c of scratch) sz = c.clipZ(alt, sz);
    alt.offset(0, 0, sz);
    let down = -up + Math.min(0, oy);
    for (const c of scratch) down = c.clipY(alt, down);
    alt.offset(0, down, 0);
    if (sx * sx + sz * sz > r.dx * r.dx + r.dz * r.dz + 1e-6) {
      box.set(alt.minX, alt.minY, alt.minZ, alt.maxX, alt.maxY, alt.maxZ);
      stepped = alt.minY - start.minY;
      return {
        dx: sx,
        dy: stepped,
        dz: sz,
        onGround: true,
        hitX: sx !== ox,
        hitZ: sz !== oz,
        hitCeiling: false,
        stepped,
      };
    }
  }

  return {
    dx: r.dx,
    dy: r.dy,
    dz: r.dz,
    onGround: oy < 0 && r.dy !== oy,
    hitX: r.dx !== ox,
    hitZ: r.dz !== oz,
    hitCeiling: oy > 0 && r.dy !== oy,
    stepped,
  };
}
