import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../config/settings';
import { Sky, SUN_DIR, SUN_COLOR, FOG_COLOR, createMountains } from './Sky';
import { Water } from './Water';
import { WorldRenderer } from './WorldMesher';
import { DecorRenderer } from './Decor';
import type { ArenaData } from '../maps/Arena';
import { Particles } from '../effects/Particles';
import { ViewModel } from '../weapons/ViewModel';
import { MotionBlurPass } from './MotionBlurPass';
import { WORLD_TIME } from './WorldMesher';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDamage: { value: 0 },
    uLowHealth: { value: 0 },
    uVignette: { value: 0.28 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uDamage; uniform float uLowHealth; uniform float uVignette; uniform float uTime;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float r = length(p * vec2(1.0, 0.8));
      float vig = smoothstep(0.35, 0.85, r);
      c.rgb *= 1.0 - vig * uVignette;
      // gentle contrast / saturation lift
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.08 - uLowHealth * 0.45);
      // damage flash from the edges, pulsing heartbeat at low health
      float pulse = uLowHealth * (0.55 + 0.45 * sin(uTime * 6.0));
      float edge = smoothstep(0.25, 0.8, r);
      c.rgb = mix(c.rgb, vec3(0.75, 0.04, 0.02) * (0.4 + l), edge * clamp(uDamage * 0.85 + pulse * 0.35, 0.0, 0.9));
      gl_FragColor = c;
    }`,
};

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sky: Sky;
  readonly water: Water;
  readonly world: WorldRenderer;
  readonly decor: DecorRenderer;
  readonly particles: Particles;
  readonly viewModel: ViewModel;
  readonly sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private grade!: ShaderPass;
  private blur!: MotionBlurPass;
  motionBlur = 0.3;
  private vmPass!: RenderPass;
  private quality: Quality = 'high';
  showViewModel = true;
  /** Objects hidden from the water reflection (view model is separate already). */
  reflectionHide: THREE.Object3D[] = [];
  damage = 0;
  lowHealth = 0;

  constructor(canvas: HTMLCanvasElement, arena: ArenaData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.scene.add(this.camera);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), 0.0052);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.scene.add(createMountains());

    // Lighting: warm low sun + cool sky fill + IBL from the sky itself.
    this.hemi = new THREE.HemisphereLight('#bcd6ff', '#7a6450', 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(SUN_COLOR, 3.1);
    this.sun.position.copy(SUN_DIR).multiplyScalar(80).add(new THREE.Vector3(0, 0, 6));
    this.sun.target.position.set(0, 0, 6);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -48;
    sc.right = 48;
    sc.top = 48;
    sc.bottom = -48;
    sc.near = 10;
    sc.far = 200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.world = new WorldRenderer(arena.world);
    this.scene.add(this.world.group);
    this.decor = new DecorRenderer(arena.world, arena.decor);
    this.scene.add(this.decor.group);
    this.water = new Water(arena.world.waterLevel);
    this.scene.add(this.water.mesh);
    this.particles = new Particles();
    this.scene.add(this.particles.mesh, this.particles.glowMesh);

    this.viewModel = new ViewModel(window.innerWidth / window.innerHeight);

    // Environment map from the sky for metals & ambient.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envScene.add(envSky.mesh);
    const env = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.45;
    this.viewModel.setEnvironment(env);
    pmrem.dispose();

    this.buildComposer();
    this.resize();
  }

  private buildComposer(): void {
    const q = this.quality;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: q === 'high' ? 4 : q === 'medium' ? 2 : 0,
    });
    this.composer?.dispose();
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.vmPass = new RenderPass(this.viewModel.scene, this.viewModel.camera);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    this.composer.addPass(this.vmPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.45, 0.92);
    this.bloom.enabled = q !== 'low';
    this.composer.addPass(this.bloom);
    this.blur = new MotionBlurPass(size.x, size.y);
    this.composer.addPass(this.blur);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const pr = q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 1) * 0.8;
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const ms = q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.water.setQuality(q);
    this.decor.buildGrass(q === 'high' ? 0.7 : q === 'medium' ? 0.35 : 0);
    this.decor.buildMotes(q === 'low' ? 0 : q === 'medium' ? 120 : 260);
    this.decor.setPixelRatio(pr);
    for (const l of this.decor.lights) l.visible = q !== 'low';
    // Material programs depend on shadow state
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'needsUpdate' in m) m.needsUpdate = true;
    });
    this.resize();
    this.buildComposer();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModel.setAspect(w / h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom?.resolution.set(size.x / 2, size.y / 2);
  }

  render(time: number, dt: number): void {
    this.sky.update(time, this.camera);
    this.water.update(time);
    this.decor.update(time);
    this.particles.update(dt);
    this.water.updateReflection(this.renderer, this.scene, this.camera, this.reflectionHide);
    this.vmPass.enabled = this.showViewModel;
    WORLD_TIME.value = time;
    this.blur.enabled = this.motionBlur > 0.01;
    this.blur.amount = this.motionBlur;
    this.blur.dt = dt;
    this.grade.uniforms.uDamage.value = this.damage;
    this.grade.uniforms.uLowHealth.value = this.lowHealth;
    this.grade.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
