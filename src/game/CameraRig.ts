import * as THREE from 'three';
import type { Fighter } from '../entities/Fighter';
import { settings } from '../config/settings';
import { damp, clamp } from '../utils/math';
import type { VoxelWorld } from './World';

const DEG = Math.PI / 180;

/**
 * First-person camera. Aim comes straight from input (zero smoothing); the
 * feel comes from the classic view-bob (walk-distance driven sway + roll +
 * pitch), the hurt-cam roll, sprint FOV and step smoothing.
 */
export class CameraRig {
  private eyeY = 1.62;
  private fovMul = 1;
  thirdPerson = false;
  private tpDist = 0;
  private deathT = 0;
  private lastY = 0;
  // classic bob state
  walkDist = 0;
  private prevWalk = 0;
  bobAmount = 0;
  bobPitch = 0;
  private hurtT = 0;
  private hurtSide = 1;
  private m = new THREE.Matrix4();
  private t = new THREE.Matrix4();
  private axis = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  land(_speed: number): void {}

  hurt(dir: THREE.Vector3, yaw: number): void {
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const side = dir.x * rightX + dir.z * rightZ;
    this.hurtSide = side >= 0 ? 1 : -1;
    this.hurtT = 0.5;
  }

  attackKick(_s: number): void {}

  resetDeath(): void {
    this.deathT = 0;
  }

  /** Advance per-tick camera state (call once per simulation tick). */
  tick(f: Fighter, dtTick: number): void {
    this.prevWalk = this.walkDist;
    const moved = Math.hypot(f.pos.x - f.prevPos.x, f.pos.z - f.prevPos.z);
    this.walkDist += moved * 0.6;
    const perTick = Math.min(0.1, Math.hypot(f.vel.x, f.vel.z) / 20);
    const want = f.onGround && f.alive ? perTick : 0;
    this.bobAmount += (want - this.bobAmount) * (1 - Math.pow(0.6, dtTick * 20));
    const pitchWant = f.onGround || !f.alive ? 0 : Math.atan(-(f.vel.y / 20) * 0.2) * 15;
    this.bobPitch += (pitchWant - this.bobPitch) * (1 - Math.pow(0.2, dtTick * 20));
    if (this.hurtT > 0) this.hurtT = Math.max(0, this.hurtT - dtTick);
  }

  update(f: Fighter, alpha: number, yaw: number, pitch: number, dt: number, world: VoxelWorld, killer: Fighter | null): void {
    const cam = this.camera;
    const px = f.prevPos.x + (f.pos.x - f.prevPos.x) * alpha;
    const py = f.prevPos.y + (f.pos.y - f.prevPos.y) * alpha;
    const pz = f.prevPos.z + (f.pos.z - f.prevPos.z) * alpha;

    // Crouch transition + stair smoothing; falls are tracked exactly.
    this.eyeY += (f.eyeHeight - this.eyeY) * damp(20, dt);
    const stepUp = py - this.lastY;
    this.lastY = py;
    if (f.onGround && stepUp > 0.05 && stepUp < 0.6) this.eyeY -= stepUp * 0.75;

    // Sprint FOV (smoothed like the classic client, half-way per tick)
    const want = f.sprinting ? 1.1 : 1;
    this.fovMul += (want - this.fovMul) * (1 - Math.pow(0.5, dt * 20));
    const fov = settings.get('fov') * this.fovMul;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    if (!f.alive) {
      this.deathT += dt;
      const k = clamp(this.deathT / 0.5, 0, 1);
      cam.position.set(px, py + 1.62 - k * 1.3, pz);
      let ly = yaw;
      let lp = pitch;
      if (killer && killer.alive) {
        const dx = killer.pos.x - px;
        const dz = killer.pos.z - pz;
        const dy = killer.pos.y + 1.2 - cam.position.y;
        const w = Math.atan2(-dx, -dz);
        ly = yaw + Math.atan2(Math.sin(w - yaw), Math.cos(w - yaw)) * k;
        lp = pitch + (Math.atan2(dy, Math.hypot(dx, dz)) - pitch) * k;
      }
      cam.rotation.set(lp, ly, k * 0.6, 'YXZ');
      cam.updateMatrixWorld();
      return;
    }
    this.deathT = 0;

    const eye = new THREE.Vector3(px, py + this.eyeY, pz);
    this.tpDist += ((this.thirdPerson ? 4 : 0) - this.tpDist) * damp(12, dt);
    if (this.tpDist > 0.05) {
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      let d = this.tpDist;
      const hit = world.raycast(eye.x, eye.y, eye.z, -dir.x, -dir.y, -dir.z, d + 0.3);
      if (hit < d + 0.3) d = Math.max(0.3, hit - 0.3);
      eye.addScaledVector(dir, -d);
    }
    cam.position.copy(eye);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    cam.updateMatrix();

    // View transform extras, in view space: hurt roll, then bob.
    const m = this.m.identity();
    const R = (deg: number, x: number, y: number, z: number) => m.multiply(this.t.makeRotationAxis(this.axis.set(x, y, z), deg * DEG));
    const shake = settings.get('cameraShake');
    if (this.hurtT > 0) {
      const h = this.hurtT / 0.5;
      R(-Math.sin(h * h * h * h * Math.PI) * 14 * shake * this.hurtSide, 0, 0, 1);
    }
    if (settings.get('viewBobbing') && this.tpDist < 0.05) {
      const ph = -this.walkPhase(alpha) * Math.PI;
      const a = this.bobAmount;
      m.multiply(this.t.makeTranslation(Math.sin(ph) * a * 0.5, -Math.abs(Math.cos(ph) * a), 0));
      R(Math.sin(ph) * a * 3, 0, 0, 1);
      R(Math.abs(Math.cos(ph - 0.2) * a) * 5, 1, 0, 0);
      R(this.bobPitch, 1, 0, 0);
    }
    // view' = M · view  ⇒  cameraWorld' = cameraWorld · M⁻¹
    cam.matrix.multiply(m.invert());
    cam.matrix.decompose(cam.position, cam.quaternion, cam.scale);
    cam.updateMatrixWorld();
  }

  /** Walk phase with sub-tick interpolation (for the hand bob too). */
  walkPhase(alpha: number): number {
    return this.prevWalk + (this.walkDist - this.prevWalk) * alpha;
  }

  get isThirdPerson(): boolean {
    return this.tpDist > 0.5;
  }
}
