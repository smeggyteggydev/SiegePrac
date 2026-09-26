import * as THREE from 'three';

/**
 * Pooled voxel particles (tiny lit/emissive cubes) — one InstancedMesh, zero
 * allocations per frame. Fits the art style and costs one draw call.
 */
interface P {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grav: number;
  drag: number;
  r: number;
  g: number;
  b: number;
  spin: number;
  glow: boolean;
}

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  readonly glowMesh: THREE.InstancedMesh;
  private pool: P[] = [];
  private cursor = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  scale = 1;

  constructor(readonly capacity = 900) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glowMesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      capacity,
    );
    this.glowMesh.frustumCulled = false;
    this.glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) {
      this.pool.push({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1,
        grav: 0, drag: 0, r: 1, g: 1, b: 1, spin: 0, glow: false,
      });
    }
    this.mesh.setColorAt(0, new THREE.Color());
    this.glowMesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.glowMesh.count = 0;
  }

  spawn(o: {
    x: number; y: number; z: number; vx: number; vy: number; vz: number;
    life: number; size: number; color: THREE.ColorRepresentation; grav?: number; drag?: number; glow?: boolean;
  }): void {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    p.alive = true;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx; p.vy = o.vy; p.vz = o.vz;
    p.life = 0;
    p.max = o.life;
    p.size = o.size;
    p.grav = o.grav ?? 18;
    p.drag = o.drag ?? 1.5;
    this.c.set(o.color);
    p.r = this.c.r; p.g = this.c.g; p.b = this.c.b;
    p.spin = (Math.random() - 0.5) * 12;
    p.glow = o.glow ?? false;
  }

  /** Directional hit sparks spraying away from the attacker. */
  hitBurst(point: THREE.Vector3, dir: THREE.Vector3, crit: boolean, blocked: boolean): void {
    const n = Math.round((crit ? 26 : 14) * this.scale);
    for (let i = 0; i < n; i++) {
      const spread = 5;
      const sp = (crit ? 7 : 5) * (0.5 + Math.random());
      this.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * sp + (Math.random() - 0.5) * spread,
        vy: 2 + Math.random() * 4,
        vz: dir.z * sp + (Math.random() - 0.5) * spread,
        life: 0.25 + Math.random() * 0.25,
        size: 0.05 + Math.random() * 0.05,
        color: blocked ? '#cfe6ff' : crit ? (Math.random() < 0.5 ? '#ffd24a' : '#fff1b0') : Math.random() < 0.6 ? '#ffffff' : '#ff6b4a',
        grav: 16,
        drag: 3,
        glow: true,
      });
    }
    // chunky red "damage" voxels
    const m = Math.round((crit ? 8 : 5) * this.scale);
    for (let i = 0; i < m; i++) {
      this.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * 3 + (Math.random() - 0.5) * 3,
        vy: 1 + Math.random() * 3,
        vz: dir.z * 3 + (Math.random() - 0.5) * 3,
        life: 0.45 + Math.random() * 0.3,
        size: 0.08 + Math.random() * 0.05,
        color: blocked ? '#8aa0b8' : '#c0302a',
        grav: 22,
        drag: 1,
      });
    }
  }

  /** Crit star ring around the victim. */
  critRing(center: THREE.Vector3): void {
    const n = Math.round(18 * this.scale);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn({
        x: center.x, y: center.y + 1.0 + Math.random() * 0.6, z: center.z,
        vx: Math.cos(a) * 4.5, vy: 0.5 + Math.random() * 1.5, vz: Math.sin(a) * 4.5,
        life: 0.35, size: 0.06, color: '#ffe27a', grav: 4, drag: 5, glow: true,
      });
    }
  }

  dust(x: number, y: number, z: number, count: number, color = '#cbbfae'): void {
    const n = Math.round(count * this.scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 1.8;
      this.spawn({
        x: x + Math.cos(a) * 0.2, y: y + 0.05, z: z + Math.sin(a) * 0.2,
        vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 0.8, vz: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.25, size: 0.07 + Math.random() * 0.06, color, grav: -1, drag: 4,
      });
    }
  }

  /** Death: the fighter breaks apart into team-coloured voxels. */
  deathBurst(pos: THREE.Vector3, team: 'red' | 'blue'): void {
    const cols = team === 'red' ? ['#d4382f', '#9aa3ae', '#2c2f36', '#ffc27a'] : ['#2f6fd1', '#9aa3ae', '#2c2f36', '#9fd0ff'];
    const n = Math.round(70 * this.scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 4;
      this.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.5, y: pos.y + Math.random() * 1.8, z: pos.z + (Math.random() - 0.5) * 0.5,
        vx: Math.cos(a) * sp, vy: 2 + Math.random() * 5, vz: Math.sin(a) * sp,
        life: 0.8 + Math.random() * 0.8, size: 0.09 + Math.random() * 0.1,
        color: cols[i % cols.length], grav: 20, drag: 0.8,
      });
    }
    const g = Math.round(30 * this.scale);
    for (let i = 0; i < g; i++) {
      this.spawn({
        x: pos.x, y: pos.y + 0.9, z: pos.z,
        vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 3,
        life: 0.7 + Math.random() * 0.5, size: 0.05, color: team === 'red' ? '#ff8a6a' : '#8cc4ff', grav: -2, drag: 2, glow: true,
      });
    }
  }

  gappleSparkle(pos: THREE.Vector3): void {
    for (let i = 0; i < 12 * this.scale; i++) {
      this.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.8, y: pos.y + Math.random() * 1.8, z: pos.z + (Math.random() - 0.5) * 0.8,
        vx: 0, vy: 1 + Math.random(), vz: 0, life: 0.8, size: 0.05, color: '#ffd24a', grav: -1, drag: 1, glow: true,
      });
    }
  }

  update(dt: number): void {
    let n = 0;
    let gn = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d - p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = 1 - p.life / p.max;
      const size = p.size * (p.glow ? k : Math.min(1, k * 2.5));
      this.e.set(p.life * p.spin, p.life * p.spin * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.v.set(p.x, p.y, p.z);
      this.s.setScalar(size);
      this.m.compose(this.v, this.q, this.s);
      if (p.glow) {
        this.glowMesh.setMatrixAt(gn, this.m);
        this.c.setRGB(p.r * 2.2 * k, p.g * 2.2 * k, p.b * 2.2 * k);
        this.glowMesh.setColorAt(gn, this.c);
        gn++;
      } else {
        this.mesh.setMatrixAt(n, this.m);
        this.c.setRGB(p.r, p.g, p.b);
        this.mesh.setColorAt(n, this.c);
        n++;
      }
    }
    this.mesh.count = n;
    this.glowMesh.count = gn;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glowMesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.glowMesh.instanceColor) this.glowMesh.instanceColor.needsUpdate = true;
  }
}
