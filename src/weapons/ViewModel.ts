import * as THREE from 'three';
import type { Fighter } from '../entities/Fighter';
import type { ItemId } from './Items';
import { buildPixelItem } from './PixelItems';
import { damp } from '../utils/math';
import { SUN_DIR } from '../render/Sky';
import { EAT_TIME } from '../config/constants';
import { skinnedBox } from '../entities/Skins';

const DEG = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
/** Held-item size relative to the vanilla first-person size (PvP packs shrink it). */
const ITEM_SCALE = 0.74;
const SWING_TIME = 0.3; // 6 ticks, like classic PvP

/**
 * First-person hand, rendered in its own pass after the world (never clips).
 * The transform chain follows the classic 1.8-era hand renderer: held
 * position, sqrt/sin swing curves, block pose, eating bob and lagging arm
 * sway — exactly the motion competitive players' muscle memory expects.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private root = new THREE.Group(); // receives the full matrix each frame
  private item: THREE.Group | null = null;
  private arm: THREE.Group;
  private itemId: ItemId | null | undefined = undefined;
  private sun: THREE.DirectionalLight;
  private swingT = 1;
  /** Freeze the swing at a progress value (automated screenshots). */
  debugSwing: number | null = null;
  private equip = 1;
  private armYaw = 0;
  private armPitch = 0;
  private started = false;
  private blockK = 0;
  private bob = { phase: 0, amount: 0, pitch: 0 };
  private m = new THREE.Matrix4();
  private t = new THREE.Matrix4();
  private axis = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.01, 10);
    this.scene.add(this.camera);
    this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);

    this.scene.add(new THREE.HemisphereLight('#dfe9ff', '#6b5a45', 1.3));
    this.sun = new THREE.DirectionalLight('#ffe6c4', 2.2);
    this.scene.add(this.sun, this.sun.target);

    // Classic 4×12×4 px arm, pivot at the shoulder end.
    this.arm = new THREE.Group();
    const armMesh = skinnedBox('blue', 'rightArm', 1 / 16);
    const sleeve = skinnedBox('blue', 'rightSleeve', 1 / 16, 0.25);
    armMesh.position.set(0, -6 / 16, 0);
    sleeve.position.copy(armMesh.position);
    this.arm.add(armMesh, sleeve);
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  setEnvironment(env: THREE.Texture | null): void {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.7;
  }

  private setItem(id: ItemId | null): void {
    if (id === this.itemId) return;
    const first = this.itemId === undefined;
    this.itemId = id;
    this.root.clear();
    this.item = id ? buildPixelItem(id) : null;
    this.root.add(this.item ?? this.arm);
    if (!first) this.equip = 0;
  }

  /** Called when the local fighter swings. */
  swing(): void {
    // Like the classic client: a new swing only restarts once past halfway.
    if (this.swingT >= 0.5) this.swingT = 0;
  }

  hit(_crit: boolean): void {}
  land(_speed: number): void {}
  look(_dYaw: number, _dPitch: number): void {}

  /** View-bob state shared with the world camera. */
  setBob(phase: number, amount: number, pitchDeg: number): void {
    this.bob.phase = phase;
    this.bob.amount = amount;
    this.bob.pitch = pitchDeg;
  }

  update(f: Fighter, dt: number, cameraWorldQuat: THREE.Quaternion, yaw: number, pitch: number): void {
    this.setItem(f.heldItem()?.id ?? null);

    const sd = SUN_DIR.clone().applyQuaternion(cameraWorldQuat.clone().invert());
    this.sun.position.copy(sd).multiplyScalar(5);

    this.swingT = Math.min(1, this.swingT + dt / SWING_TIME);
    this.equip = Math.min(1, this.equip + dt * 7);
    this.blockK += ((f.blocking ? 1 : 0) - this.blockK) * damp(40, dt);

    // Arm lag: follows the view at 0.5 per tick.
    if (!this.started || Math.abs(yaw - this.armYaw) > 3) {
      this.armYaw = yaw;
      this.armPitch = pitch;
      this.started = true;
    }
    const lag = 1 - Math.pow(0.5, dt * 20);
    this.armYaw += (yaw - this.armYaw) * lag;
    this.armPitch += (pitch - this.armPitch) * lag;

    const m = this.m.identity();
    const T = (x: number, y: number, z: number) => m.multiply(this.t.makeTranslation(x, y, z));
    const R = (deg: number, x: number, y: number, z: number) =>
      m.multiply(this.t.makeRotationAxis(this.axis.set(x, y, z), deg * DEG));
    const S = (s: number) => m.multiply(this.t.makeScale(s, s, s));

    // View bobbing — same curve as the world camera.
    const b = this.bob;
    const ph = b.phase * Math.PI;
    T(Math.sin(ph) * b.amount * 0.5, -Math.abs(Math.cos(ph) * b.amount), 0);
    R(Math.sin(ph) * b.amount * 3, 0, 0, 1);
    R(Math.abs(Math.cos(ph - 0.2) * b.amount) * 5, 1, 0, 0);
    R(b.pitch, 1, 0, 0);

    // Sway from turning (our yaw/pitch signs are mirrored vs. the classic client).
    R(-(yaw - this.armYaw) * RAD2DEG * 0.1, 0, 1, 0);
    R(-(pitch - this.armPitch) * RAD2DEG * 0.1, 1, 0, 0);

    const p = this.debugSwing ?? (this.swingT >= 1 ? 0 : this.swingT);
    const down = 1 - this.equip;
    const sq = Math.sin(Math.sqrt(p) * Math.PI);
    const id = this.itemId;

    if (!id) {
      // Empty hand: straight punch.
      T(-0.3 * sq, 0.4 * Math.sin(Math.sqrt(p) * Math.PI * 2) * 0.3, -0.4 * Math.sin(p * Math.PI));
      T(0.5, -0.46 - down * 0.6, -0.55);
      R(sq * 25, 0, 1, 0);
      R(-70, 1, 0, 0);
      R(-8, 0, 1, 0);
      R(12, 0, 0, 1);
      S(1.0);
    } else {
      if (id === 'gapple' && f.eating > 0) {
        const left = Math.max(0, EAT_TIME - f.eating) * 20; // ticks remaining
        const frac = left / (EAT_TIME * 20);
        const up = frac >= 0.8 ? 0 : Math.abs(Math.cos((left / 4) * Math.PI) * 0.1);
        T(0, up, 0);
        const k = 1 - Math.pow(frac, 27);
        T(k * 0.6, k * -0.5, 0);
        R(k * 90, 0, 1, 0);
        R(k * 10, 1, 0, 0);
        R(k * 30, 0, 0, 1);
        this.held(0, down, T, R, S);
      } else if (this.blockK > 0.5 && id === 'sword') {
        this.held(0, down, T, R, S);
        T(-0.5, 0.2, 0);
        R(30, 0, 1, 0);
        R(-80, 1, 0, 0);
        R(60, 0, 1, 0);
      } else {
        T(-0.4 * sq, 0.2 * Math.sin(Math.sqrt(p) * Math.PI * 2), -0.2 * Math.sin(p * Math.PI));
        this.held(p, down, T, R, S);
      }
      // Item display transform (first person, handheld)
      T(0, 4 / 16, 2 / 16);
      R(-135, 0, 1, 0);
      R(25, 0, 0, 1);
      S(1.7);
      S(ITEM_SCALE); // PvP-style smaller held item
      m.multiply(this.t.makeScale(-1, 1, 1));
    }
    this.root.matrix.copy(m);
    this.root.matrixWorldNeedsUpdate = true;
  }

  private held(
    p: number,
    down: number,
    T: (x: number, y: number, z: number) => void,
    R: (deg: number, x: number, y: number, z: number) => void,
    S: (s: number) => void,
  ): void {
    T(0.47, -0.43, -0.72);
    T(0, down * -0.6, 0);
    R(45, 0, 1, 0);
    const f = Math.sin(p * p * Math.PI);
    const f1 = Math.sin(Math.sqrt(p) * Math.PI);
    R(f * -20, 0, 1, 0);
    R(f1 * -20, 0, 0, 1);
    R(f1 * -80, 1, 0, 0);
    S(0.4);
  }
}
