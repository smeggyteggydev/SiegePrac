import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Accumulation motion blur: blends each frame with the previous result.
 * Frame-rate independent (same look at 60 or 240 FPS) and cheap — the
 * "smooth PvP clip" look without smearing enough to hurt readability.
 */
export class MotionBlurPass extends Pass {
  amount = 0.3;
  dt = 1 / 60;
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private quad: FullScreenQuad;
  private copy: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  private fresh = true;

  constructor(width: number, height: number) {
    super();
    const opts = { type: THREE.HalfFloatType };
    this.a = new THREE.WebGLRenderTarget(width, height, opts);
    this.b = new THREE.WebGLRenderTarget(width, height, opts);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tNew: { value: null }, tOld: { value: null }, uK: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tNew; uniform sampler2D tOld; uniform float uK; varying vec2 vUv;
        void main(){ vec4 n = texture2D(tNew, vUv); vec4 o = texture2D(tOld, vUv); gl_FragColor = mix(n, o, uK); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
    this.copy = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { t: { value: null } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }',
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  reset(): void {
    this.fresh = true;
  }

  setSize(width: number, height: number): void {
    this.a.setSize(width, height);
    this.b.setSize(width, height);
    this.fresh = true;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    // amount 1 ≈ 0.72 blend per 60 Hz frame; scaled for the real frame time.
    const base = Math.min(0.9, this.amount * 0.72);
    const k = this.fresh ? 0 : Math.pow(base, this.dt * 60);
    this.fresh = false;
    this.mat.uniforms.tNew.value = readBuffer.texture;
    this.mat.uniforms.tOld.value = this.a.texture;
    this.mat.uniforms.uK.value = k;
    renderer.setRenderTarget(this.b);
    this.quad.render(renderer);
    (this.copy.material as THREE.ShaderMaterial).uniforms.t.value = this.b.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copy.render(renderer);
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.quad.dispose();
    this.copy.dispose();
  }
}
