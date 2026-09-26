import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../config/settings';
import { Sky, SUN_DIR, SUN_COLOR, FOG_COLOR, createMountains } from './Sky';
import { Water } from './Water';
import { WorldRenderer, WORLD_TIME } from './WorldMesher';
import { DecorRenderer } from './Decor';
import type { ArenaData } from '../maps/Arena';
import { Particles } from '../effects/Particles';
import { ViewModel } from '../weapons/ViewModel';
import { MotionBlurPass } from './MotionBlurPass';

/**
 * Scene + frame rendering, built for latency and high refresh rates:
 *  - low-latency (desynchronized) WebGL2 context with native MSAA
 *  - direct rendering to the screen; post-processing only when a setting asks for it
 *  - world shadows baked once (the arena is static); fighters use blob shadows
 *  - render resolution capped per quality level
 */
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
  private composer: EffectComposer | null = null;
  private vmPass: RenderPass | null = null;
  private blur: MotionBlurPass | null = null;
  private bloomOn = false;
  private lastBlur = 0;
  motionBlur = 0;
  showViewModel = true;
  /** Objects hidden from the water reflection. */
  reflectionHide: THREE.Object3D[] = [];

  constructor(canvas: HTMLCanvasElement, arena: ArenaData) {
    const attrs: WebGLContextAttributes & { desynchronized?: boolean } = {
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      desynchronized: true,
    };
    const context = canvas.getContext('webgl2', attrs) as WebGL2RenderingContext;
    this.renderer = new THREE.WebGLRenderer({ canvas, context });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The arena never changes: bake the shadow map once instead of every frame.
    this.renderer.shadowMap.autoUpdate = false;

    this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.scene.add(this.camera);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), 0.0032);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.scene.add(createMountains());

    // Clean daylight: strong sky fill so shade stays readable, crisp sun.
    this.scene.add(new THREE.HemisphereLight('#cfe2ff', '#8a7a66', 1.05));
    this.sun = new THREE.DirectionalLight(SUN_COLOR, 2.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(90).add(new THREE.Vector3(0, 0, 6));
    this.sun.target.position.set(0, 0, 6);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -52;
    sc.right = 52;
    sc.top = 52;
    sc.bottom = -52;
    sc.near = 10;
    sc.far = 220;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);

    this.world = new WorldRenderer(arena.world);
    this.scene.add(this.world.group);
    this.decor = new DecorRenderer(arena.world, arena.decor);
    this.scene.add(this.decor.group);
    this.water = new Water(arena.world.waterLevel);
    this.scene.add(this.water.mesh);
    this.particles = new Particles();
    this.scene.add(this.particles.group);

    this.viewModel = new ViewModel(window.innerWidth / window.innerHeight);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new Sky().mesh);
    const env = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.35;
    this.viewModel.setEnvironment(env);
    pmrem.dispose();

    this.resize();
  }

  setQuality(q: Quality): void {
    const dpr = window.devicePixelRatio || 1;
    const pr = q === 'high' ? Math.min(dpr, 1.5) : 1;
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const ms = q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.water.setQuality(q === 'high' ? 'high' : 'low');
    this.decor.buildGrass(q === 'high' ? 0.6 : q === 'medium' ? 0.3 : 0);
    this.decor.buildMotes(0);
    for (const l of this.decor.lights) l.visible = q === 'high';
    this.bloomOn = q === 'high';
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'needsUpdate' in m) m.needsUpdate = true;
    });
    this.resize();
    this.rebuildComposer();
  }

  private rebuildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.vmPass = null;
    this.blur?.dispose();
    this.blur = null;
    if (!this.bloomOn && this.motionBlur <= 0.01) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    const vm = new RenderPass(this.viewModel.scene, this.viewModel.camera);
    vm.clear = false;
    vm.clearDepth = true;
    c.addPass(vm);
    if (this.bloomOn) c.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.14, 0.3, 1.0));
    if (this.motionBlur > 0.01) {
      this.blur = new MotionBlurPass(size.x, size.y);
      c.addPass(this.blur);
    }
    c.addPass(new OutputPass());
    this.composer = c;
    this.vmPass = vm;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModel.setAspect(w / h);
    if (this.composer) this.rebuildComposer();
  }

  render(time: number, dt: number): void {
    if (this.motionBlur > 0.01 !== this.lastBlur > 0.01) this.rebuildComposer();
    this.lastBlur = this.motionBlur;
    this.sky.update(time, this.camera);
    this.water.update(time);
    this.decor.update(time);
    this.particles.update(dt, this.camera);
    WORLD_TIME.value = time;
    this.water.updateReflection(this.renderer, this.scene, this.camera, this.reflectionHide);

    if (this.composer) {
      if (this.vmPass) this.vmPass.enabled = this.showViewModel;
      if (this.blur) {
        this.blur.amount = this.motionBlur;
        this.blur.dt = dt;
      }
      this.composer.render(dt);
      return;
    }
    const r = this.renderer;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
    if (this.showViewModel) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.viewModel.scene, this.viewModel.camera);
      r.autoClear = true;
    }
  }
}
