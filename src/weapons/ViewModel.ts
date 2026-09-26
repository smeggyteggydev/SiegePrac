import * as THREE from 'three';
import type { Fighter } from '../entities/Fighter';
import type { ItemId } from './Items';
import { buildItem } from './WeaponMeshes';
import { damp, clamp } from '../utils/math';
import { SUN_DIR } from '../render/Sky';

const TRAIL_N = 14;

/**
 * First-person weapon, rendered in its own scene after the world with a
 * cleared depth buffer so it never clips into walls or opponents.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group(); // bob / sway / recoil
  private holder = new THREE.Group(); // per-item rest pose + swing
  private arm: THREE.Group;
  private item: THREE.Group | null = null;
  private itemId: ItemId | null | undefined = undefined;
  private sun: THREE.DirectionalLight;
  private swingT = 1;
  private swingDur = 0.24;
  private equipT = 1;
  private bobPhase = 0;
  private bobAmt = 0;
  private sway = new THREE.Vector2();
  private swayVel = new THREE.Vector2();
  private landDip = 0;
  private landVel = 0;
  private blockK = 0;
  private eatK = 0;
  private sprintK = 0;
  private hitKick = 0;
  private swingSide = 1;

  // Trail
  private trail: THREE.Mesh;
  private trailPos: Float32Array;
  private trailAlpha: Float32Array;
  private trailPts: { a: THREE.Vector3; b: THREE.Vector3; t: number }[] = [];

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(68, aspect, 0.01, 10);
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    this.rig.add(this.holder);

    const hemi = new THREE.HemisphereLight('#cfe2ff', '#6b5a45', 1.1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#ffe0b5', 2.4);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Gauntleted forearm holding the grip
    this.arm = new THREE.Group();
    const sleeve = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.11, 0.42),
      new THREE.MeshStandardMaterial({ color: '#2f6fd1', roughness: 0.85 }),
    );
    sleeve.position.set(0.0, -0.02, 0.24);
    const gauntlet = new THREE.Mesh(
      new THREE.BoxGeometry(0.125, 0.125, 0.16),
      new THREE.MeshStandardMaterial({ color: '#9aa3ae', metalness: 0.7, roughness: 0.35 }),
    );
    gauntlet.position.set(0, -0.02, 0.07);
    const cuff = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.13, 0.03),
      new THREE.MeshStandardMaterial({ color: '#9fd0ff', metalness: 0.7, roughness: 0.3 }),
    );
    cuff.position.set(0, -0.02, 0.15);
    const fist = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.09, 0.1),
      new THREE.MeshStandardMaterial({ color: '#2c2f36', roughness: 0.8 }),
    );
    fist.position.set(0, 0, -0.01);
    this.arm.add(sleeve, gauntlet, cuff, fist);
    this.holder.add(this.arm);

    // Trail ribbon
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailAlpha = new Float32Array(TRAIL_N * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.trailAlpha, 1));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.trail = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color('#9fe6ff') } },
        vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }`,
      }),
    );
    this.trail.frustumCulled = false;
    this.camera.add(this.trail);
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  setEnvironment(env: THREE.Texture | null): void {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.8;
  }

  private setItem(id: ItemId | null): void {
    if (id === this.itemId) return;
    this.itemId = id;
    if (this.item) this.holder.remove(this.item);
    this.item = buildItem(id);
    this.item.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = false;
    });
    this.holder.add(this.item);
    this.equipT = 0;
    const color = id === 'axe' ? '#ffc07a' : '#9fe6ff';
    ((this.trail.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).set(color);
  }

  /** Called when the local fighter swings. */
  swing(): void {
    // Restart only once the previous swing is well underway so spam-clicking
    // still reads as distinct swings rather than a jittery twitch.
    if (this.swingT < 0.45) return;
    this.swingT = 0;
    this.swingSide = -this.swingSide;
    this.trailPts.length = 0;
  }

  hit(crit: boolean): void {
    this.hitKick = crit ? 1 : 0.6;
  }

  land(speed: number): void {
    this.landVel -= clamp(speed / 14, 0, 1) * 0.6;
  }

  /** Mouse delta in radians this frame — drives weapon sway. */
  look(dYaw: number, dPitch: number): void {
    this.swayVel.x += dYaw * 1.6;
    this.swayVel.y += dPitch * 1.6;
  }

  update(f: Fighter, dt: number, cameraWorldQuat: THREE.Quaternion): void {
    this.setItem(f.heldItem()?.id ?? null);

    // Sun direction in view space so lighting on the blade changes as you turn.
    const inv = cameraWorldQuat.clone().invert();
    const sd = SUN_DIR.clone().applyQuaternion(inv);
    this.sun.position.copy(sd).multiplyScalar(5);
    this.sun.target.position.set(0, 0, 0);

    const speed = f.onGround ? f.horizontalSpeed() : 0;
    this.bobPhase += speed * dt * 2.1;
    this.bobAmt += (clamp(speed / 5.6, 0, 1.2) - this.bobAmt) * damp(10, dt);
    this.sprintK += ((f.sprinting ? 1 : 0) - this.sprintK) * damp(10, dt);
    this.blockK += ((f.blocking ? 1 : 0) - this.blockK) * damp(22, dt);
    this.eatK += ((f.eating > 0 ? 1 : 0) - this.eatK) * damp(14, dt);
    this.equipT = Math.min(1, this.equipT + dt / 0.16);
    this.swingT = Math.min(1, this.swingT + dt / this.swingDur);
    this.hitKick *= 1 - damp(14, dt);

    // Sway: critically damped spring toward zero
    this.swayVel.multiplyScalar(1 - damp(18, dt));
    this.sway.addScaledVector(this.swayVel, dt * 10);
    this.sway.multiplyScalar(1 - damp(12, dt));
    this.sway.x = clamp(this.sway.x, -0.06, 0.06);
    this.sway.y = clamp(this.sway.y, -0.05, 0.05);

    // Landing spring
    this.landVel += -this.landDip * 180 * dt;
    this.landVel *= 1 - damp(16, dt);
    this.landDip += this.landVel * dt * 6;

    const bx = Math.sin(this.bobPhase) * 0.014 * this.bobAmt;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.016 * this.bobAmt;
    const eq = 1 - this.equipT;
    this.rig.position.set(
      bx - this.sway.x,
      by + this.sway.y - eq * eq * 0.35 + this.landDip * 0.08 - this.sprintK * 0.02,
      this.hitKick * 0.03,
    );
    this.rig.rotation.set(this.sway.y * 1.2, -this.sway.x * 1.2, bx * 2 - this.sprintK * 0.08);

    const id = this.itemId;
    const h = this.holder;
    h.rotation.order = 'ZYX';
    if (id === 'gapple') {
      h.position.set(0.3, -0.3, -0.55);
      h.rotation.set(-0.2, 0.4, 0.1);
      // Eating: bring to mouth and nibble
      const e = this.eatK;
      h.position.x += (0.05 - 0.3) * e;
      h.position.y += (-0.12 + 0.3) * e + Math.sin(performance.now() * 0.025) * 0.012 * e;
      h.position.z += 0.18 * e;
      h.rotation.x += 0.5 * e;
      this.arm.position.set(0, -0.02, 0);
      this.arm.rotation.set(0.1, 0, 0);
    } else {
      // Rest pose: blade forward-up, leaning left across the view.
      h.position.set(0.34, -0.33 - this.sprintK * 0.02, -0.56);
      h.rotation.set(-1.05 + this.sprintK * 0.25, 0.25, 0.28 + this.sprintK * 0.15);
      this.arm.position.set(0, 0, 0);
      this.arm.rotation.set(Math.PI / 2, 0, 0);

      // Block: blade horizontal across the screen
      const b = this.blockK;
      h.position.x += -0.14 * b;
      h.position.y += 0.06 * b;
      h.rotation.z += 1.05 * b;
      h.rotation.x += 0.55 * b;
      h.rotation.y += -0.2 * b;

      // Swing: a fast diagonal slash, alternating sides.
      if (this.swingT < 1) {
        const k = this.swingT;
        const s = Math.sin(k * Math.PI);
        const cut = easeOutCubic(Math.min(1, k * 1.6));
        const side = this.swingSide;
        h.position.x += -s * 0.24;
        h.position.y += s * 0.05 - cut * 0.02;
        h.position.z += -s * 0.2;
        h.rotation.x += -s * 1.05 + (cut - k) * 0.4;
        h.rotation.y += s * 0.55 * side;
        h.rotation.z += s * (0.6 + 0.35 * side);
      }
    }

    this.updateTrail(dt);
  }

  private updateTrail(dt: number): void {
    const swinging = this.swingT < 0.85 && this.item && this.itemId !== 'gapple' && this.blockK < 0.5;
    if (swinging && this.item) {
      const tip = (this.item.userData.tipLocal as THREE.Vector3).clone();
      const base = (this.item.userData.baseLocal as THREE.Vector3).clone();
      this.item.updateWorldMatrix(true, false);
      // positions in camera space
      const toCam = this.camera.matrixWorld.clone().invert().multiply(this.item.matrixWorld);
      this.trailPts.unshift({ a: tip.applyMatrix4(toCam), b: base.applyMatrix4(toCam), t: 0 });
      if (this.trailPts.length > TRAIL_N) this.trailPts.length = TRAIL_N;
    }
    for (const p of this.trailPts) p.t += dt;
    while (this.trailPts.length && this.trailPts[this.trailPts.length - 1].t > 0.12) this.trailPts.pop();
    for (let i = 0; i < TRAIL_N; i++) {
      const p = this.trailPts[Math.min(i, this.trailPts.length - 1)];
      if (!p) {
        this.trailAlpha[i * 2] = this.trailAlpha[i * 2 + 1] = 0;
        continue;
      }
      this.trailPos.set([p.a.x, p.a.y, p.a.z], i * 6);
      this.trailPos.set([p.b.x, p.b.y, p.b.z], i * 6 + 3);
      const fade = (1 - i / TRAIL_N) * clamp(1 - p.t / 0.12, 0, 1) * (i < this.trailPts.length ? 1 : 0);
      this.trailAlpha[i * 2] = fade * 0.55;
      this.trailAlpha[i * 2 + 1] = 0;
    }
    const g = this.trail.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
