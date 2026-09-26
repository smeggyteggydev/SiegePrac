import * as THREE from 'three';
import type { Fighter } from '../entities/Fighter';
import { settings } from '../config/settings';
import { damp, clamp } from '../utils/math';
import type { VoxelWorld } from './World';

/**
 * First-person camera: aim comes straight from input (zero smoothing), while
 * position gets subtle, competitive-safe feedback — sprint FOV, landing dip,
 * hurt tilt, step smoothing and optional view bob.
 */
export class CameraRig {
  private eyeY = 0;
  private fovK = 0;
  private dip = 0;
  private dipVel = 0;
  private roll = 0;
  private kick = 0;
  private bob = 0;
  private bobAmt = 0;
  private lastFighterY = 0;
  thirdPerson = false;
  private tpDist = 0;
  private deathT = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  land(speed: number): void {
    const s = settings.get('cameraShake');
    this.dipVel -= clamp((speed - 3) / 14, 0, 1) * 1.6 * (0.4 + s * 0.6);
  }

  hurt(dir: THREE.Vector3, yaw: number): void {
    const s = settings.get('cameraShake');
    // Tilt away from the side the hit came from.
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const side = -(dir.x * rightX + dir.z * rightZ);
    this.roll = (side >= 0 ? 1 : -1) * 0.075 * s;
  }

  attackKick(strength: number): void {
    this.kick = Math.min(1, this.kick + strength * settings.get('cameraShake'));
  }

  resetDeath(): void {
    this.deathT = 0;
  }

  update(
    f: Fighter,
    alpha: number,
    yaw: number,
    pitch: number,
    dt: number,
    world: VoxelWorld,
    killer: Fighter | null,
  ): void {
    const cam = this.camera;
    const px = f.prevPos.x + (f.pos.x - f.prevPos.x) * alpha;
    const py = f.prevPos.y + (f.pos.y - f.prevPos.y) * alpha;
    const pz = f.prevPos.z + (f.pos.z - f.prevPos.z) * alpha;

    // Smooth step-ups (stairs) and crouch transitions, but track falls exactly.
    const targetEye = f.eyeHeight;
    this.eyeY += (targetEye - this.eyeY) * damp(18, dt);
    const stepUp = py - this.lastFighterY;
    this.lastFighterY = py;
    if (f.onGround && stepUp > 0.05 && stepUp < 0.6) this.eyeY -= stepUp * 0.7;

    // Landing spring
    this.dipVel += -this.dip * 220 * dt;
    this.dipVel *= 1 - damp(14, dt);
    this.dip += this.dipVel * dt;

    this.roll *= 1 - damp(6, dt);
    this.kick *= 1 - damp(16, dt);

    const speed = f.onGround ? f.horizontalSpeed() : 0;
    this.bob += speed * dt * 2.1;
    this.bobAmt += ((settings.get('viewBobbing') ? clamp(speed / 5.6, 0, 1) : 0) - this.bobAmt) * damp(8, dt);
    const bobY = Math.abs(Math.cos(this.bob)) * 0.035 * this.bobAmt;
    const bobX = Math.sin(this.bob) * 0.02 * this.bobAmt;

    // FOV: subtle sprint widen
    this.fovK += ((f.sprinting ? 1 : 0) - this.fovK) * damp(8, dt);
    const fov = settings.get('fov') * (1 + this.fovK * 0.07);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    if (!f.alive) {
      // Death cam: drop and roll, then look at who got you.
      this.deathT += dt;
      const k = clamp(this.deathT / 0.5, 0, 1);
      cam.position.set(px, py + 1.62 - k * 1.2, pz);
      let ly = yaw;
      let lp = pitch;
      if (killer && killer.alive) {
        const dx = killer.pos.x - px;
        const dz = killer.pos.z - pz;
        const dy = killer.pos.y + 1.2 - cam.position.y;
        const want = Math.atan2(-dx, -dz);
        ly = yaw + (Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw))) * k;
        lp = pitch + (Math.atan2(dy, Math.hypot(dx, dz)) - pitch) * k;
      }
      cam.rotation.set(lp, ly, k * 0.5, 'YXZ');
      return;
    }
    this.deathT = 0;

    const eye = new THREE.Vector3(px, py + this.eyeY + this.dip * 0.12 + bobY, pz);
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    eye.x += cosY * bobX;
    eye.z += -sinY * bobX;

    this.tpDist += ((this.thirdPerson ? 3.6 : 0) - this.tpDist) * damp(12, dt);
    if (this.tpDist > 0.05) {
      const dir = new THREE.Vector3(-sinY * Math.cos(pitch), Math.sin(pitch), -cosY * Math.cos(pitch));
      let d = this.tpDist;
      const hit = world.raycast(eye.x, eye.y, eye.z, -dir.x, -dir.y, -dir.z, d + 0.3);
      if (hit < d + 0.3) d = Math.max(0.3, hit - 0.3);
      eye.addScaledVector(dir, -d);
      eye.x += cosY * 0.5;
      eye.z += -sinY * 0.5;
    }

    cam.position.copy(eye);
    cam.rotation.set(pitch + this.kick * 0.012, yaw, this.roll + bobX * 0.3, 'YXZ');
  }

  get isThirdPerson(): boolean {
    return this.tpDist > 0.5;
  }
}
