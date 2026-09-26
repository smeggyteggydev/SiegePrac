import * as THREE from 'three';
import type { Fighter } from './Fighter';
import { buildPixelItem } from '../weapons/PixelItems';
import type { ItemId } from '../weapons/Items';
import { damp, lerpAngle, angleDiff, clamp } from '../utils/math';
import { MAX_HEALTH } from '../config/constants';
import { skinTexture, skinnedBox, type SkinPart } from './Skins';

/** 1 skin pixel in metres: a 32 px tall player is 1.8 m. */
const PX = 1.8 / 32;

/**
 * Classic-proportioned player model (8/12/12 px head/body/legs) with the
 * familiar limb-swing, attack-swing, sneak, block and hurt-flash animation.
 */
let shadowTex: THREE.Texture | null = null;
function blobTexture(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 2, 16, 16, 16);
  grd.addColorStop(0, 'rgba(0,0,0,0.9)');
  grd.addColorStop(0.7, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

export class FighterModel {
  /** Ground height lookup for the blob shadow (set by the game). */
  static groundAt: (x: number, z: number, fromY: number) => number = () => -Infinity;
  readonly root = new THREE.Group();
  private blob: THREE.Mesh;
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private hand = new THREE.Group();
  private itemMesh: THREE.Group | null = null;
  private itemId: ItemId | null | undefined = undefined;
  private hurt = { value: 0 };
  private limbSwing = 0;
  private limbAmount = 0;
  private bodyYaw = 0;
  private sneakK = 0;
  private nameTag: THREE.Sprite;
  private tagCanvas: HTMLCanvasElement;
  private tagHealth = -1;
  private deathT = 0;

  constructor(readonly fighter: Fighter) {
    const team = fighter.team;
    const tex = skinTexture(team);
    const base = this.material(tex, 0.85, 0);
    const over = this.material(tex, 0.5, 0.25);
    const part = (p: SkinPart, inflate = 0) => skinnedBox(team, p, PX, inflate, inflate > 0 ? over : base);

    // Legs: pivot at the hip (12 px)
    for (const [leg, x, a, b] of [
      [this.legR, 2, 'rightLeg', 'rightPants'],
      [this.legL, -2, 'leftLeg', 'leftPants'],
    ] as const) {
      leg.position.set(x * PX, 12 * PX, 0);
      const m = part(a);
      const o = part(b, 0.25);
      m.position.y = o.position.y = -6 * PX;
      leg.add(m, o);
      this.body.add(leg);
    }
    // Torso group pivots at the hip so sneaking bends the whole upper body.
    this.torso.position.y = 12 * PX;
    const bodyM = part('body');
    const jacket = part('jacket', 0.3);
    bodyM.position.y = jacket.position.y = 6 * PX;
    this.torso.add(bodyM, jacket);
    // Head: pivot at the neck
    this.head.position.y = 12 * PX;
    const headM = part('head');
    const hat = part('hat', 0.5);
    headM.position.y = hat.position.y = 4 * PX;
    this.head.add(headM, hat);
    this.torso.add(this.head);
    // Arms: pivot at the shoulder (22 px ⇒ 10 px above the hip)
    for (const [arm, x, a, b] of [
      [this.armR, 6, 'rightArm', 'rightSleeve'],
      [this.armL, -6, 'leftArm', 'leftSleeve'],
    ] as const) {
      arm.position.set(x * PX, 10 * PX, 0);
      const m = part(a);
      const o = part(b, 0.3);
      m.position.set(0, -4 * PX, 0);
      o.position.copy(m.position);
      arm.add(m, o);
      this.torso.add(arm);
    }
    this.hand.position.set(0, -10 * PX, 0);
    this.armR.add(this.hand);
    this.body.add(this.torso);
    this.root.add(this.body);

    // Classic blob shadow (world shadows are baked; fighters don't cast into them)
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = false;
    });
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.5 }),
    );
    this.blob.renderOrder = 2;
    this.root.add(this.blob);

    // Name tag with health
    this.tagCanvas = document.createElement('canvas');
    this.tagCanvas.width = 256;
    this.tagCanvas.height = 64;
    const tagTex = new THREE.CanvasTexture(this.tagCanvas);
    tagTex.colorSpace = THREE.SRGBColorSpace;
    this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthTest: true, transparent: true }));
    this.nameTag.scale.set(1.2, 0.3, 1);
    this.nameTag.position.y = 2.25;
    this.nameTag.renderOrder = 5;
    this.root.add(this.nameTag);
    this.drawTag();
  }

  private material(tex: THREE.Texture, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness, metalness, alphaTest: 0.5 });
    const hurt = this.hurt;
    m.onBeforeCompile = (s) => {
      s.uniforms.uHurt = hurt;
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uHurt;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.1, 0.06), uHurt * 0.55);
          totalEmissiveRadiance += vec3(0.6, 0.03, 0.02) * uHurt * 0.5;`,
        );
    };
    m.customProgramCacheKey = () => 'fighter-skin';
    return m;
  }

  setNameTagVisible(v: boolean): void {
    this.nameTag.visible = v;
  }

  setRim(_v: number): void {}

  private drawTag(): void {
    const f = this.fighter;
    const g = this.tagCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.font = '600 22px "Chakra Petch", "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const name = f.name;
    const w = g.measureText(name).width + 20;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(128 - w / 2, 4, w, 28);
    g.fillStyle = f.team === 'red' ? '#ff7a6a' : '#7fb6ff';
    g.fillText(name, 128, 19);
    // classic "♥ hp" line under the name
    const hp = Math.max(0, f.health) + f.absorption;
    const text = `${(Math.ceil(hp * 2) / 2).toFixed(1)} ❤`;
    g.font = '700 20px "Chakra Petch", "Segoe UI", sans-serif';
    const w2 = g.measureText(text).width + 16;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(128 - w2 / 2, 36, w2, 24);
    const pct = clamp(f.health / MAX_HEALTH, 0, 1);
    g.fillStyle = f.absorption > 0 ? '#ffd24a' : pct > 0.5 ? '#6bf08a' : pct > 0.25 ? '#ffd24a' : '#ff5a4a';
    g.fillText(text, 128, 49);
    (this.nameTag.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  private setItem(id: ItemId | null): void {
    if (id === this.itemId) return;
    this.itemId = id;
    if (this.itemMesh) this.hand.remove(this.itemMesh);
    this.itemMesh = null;
    if (!id) return;
    const item = buildPixelItem(id);
    const holder = new THREE.Group();
    if (id === 'gapple') {
      item.scale.setScalar(0.45);
      item.position.set(0, -0.06, -0.12);
      holder.add(item);
    } else {
      // Grip pixel at the fist, blade pointing forward & up out of the hand.
      item.position.set(0.34375, 0.34375, 0);
      const pivot = new THREE.Group();
      pivot.add(item);
      pivot.scale.setScalar(0.72);
      // sprite diagonal (1,1,0) → forward-up; sprite plane faces sideways
      const B = new THREE.Vector3(0, -0.35, -1).normalize();
      const N = new THREE.Vector3(1, 0, 0);
      const P = new THREE.Vector3().crossVectors(N, B).normalize();
      const Nn = new THREE.Vector3().crossVectors(B, P);
      const target = new THREE.Matrix4().makeBasis(B, P, Nn);
      const a1 = new THREE.Vector3(1, 1, 0).normalize();
      const a2 = new THREE.Vector3(-1, 1, 0).normalize();
      const local = new THREE.Matrix4().makeBasis(a1, a2, new THREE.Vector3(0, 0, 1));
      pivot.quaternion.setFromRotationMatrix(target.multiply(local.transpose()));
      holder.add(pivot);
    }
    holder.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = false;
    });
    this.itemMesh = holder;
    this.hand.add(holder);
  }

  update(alpha: number, dt: number, _time: number): void {
    const f = this.fighter;
    const px = f.prevPos.x + (f.pos.x - f.prevPos.x) * alpha;
    const py = f.prevPos.y + (f.pos.y - f.prevPos.y) * alpha;
    const pz = f.prevPos.z + (f.pos.z - f.prevPos.z) * alpha;
    this.root.position.set(px, py, pz);
    const gy = FighterModel.groundAt(px, pz, py + 0.3);
    const above = py - gy;
    this.blob.visible = Number.isFinite(gy) && above < 4 && f.alive;
    if (this.blob.visible) {
      this.blob.position.y = -above + 0.02;
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - above / 4);
    }

    const key = Math.round(f.health * 2) + Math.round(f.absorption * 2) * 100;
    if (key !== this.tagHealth) {
      this.tagHealth = key;
      this.drawTag();
    }
    this.setItem(f.heldItem()?.id ?? null);

    if (!f.alive) {
      // Classic death: tip over sideways, flushed red.
      this.deathT += dt;
      const k = clamp(this.deathT / 0.5, 0, 1);
      this.body.rotation.z = Math.sqrt(k) * (Math.PI / 2);
      this.hurt.value = 1;
      this.nameTag.visible = false;
      return;
    }
    if (this.deathT > 0) {
      this.deathT = 0;
      this.body.rotation.set(0, 0, 0);
      this.nameTag.visible = true;
    }

    // Body yaw trails head yaw, following movement direction.
    const headYaw = f.prevYaw + angleDiff(f.prevYaw, f.yaw) * alpha;
    const speed = f.horizontalSpeed();
    let target = this.bodyYaw;
    if (speed > 0.4) {
      const moveYaw = Math.atan2(-f.vel.x, -f.vel.z);
      let d = angleDiff(headYaw, moveYaw);
      if (Math.abs(d) > Math.PI / 2) d = angleDiff(headYaw, moveYaw + Math.PI);
      target = headYaw + clamp(d, -1, 1) * 0.7;
    }
    this.bodyYaw = lerpAngle(this.bodyYaw, target, damp(10, dt));
    const twist = angleDiff(this.bodyYaw, headYaw);
    if (Math.abs(twist) > 0.87) this.bodyYaw = headYaw - Math.sign(twist) * 0.87;
    if (f.swingTime < 0.3) this.bodyYaw = lerpAngle(this.bodyYaw, headYaw, damp(20, dt));
    this.body.rotation.y = this.bodyYaw;
    this.head.rotation.y = angleDiff(this.bodyYaw, headYaw);
    const pitch = f.prevPitch + (f.pitch - f.prevPitch) * alpha;
    this.head.rotation.x = clamp(pitch, -1.4, 1.4);

    // Limb swing (per tick: amount → min(1, speed·4), swing += amount)
    const perTick = speed / 20;
    const want = f.onGround || speed > 1 ? Math.min(1, perTick * 4) : this.limbAmount * 0.9;
    this.limbAmount += (want - this.limbAmount) * (1 - Math.pow(0.6, dt * 20));
    this.limbSwing += this.limbAmount * dt * 20;
    const ls = this.limbSwing * 0.6662;
    const la = this.limbAmount;
    let armR = Math.cos(ls + Math.PI) * 2 * la * 0.5;
    const armL = Math.cos(ls) * 2 * la * 0.5;
    this.legR.rotation.x = Math.cos(ls) * 1.4 * la;
    this.legL.rotation.x = Math.cos(ls + Math.PI) * 1.4 * la;
    let armRy = 0;
    let armRz = 0;
    let torsoY = 0;

    const held = this.itemId;
    if (held) armR = armR * 0.5 + Math.PI / 10;
    if (f.blocking) {
      armR = armR * 0.5 + (Math.PI / 10) * 3;
      armRy = Math.PI / 6;
    }
    if (f.eating > 0) {
      armR = 1.35 + Math.sin(f.eating * 22) * 0.12;
      armRy = 0.45;
    }
    // Attack swing
    const p = f.swingTime < 0.3 ? f.swingTime / 0.3 : 0;
    if (p > 0) {
      torsoY = Math.sin(Math.sqrt(p) * Math.PI * 2) * 0.2;
      let f1 = 1 - p;
      f1 = 1 - f1 * f1 * f1 * f1;
      const f2 = Math.sin(f1 * Math.PI);
      const f3 = Math.sin(p * Math.PI) * (this.head.rotation.x + 0.7) * 0.75;
      armR = armR + (f2 * 1.2 + f3);
      armRy += torsoY * 2;
      armRz += Math.sin(p * Math.PI) * 0.4;
    }
    this.torso.rotation.y = torsoY;
    this.armR.rotation.set(armR, armRy, armRz);
    this.armL.rotation.set(armL, 0, 0);

    // Sneak
    this.sneakK += ((f.crouching ? 1 : 0) - this.sneakK) * damp(18, dt);
    this.torso.rotation.x = -0.5 * this.sneakK;
    this.armR.rotation.x += 0.4 * this.sneakK;
    this.armL.rotation.x += 0.4 * this.sneakK;
    this.body.position.y = -0.18 * this.sneakK;
    this.legL.position.z = this.legR.position.z = 0.2 * this.sneakK;

    // Hurt flash (and a small recoil lean)
    this.hurt.value = clamp(f.hitstun / 0.3, 0, 1);
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
