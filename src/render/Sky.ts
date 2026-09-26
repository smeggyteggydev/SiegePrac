import * as THREE from 'three';
import { fbm2 } from '../utils/noise';

/** Clear midday sun, off to the side of the main fighting axis so nobody fights into glare. */
export const SUN_DIR = new THREE.Vector3(-0.55, 0.78, 0.3).normalize();
export const SUN_COLOR = new THREE.Color('#fff4e6');
export const HORIZON_COLOR = new THREE.Color('#b9d4ee');
export const ZENITH_COLOR = new THREE.Color('#3f7fd6');
export const FOG_COLOR = new THREE.Color('#bcd2e8');

/** GLSL shared by the sky dome and the water reflection fallback. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
vec3 skyColor(vec3 dir) {
  float h = clamp(dir.y, -1.0, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  // below horizon: dim warm haze
  col = mix(col, uHorizon * 0.85, clamp(-h * 3.0, 0.0, 1.0));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 12.0) * 0.06 + smoothstep(0.9993, 0.9996, sd) * 1.2);
  return col;
}
`;

function hash(): string {
  return /* glsl */ `
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hsh(i), hsh(i+vec2(1,0)), u.x), mix(hsh(i+vec2(0,1)), hsh(i+vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){ float s=0.0; float a=0.5; for(int i=0;i<5;i++){ s+=vnoise(p)*a; p*=2.03; a*=0.5; } return s; }
  `;
}

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor() {
    this.uniforms = {
      uSunDir: { value: SUN_DIR.clone() },
      uZenith: { value: ZENITH_COLOR.clone() },
      uHorizon: { value: HORIZON_COLOR.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime;
        ${SKY_GLSL}
        ${hash()}
        void main() {
          vec3 dir = normalize(vDir);
          vec3 col = skyColor(dir);
          // Soft stylised clouds on a virtual plane
          if (dir.y > 0.02) {
            vec2 uv = dir.xz / (dir.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
            float n = fbm(uv);
            float c = smoothstep(0.52, 0.78, n);
            float edge = smoothstep(0.52, 0.62, n) - smoothstep(0.62, 0.8, n);
            float sd = max(dot(dir, uSunDir), 0.0);
            vec3 cloudCol = mix(vec3(1.0), vec3(0.82, 0.86, 0.92), smoothstep(0.6, 0.9, n));
            cloudCol += vec3(0.05) * edge;
            float fade = smoothstep(0.02, 0.25, dir.y);
            col = mix(col, cloudCol, c * 0.85 * fade);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(t: number, camera: THREE.Camera): void {
    this.uniforms.uTime.value = t;
    this.mesh.position.copy(camera.position);
  }
}

/** Distant layered mountain ring, faded by fog: gives the arena a place in the world. */
export function createMountains(): THREE.Group {
  const g = new THREE.Group();
  const layers = [
    { r: 190, h: 34, color: '#8c9aa8', seed: 1 },
    { r: 260, h: 60, color: '#9aa8b8', seed: 2 },
    { r: 360, h: 95, color: '#aab4c2', seed: 3 },
  ];
  for (const L of layers) {
    const seg = 160;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = fbm2(Math.cos(a) * 3 + L.seed * 10, Math.sin(a) * 3, 4, L.seed);
      const peak = Math.max(0, n - 0.25) * 1.9;
      const h = L.h * (0.25 + peak) ;
      const x = Math.cos(a) * L.r;
      const z = Math.sin(a) * L.r;
      pos.push(x, -12, z, x * 0.985, h, z * 0.985);
      if (i < seg) {
        const b = i * 2;
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: L.color, side: THREE.DoubleSide, flatShading: true });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    g.add(m);
  }
  return g;
}
