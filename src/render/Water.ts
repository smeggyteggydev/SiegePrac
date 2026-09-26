import * as THREE from 'three';
import { SKY_GLSL, SUN_DIR, ZENITH_COLOR, HORIZON_COLOR, SUN_COLOR, FOG_COLOR } from './Sky';

/**
 * Stylised lake with optional planar reflection (the arena mirrored in the water).
 * Reflection renders at reduced resolution and can be disabled for low settings.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private rt: THREE.WebGLRenderTarget | null = null;
  private mirrorCam = new THREE.PerspectiveCamera();
  private textureMatrix = new THREE.Matrix4();
  private plane = new THREE.Plane();
  private reflectScale = 0.5;
  enabled = true;
  private frame = 0;

  constructor(readonly level: number) {
    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR.clone() },
      uZenith: { value: ZENITH_COLOR.clone() },
      uHorizon: { value: HORIZON_COLOR.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
      uFogColor: { value: FOG_COLOR.clone() },
      uReflection: { value: null },
      uHasReflection: { value: 0 },
      uTexMatrix: { value: this.textureMatrix },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform mat4 uTexMatrix;
        varying vec3 vWorld;
        varying vec4 vReflUv;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vReflUv = uTexMatrix * w;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uFogColor;
        uniform sampler2D uReflection;
        uniform float uHasReflection;
        varying vec3 vWorld;
        varying vec4 vReflUv;
        ${SKY_GLSL}
        vec2 wave(vec2 p, float t) {
          vec2 d = vec2(0.0);
          d += vec2(cos(p.x * 0.9 + t * 1.1), sin(p.y * 0.8 - t * 0.9)) * 0.5;
          d += vec2(sin(p.y * 2.3 + p.x * 0.7 + t * 1.7), cos(p.x * 2.1 - t * 1.3)) * 0.25;
          d += vec2(cos(p.x * 5.1 + p.y * 3.1 - t * 2.6), sin(p.y * 4.7 + t * 2.2)) * 0.12;
          return d;
        }
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          float dist = length(cameraPosition - vWorld);
          vec2 d = wave(vWorld.xz * 0.6, uTime);
          float strength = 0.07 * (1.0 - smoothstep(20.0, 160.0, dist)) + 0.015;
          vec3 N = normalize(vec3(d.x * strength, 1.0, d.y * strength));
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          vec3 refl = skyColor(normalize(vec3(R.x, abs(R.y), R.z)));
          if (uHasReflection > 0.5) {
            vec2 uv = vReflUv.xy / vReflUv.w + N.xz * 0.035;
            vec3 planar = texture2D(uReflection, uv).rgb;
            refl = planar;
          }
          vec3 deep = vec3(0.05, 0.22, 0.28);
          vec3 shallow = vec3(0.16, 0.42, 0.44);
          vec3 base = mix(shallow, deep, clamp(1.0 - V.y, 0.0, 1.0));
          vec3 col = mix(base, refl, clamp(fres * 1.15 + 0.12, 0.0, 1.0));
          // sun glint
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 380.0) * 3.5;
          col += uSunColor * spec;
          float alpha = clamp(0.78 + fres * 0.4, 0.0, 1.0);
          // fog
          float f = 1.0 - exp(-pow(dist * 0.0055, 2.0));
          col = mix(col, uFogColor, f);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = level;
    this.mesh.renderOrder = 1;
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.enabled = q !== 'low';
    this.reflectScale = q === 'high' ? 0.5 : 0.33;
    this.rt?.dispose();
    this.rt = null;
    this.uniforms.uHasReflection.value = 0;
  }

  /** Render the planar reflection. Call before the main render. */
  updateReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]): void {
    this.uniforms.uHasReflection.value = 0;
    if (!this.enabled) return;
    if (camera.position.y < this.level) return;
    // Update at half the frame rate on medium to save fill.
    this.frame++;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(64, Math.floor(size.x * this.reflectScale));
    const h = Math.max(64, Math.floor(size.y * this.reflectScale));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
    }

    const mc = this.mirrorCam;
    mc.copy(camera);
    const L = this.level;
    mc.position.set(camera.position.x, 2 * L - camera.position.y, camera.position.z);
    const target = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
    target.y = 2 * L - target.y;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    up.y = -up.y;
    mc.up.copy(up);
    mc.lookAt(target);
    mc.far = camera.far;
    mc.updateMatrixWorld();
    mc.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(mc.projectionMatrix);
    this.textureMatrix.multiply(mc.matrixWorldInverse);

    // Oblique near plane so nothing below the water leaks into the reflection.
    this.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, L, 0));
    this.plane.applyMatrix4(mc.matrixWorldInverse);
    const cp = new THREE.Vector4(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const proj = mc.projectionMatrix;
    const q = new THREE.Vector4(
      (Math.sign(cp.x) + proj.elements[8]) / proj.elements[0],
      (Math.sign(cp.y) + proj.elements[9]) / proj.elements[5],
      -1.0,
      (1.0 + proj.elements[10]) / proj.elements[14],
    );
    cp.multiplyScalar(2.0 / cp.dot(q));
    proj.elements[2] = cp.x;
    proj.elements[6] = cp.y;
    proj.elements[10] = cp.z + 1.0 - 0.003;
    proj.elements[14] = cp.w;

    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    this.mesh.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, mc);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    this.mesh.visible = true;
    hide.forEach((o, i) => (o.visible = vis[i]));
    this.uniforms.uReflection.value = this.rt.texture;
    this.uniforms.uHasReflection.value = 1;
  }

  update(t: number): void {
    this.uniforms.uTime.value = t;
  }
}
