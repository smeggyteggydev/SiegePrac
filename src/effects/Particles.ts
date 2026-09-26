import * as THREE from 'three';

/**
 * Classic square pixel-sprite particles (one Points draw call, pooled, no
 * per-frame allocation). Types mirror what PvP players read instantly:
 * enchant sparkles on hits, star crits, death smoke, block dust, potion swirls.
 */

type Kind = 0 | 1 | 2 | 3 | 4; // 0 star-crit, 1 magic sparkle, 2 smoke, 3 square (dust/debris), 4 swirl

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
  kind: Kind;
  shrink: boolean;
}

const ATLAS_TILES = 5;

/** 8×8 pixel sprites packed horizontally. */
function makeAtlas(): THREE.DataTexture {
  const W = 8 * ATLAS_TILES;
  const H = 8;
  const data = new Uint8Array(W * H * 4);
  const put = (tile: number, x: number, y: number, a: number) => {
    const o = ((7 - y) * W + tile * 8 + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = 255;
    data[o + 3] = a;
  };
  // 0: star crit (plus with bright centre)
  for (let i = 1; i < 7; i++) {
    put(0, i, 3, 255);
    put(0, i, 4, 255);
    put(0, 3, i, 255);
    put(0, 4, i, 255);
  }
  put(0, 0, 3, 140);
  put(0, 7, 4, 140);
  put(0, 3, 0, 140);
  put(0, 4, 7, 140);
  // 1: magic sparkle (diamond-ish X)
  for (let i = 0; i < 8; i++) {
    const d = Math.abs(i - 3.5);
    if (d < 3.6) {
      put(1, i, i, d < 2 ? 255 : 170);
      put(1, 7 - i, i, d < 2 ? 255 : 170);
    }
  }
  put(1, 3, 3, 255);
  put(1, 4, 4, 255);
  // 2: smoke puff (soft round blob)
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const d = Math.hypot(x - 3.5, y - 3.5);
      if (d < 3.7) put(2, x, y, d < 2.5 ? 235 : 150);
    }
  // 3: solid square with a darker rim
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) put(3, x, y, 255);
  // 4: swirl (potion)
  const sw = ['..####..', '.#....#.', '#..##..#', '#.#..#.#', '#.#...#.', '#..#....', '.#..###.', '..#.....'];
  sw.forEach((row, y) => [...row].forEach((c, x) => c === '#' && put(4, x, 7 - y, 255)));
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export class Particles {
  readonly group = new THREE.Group();
  private points: THREE.Points;
  private pool: P[] = [];
  private cursor = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private tile: Float32Array;
  private uniforms: { uAtlas: { value: THREE.Texture }; uScale: { value: number } };
  scale = 1;

  constructor(readonly capacity = 1600) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.tile = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tile', new THREE.BufferAttribute(this.tile, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.uniforms = { uAtlas: { value: makeAtlas() }, uScale: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 color; attribute float psize; attribute float tile;
        uniform float uScale;
        varying vec4 vColor; varying float vTile;
        void main(){
          vColor = color; vTile = tile;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, psize * uScale / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec4 vColor; varying float vTile;
        void main(){
          vec2 uv = vec2((vTile + gl_PointCoord.x) / ${ATLAS_TILES}.0, 1.0 - gl_PointCoord.y);
          vec4 t = texture2D(uAtlas, uv);
          if (t.a < 0.3) discard;
          gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.group.add(this.points);
    for (let i = 0; i < capacity; i++)
      this.pool.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, grav: 0, drag: 0, r: 1, g: 1, b: 1, kind: 0, shrink: false });
  }

  private c = new THREE.Color();

  private spawn(o: {
    x: number; y: number; z: number; vx: number; vy: number; vz: number;
    life: number; size: number; color: THREE.ColorRepresentation; kind: Kind; grav?: number; drag?: number; shrink?: boolean;
  }): void {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    p.alive = true;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx; p.vy = o.vy; p.vz = o.vz;
    p.life = 0;
    p.max = o.life;
    p.size = o.size;
    p.kind = o.kind;
    p.grav = o.grav ?? 0;
    p.drag = o.drag ?? 3;
    p.shrink = o.shrink ?? true;
    this.c.set(o.color);
    p.r = this.c.r; p.g = this.c.g; p.b = this.c.b;
  }

  private n(count: number): number {
    return Math.max(1, Math.round(count * this.scale));
  }

  /** Every hit: enchanted-blade sparkles bursting off the victim's body. */
  hitBurst(point: THREE.Vector3, dir: THREE.Vector3, crit: boolean, blocked: boolean): void {
    const n = this.n(blocked ? 6 : 12);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 2 - 0.4;
      const sp = 2.5 + Math.random() * 3.5;
      this.spawn({
        x: point.x + (Math.random() - 0.5) * 0.5,
        y: point.y + (Math.random() - 0.5) * 0.6,
        z: point.z + (Math.random() - 0.5) * 0.5,
        vx: Math.cos(a) * sp + dir.x * 2,
        vy: up * sp * 0.6 + 1.2,
        vz: Math.sin(a) * sp + dir.z * 2,
        life: 0.35 + Math.random() * 0.35,
        size: 0.09 + Math.random() * 0.05,
        color: blocked ? '#c9d6e6' : Math.random() < 0.5 ? '#7fd6ff' : '#b8a4ff',
        kind: 1,
        drag: 4.5,
        grav: 2,
      });
    }
    if (crit) this.crits(point, dir);
  }

  private crits(point: THREE.Vector3, dir: THREE.Vector3): void {
    const n = this.n(18);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 4;
      this.spawn({
        x: point.x, y: point.y + (Math.random() - 0.5) * 0.8, z: point.z,
        vx: Math.cos(a) * sp + dir.x * 3, vy: 1.5 + Math.random() * 3, vz: Math.sin(a) * sp + dir.z * 3,
        life: 0.4 + Math.random() * 0.3, size: 0.1 + Math.random() * 0.05,
        color: Math.random() < 0.6 ? '#fff6c8' : '#ffd24a', kind: 0, drag: 4, grav: 9,
      });
    }
  }

  critRing(_center: THREE.Vector3): void {}

  dust(x: number, y: number, z: number, count: number, color = '#b9b2a4'): void {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 1.6;
      this.spawn({
        x: x + Math.cos(a) * 0.25, y: y + 0.05, z: z + Math.sin(a) * 0.25,
        vx: Math.cos(a) * sp, vy: 0.8 + Math.random() * 1.2, vz: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.25, size: 0.06 + Math.random() * 0.04, color, kind: 3, grav: 14, drag: 2,
      });
    }
  }

  /** Death: the classic white smoke poof. */
  deathBurst(pos: THREE.Vector3, _team: 'red' | 'blue'): void {
    const n = this.n(26);
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.8, y: pos.y + Math.random() * 1.8, z: pos.z + (Math.random() - 0.5) * 0.8,
        vx: (Math.random() - 0.5) * 1.2, vy: 0.3 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.2,
        life: 0.6 + Math.random() * 0.6, size: 0.25 + Math.random() * 0.25,
        color: Math.random() < 0.5 ? '#ffffff' : '#c9c9c9', kind: 2, drag: 1.5, grav: -0.5,
      });
    }
  }

  gappleSparkle(pos: THREE.Vector3): void {
    for (let i = 0; i < this.n(12); i++)
      this.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.8, y: pos.y + Math.random() * 1.8, z: pos.z + (Math.random() - 0.5) * 0.8,
        vx: 0, vy: 0.8 + Math.random(), vz: 0, life: 0.8, size: 0.08, color: '#ffd24a', kind: 1, drag: 1,
      });
  }

  /** Splash potion shatter: coloured swirls in a ring. */
  splash(pos: THREE.Vector3, color: string): void {
    const n = this.n(28);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3.5;
      this.spawn({
        x: pos.x, y: pos.y + 0.2 + Math.random() * 0.4, z: pos.z,
        vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 2.5, vz: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.5, size: 0.065 + Math.random() * 0.035, color, kind: 4, drag: 2.2, grav: 3,
      });
    }
    for (let i = 0; i < this.n(10); i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({
        x: pos.x, y: pos.y + 0.2, z: pos.z,
        vx: Math.cos(a) * 3, vy: 2 + Math.random() * 2, vz: Math.sin(a) * 3,
        life: 0.5, size: 0.05, color: '#e8f4ff', kind: 3, grav: 16, drag: 1,
      });
    }
  }

  /** Swirls rising off a fighter under an effect (speed, healing). */
  effectSwirl(pos: THREE.Vector3, color: string): void {
    this.spawn({
      x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y + 0.2 + Math.random() * 1.6, z: pos.z + (Math.random() - 0.5) * 0.6,
      vx: 0, vy: 0.4, vz: 0, life: 0.7, size: 0.09, color, kind: 4, drag: 1, shrink: false,
    });
  }

  /** Ender pearl trail / teleport. */
  portal(pos: THREE.Vector3, count: number): void {
    for (let i = 0; i < this.n(count); i++)
      this.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y + Math.random() * 1.8, z: pos.z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2,
        life: 0.5 + Math.random() * 0.4, size: 0.07, color: Math.random() < 0.5 ? '#c35cff' : '#7a2fd0', kind: 3, drag: 2,
      });
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    // world-size → pixels
    this.uniforms.uScale.value = (window.innerHeight * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    let n = 0;
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
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      // classic particles darken slightly and shrink as they age
      const shade = 0.75 + 0.25 * k;
      this.col[n * 4] = p.r * shade;
      this.col[n * 4 + 1] = p.g * shade;
      this.col[n * 4 + 2] = p.b * shade;
      this.col[n * 4 + 3] = p.kind === 2 ? Math.min(1, k * 1.6) : 1;
      this.size[n] = p.size * (p.shrink ? 0.35 + 0.65 * k : 1);
      this.tile[n] = p.kind;
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const name of ['position', 'color', 'psize', 'tile']) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}
