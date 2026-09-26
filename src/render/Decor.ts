import * as THREE from 'three';
import type { Decor } from '../maps/Arena';
import { Block, VoxelWorld } from '../game/World';
import { hash2 } from '../utils/noise';

const BANNER_COLORS = {
  red: ['#b8322c', '#e0a040'],
  blue: ['#2a5fa8', '#e8e0cc'],
  gold: ['#1d2230', '#d9a441'],
} as const;

/** Siege crest painted on banners and flags. */
function bannerTexture(color: 'red' | 'blue' | 'gold'): THREE.CanvasTexture {
  const [bg, fg] = BANNER_COLORS[color];
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 64, 160);
  // subtle weave
  for (let y = 0; y < 160; y += 2) {
    g.fillStyle = `rgba(0,0,0,${0.04 + hash2(y, 1) * 0.05})`;
    g.fillRect(0, y, 64, 1);
  }
  g.fillStyle = fg;
  g.fillRect(0, 6, 64, 4);
  g.fillRect(6, 0, 3, 160);
  g.fillRect(55, 0, 3, 160);
  // crest: a stylised tower/shield with crossed blades
  g.save();
  g.translate(32, 62);
  g.fillStyle = fg;
  g.beginPath();
  g.moveTo(-16, -18);
  g.lineTo(16, -18);
  g.lineTo(16, 4);
  g.lineTo(0, 20);
  g.lineTo(-16, 4);
  g.closePath();
  g.fill();
  g.fillStyle = bg;
  g.fillRect(-10, -12, 4, 6);
  g.fillRect(-2, -12, 4, 6);
  g.fillRect(6, -12, 4, 6);
  g.fillRect(-9, -4, 18, 10);
  g.fillStyle = fg;
  g.fillRect(-3, -2, 6, 8);
  g.restore();
  // swallow-tail bottom
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.moveTo(0, 160);
  g.lineTo(32, 138);
  g.lineTo(64, 160);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const clothVertex = /* glsl */ `
uniform float uTime;
uniform float uPhase;
uniform float uAmp;
`;

function clothMaterial(tex: THREE.Texture, phase: number, amp: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    side: THREE.DoubleSide,
    roughness: 0.9,
    alphaTest: 0.5,
  });
  const uniforms = { uTime: { value: 0 }, uPhase: { value: phase }, uAmp: { value: amp } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + clothVertex)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hang = clamp(-position.y, 0.0, 10.0);
        float w = sin(uTime * 2.1 + uPhase + hang * 1.7) * 0.5 + sin(uTime * 3.3 + uPhase * 1.3 + hang * 2.9 + position.x * 3.0) * 0.25;
        transformed.z += w * uAmp * hang * 0.35;
        transformed.x += sin(uTime * 1.3 + uPhase + hang) * uAmp * hang * 0.05;`,
      );
  };
  mat.customProgramCacheKey = () => 'cloth';
  return mat;
}

export class DecorRenderer {
  readonly group = new THREE.Group();
  private clothMats: THREE.MeshStandardMaterial[] = [];
  private grass: THREE.InstancedMesh | null = null;
  private grassMat: THREE.MeshStandardMaterial | null = null;
  private motes: THREE.Points | null = null;
  readonly lights: THREE.PointLight[] = [];
  private halos: THREE.Sprite[] = [];

  constructor(private world: VoxelWorld, decor: Decor[]) {
    const texCache = new Map<string, THREE.Texture>();
    const tex = (c: 'red' | 'blue' | 'gold') => {
      if (!texCache.has(c)) texCache.set(c, bannerTexture(c));
      return texCache.get(c)!;
    };
    const haloTex = makeHaloTexture();
    let phase = 0;
    for (const d of decor) {
      phase += 1.7;
      if (d.type === 'banner') {
        const geo = new THREE.PlaneGeometry(1.1, d.length, 4, 12);
        geo.translate(0, -d.length / 2, 0);
        const mat = clothMaterial(tex(d.color), phase, 0.35);
        this.clothMats.push(mat);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(d.x, d.y, d.z);
        m.rotation.y = d.yaw;
        m.castShadow = true;
        this.group.add(m);
        // rod
        const rod = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: '#c0924a', metalness: 0.7, roughness: 0.4 }));
        rod.position.set(d.x, d.y + 0.04, d.z);
        rod.rotation.y = d.yaw;
        this.group.add(rod);
      } else if (d.type === 'flag') {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.07, 5, 8),
          new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 0.8 }),
        );
        pole.position.set(d.x, d.y + 2.5, d.z);
        pole.castShadow = true;
        this.group.add(pole);
        // Built like a banner hanging "down" its length, then turned so it streams off the pole.
        const geo = new THREE.PlaneGeometry(1.1, 1.8, 4, 12);
        geo.translate(0, -0.9, 0);
        const mat = clothMaterial(tex(d.color), phase, 0.6);
        this.clothMats.push(mat);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(d.x, d.y + 4.4, d.z);
        m.rotation.z = Math.PI / 2;
        m.castShadow = true;
        this.group.add(m);
      } else if (d.type === 'lamp') {
        const halo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: haloTex,
            color: d.color,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0.55,
          }),
        );
        halo.position.set(d.x, d.y, d.z);
        halo.scale.setScalar(2.6 * d.intensity);
        this.halos.push(halo);
        this.group.add(halo);
        if (d.intensity >= 1) {
          const l = new THREE.PointLight(d.color, 6 * d.intensity, 9, 1.6);
          l.position.set(d.x, d.y + 0.2, d.z);
          this.lights.push(l);
          this.group.add(l);
        }
      }
    }
  }

  /** Wind-swept grass on grass blocks (never inside the main plaza to keep it readable). */
  buildGrass(density: number): void {
    if (this.grass) {
      this.group.remove(this.grass);
      this.grass.geometry.dispose();
      this.grass = null;
    }
    if (density <= 0) return;
    const w = this.world;
    const spots: [number, number, number, number][] = [];
    for (let x = w.ox; x < w.ox + w.sx; x++)
      for (let z = w.oz; z < w.oz + w.sz; z++) {
        const top = w.groundHeight(x, z, 20);
        if (!Number.isFinite(top)) continue;
        if (w.get(x, top - 1, z) !== Block.Grass) continue;
        if (w.get(x, top, z) !== Block.Air) continue;
        const per = hash2(x, z, 77) < 0.5 ? 2 : 1;
        for (let i = 0; i < per; i++) {
          if (hash2(x * 3 + i, z, 78) > density) continue;
          spots.push([x + 0.15 + hash2(x, z + i, 79) * 0.7, top, z + 0.15 + hash2(z, x + i, 80) * 0.7, hash2(x + i, z, 81)]);
        }
      }
    // Crossed-quad tuft
    const blade = new THREE.PlaneGeometry(0.55, 0.42, 1, 2);
    blade.translate(0, 0.21, 0);
    const b2 = blade.clone().rotateY(Math.PI / 2);
    const merged = mergeGeos([blade, b2]);
    const mat = new THREE.MeshStandardMaterial({
      color: '#78b24e',
      side: THREE.DoubleSide,
      roughness: 0.95,
      alphaTest: 0.5,
      map: grassTexture(),
    });
    const uniforms = { uTime: { value: 0 } };
    mat.userData.uniforms = uniforms;
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, uniforms);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
        float sway = sin(uTime * 2.0 + wp.x * 0.35 + wp.z * 0.21) * 0.5 + sin(uTime * 3.7 + wp.x * 0.9) * 0.2;
        transformed.x += sway * position.y * 0.35;
        transformed.z += sway * position.y * 0.15;`,
      );
      // Lighten blade tips a touch
    };
    mat.customProgramCacheKey = () => 'grass';
    const inst = new THREE.InstancedMesh(merged, mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    spots.forEach(([x, y, z, r], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * Math.PI);
      const s = 0.7 + r * 0.6;
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.8 + r * 0.5), s));
      inst.setMatrixAt(i, m);
      col.setHSL(0.24 + r * 0.05, 0.45, 0.42 + r * 0.12);
      inst.setColorAt(i, col);
    });
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    this.grass = inst;
    this.grassMat = mat;
    this.group.add(inst);
  }

  /** Dust motes drifting through the sunlight above the arena. */
  buildMotes(count: number): void {
    if (this.motes) {
      this.group.remove(this.motes);
      this.motes.geometry.dispose();
      this.motes = null;
    }
    if (count <= 0) return;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 14;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60 + 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uPixel;
        varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.2 + position.z) * 1.5;
          p.y = mod(position.y + uTime * 0.15 + sin(uTime*0.5 + position.x)*0.3, 14.0);
          p.z += cos(uTime * 0.17 + position.x) * 1.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPixel * 60.0 / -mv.z;
          vA = smoothstep(0.0, 2.0, p.y) * (1.0 - smoothstep(10.0, 14.0, p.y)) * (1.0 - smoothstep(20.0, 45.0, -mv.z));
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - smoothstep(0.1, 0.5, length(c));
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * d * vA * 0.5, 1.0);
        }`,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  setPixelRatio(pr: number): void {
    if (this.motes) (this.motes.material as THREE.ShaderMaterial).uniforms.uPixel.value = pr;
  }

  update(t: number): void {
    for (const m of this.clothMats) m.userData.uniforms.uTime.value = t;
    if (this.grassMat) this.grassMat.userData.uniforms.uTime.value = t;
    if (this.motes) (this.motes.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    for (let i = 0; i < this.halos.length; i++) {
      const h = this.halos[i];
      (h.material as THREE.SpriteMaterial).opacity = 0.5 + Math.sin(t * 3 + i * 1.3) * 0.04;
    }
  }
}

function makeHaloTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function grassTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  for (let i = 0; i < 9; i++) {
    const x = 4 + hash2(i, 0, 3) * 56;
    const h = 30 + hash2(i, 1, 3) * 34;
    const lean = (hash2(i, 2, 3) - 0.5) * 14;
    const grd = g.createLinearGradient(0, 64, 0, 64 - h);
    grd.addColorStop(0, '#3f6b2a');
    grd.addColorStop(1, '#c8e08a');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x - 3, 64);
    g.lineTo(x + lean, 64 - h);
    g.lineTo(x + 3, 64);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) nor.push(n.getX(i), n.getY(i), n.getZ(i));
      if (u) uv.push(u.getX(i), u.getY(i));
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (uv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
