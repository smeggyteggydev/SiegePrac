import * as THREE from 'three';
import type { Fighter } from './Fighter';
import { buildItem } from '../weapons/WeaponMeshes';
import type { ItemId } from '../weapons/Items';
import { damp, lerpAngle, angleDiff, clamp } from '../utils/math';
import { MAX_HEALTH } from '../config/constants';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

const TEAM = {
  blue: { cloth: '#2f6fd1', trim: '#9fd0ff', rim: new THREE.Color('#5aa8ff') },
  red: { cloth: '#d4382f', trim: '#ffc27a', rim: new THREE.Color('#ff5a3c') },
};

/**
 * Standard material + a team-coloured fresnel rim so fighters always pop from
 * the background (competitive readability) and a hurt flash uniform.
 */
function fighterMaterial(color: string, rim: THREE.Color, shared: { uHurt: THREE.IUniform; uRim: THREE.IUniform }, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...opts });
  m.onBeforeCompile = (s) => {
    s.uniforms.uHurt = shared.uHurt;
    s.uniforms.uRim = shared.uRim;
    s.uniforms.uRimColor = { value: rim };
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHurt;\nuniform float uRim;\nuniform vec3 uRimColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 vdir = normalize(-vViewPosition);
        float rimF = pow(1.0 - max(dot(normal, vdir), 0.0), 2.5);
        totalEmissiveRadiance += uRimColor * rimF * uRim;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.18, 0.12), uHurt * 0.65);
        totalEmissiveRadiance += vec3(0.9, 0.08, 0.04) * uHurt * 0.6;`,
      );
  };
  m.customProgramCacheKey = () => 'fighter-mat';
  return m;
}

function box(w: number, h: number, d: number, mat: THREE.Material, y = 0, x = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export class FighterModel {
  readonly root = new THREE.Group();
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
  private uniforms = { uHurt: { value: 0 }, uRim: { value: 0.55 } };
  private phase = 0;
  private bodyYaw = 0;
  private lean = 0;
  private recoil = new THREE.Vector2();
  private nameTag: THREE.Sprite;
  private tagCanvas: HTMLCanvasElement;
  private tagHealth = -1;
  private deathT = 0;

  constructor(readonly fighter: Fighter) {
    const t = TEAM[fighter.team];
    const U = this.uniforms;
    const armor = fighterMaterial('#9aa3ae', t.rim, U, { metalness: 0.6, roughness: 0.38 });
    const dark = fighterMaterial('#2c2f36', t.rim, U, { roughness: 0.8 });
    const cloth = fighterMaterial(t.cloth, t.rim, U, { roughness: 0.85 });
    const trim = fighterMaterial(t.trim, t.rim, U, { metalness: 0.7, roughness: 0.35 });
    const skin = fighterMaterial('#c89a76', t.rim, U, { roughness: 0.8 });
    const visor = new THREE.MeshStandardMaterial({ color: '#0c0e12', emissive: t.trim, emissiveIntensity: 0.9, roughness: 0.2 });

    // Legs (pivot at hip)
    for (const [leg, x] of [
      [this.legL, -0.14],
      [this.legR, 0.14],
    ] as const) {
      leg.position.set(x, 0.78, 0);
      leg.add(box(0.25, 0.5, 0.27, dark, -0.25));
      leg.add(box(0.27, 0.3, 0.29, armor, -0.62));
      leg.add(box(0.27, 0.08, 0.32, dark, -0.74, 0, -0.02));
      this.body.add(leg);
    }

    // Torso
    this.torso.position.y = 0.78;
    this.torso.add(box(0.54, 0.64, 0.3, cloth, 0.32));
    this.torso.add(box(0.58, 0.38, 0.34, armor, 0.44));
    this.torso.add(box(0.6, 0.07, 0.35, trim, 0.26));
    this.torso.add(box(0.1, 0.24, 0.36, trim, 0.46));
    // tabard
    this.torso.add(box(0.3, 0.3, 0.02, cloth, 0.06, 0, -0.17));
    this.torso.add(box(0.3, 0.3, 0.02, cloth, 0.06, 0, 0.17));
    this.body.add(this.torso);

    // Head (child of torso so it follows lean)
    this.head.position.y = 0.66;
    this.head.add(box(0.4, 0.4, 0.4, skin, 0.2));
    this.head.add(box(0.46, 0.3, 0.46, armor, 0.27));
    this.head.add(box(0.44, 0.07, 0.03, visor, 0.22, 0, -0.235));
    this.head.add(box(0.08, 0.12, 0.34, cloth, 0.46));
    this.head.add(box(0.47, 0.05, 0.47, trim, 0.13));
    this.torso.add(this.head);

    // Arms (pivot at shoulder)
    for (const [arm, x] of [
      [this.armL, -0.39],
      [this.armR, 0.39],
    ] as const) {
      arm.position.set(x, 0.6, 0);
      arm.add(box(0.21, 0.62, 0.23, cloth, -0.28));
      arm.add(box(0.28, 0.2, 0.3, armor, -0.02));
      arm.add(box(0.29, 0.05, 0.31, trim, 0.09));
      arm.add(box(0.23, 0.18, 0.25, dark, -0.5));
      this.torso.add(arm);
    }
    this.hand.position.set(0, -0.6, -0.02);
    this.armR.add(this.hand);

    this.root.add(this.body);

    // Name tag with health
    this.tagCanvas = document.createElement('canvas');
    this.tagCanvas.width = 256;
    this.tagCanvas.height = 64;
    const tex = new THREE.CanvasTexture(this.tagCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    this.nameTag.scale.set(1.3, 0.325, 1);
    this.nameTag.position.y = 2.28;
    this.nameTag.renderOrder = 5;
    this.root.add(this.nameTag);
    this.drawTag();
  }

  setNameTagVisible(v: boolean): void {
    this.nameTag.visible = v;
  }

  private drawTag(): void {
    const f = this.fighter;
    const g = this.tagCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(10,12,16,0.55)';
    g.fillRect(20, 4, 216, 30);
    g.font = '600 20px "Chakra Petch", "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = f.team === 'red' ? '#ff8a7a' : '#8cc4ff';
    g.fillText(f.name.toUpperCase(), 128, 20);
    // health bar
    const pct = clamp(f.health / MAX_HEALTH, 0, 1);
    g.fillStyle = 'rgba(10,12,16,0.6)';
    g.fillRect(40, 40, 176, 12);
    g.fillStyle = pct > 0.5 ? '#5fe07a' : pct > 0.25 ? '#ffc43a' : '#ff4a3a';
    g.fillRect(42, 42, 172 * pct, 8);
    if (f.absorption > 0) {
      g.fillStyle = '#ffd24a';
      g.fillRect(42, 42, 172 * clamp(f.absorption / MAX_HEALTH, 0, 1), 3);
    }
    (this.nameTag.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  private setItem(id: ItemId | null): void {
    if (id === this.itemId) return;
    this.itemId = id;
    if (this.itemMesh) this.hand.remove(this.itemMesh);
    this.itemMesh = buildItem(id);
    if (id === 'gapple') {
      this.itemMesh.position.set(0, -0.02, -0.06);
    } else {
      // held pointing forward out of the fist
      this.itemMesh.rotation.x = -Math.PI / 2;
      this.itemMesh.position.set(0, 0, -0.02);
    }
    this.itemMesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.hand.add(this.itemMesh);
  }

  update(alpha: number, dt: number, time: number): void {
    const f = this.fighter;
    const px = f.prevPos.x + (f.pos.x - f.prevPos.x) * alpha;
    const py = f.prevPos.y + (f.pos.y - f.prevPos.y) * alpha;
    const pz = f.prevPos.z + (f.pos.z - f.prevPos.z) * alpha;
    this.root.position.set(px, py, pz);

    const healthKey = Math.round(f.health * 2) + Math.round(f.absorption * 2) * 100;
    if (healthKey !== this.tagHealth) {
      this.tagHealth = healthKey;
      this.drawTag();
    }

    this.setItem(f.heldItem()?.id ?? null);

    // Death: topple backwards and sink
    if (!f.alive) {
      this.deathT += dt;
      const k = clamp(this.deathT / 0.45, 0, 1);
      this.body.rotation.x = -k * k * 1.45;
      this.body.position.y = -clamp(this.deathT - 0.6, 0, 1) * 0.8;
      this.uniforms.uHurt.value = 1 - clamp(this.deathT * 2, 0, 0.7);
      this.nameTag.visible = false;
      return;
    }
    if (this.deathT > 0) {
      this.deathT = 0;
      this.body.rotation.set(0, 0, 0);
      this.body.position.set(0, 0, 0);
      this.nameTag.visible = true;
    }

    const headYaw = f.prevYaw + angleDiff(f.prevYaw, f.yaw) * alpha;
    const speed = f.horizontalSpeed();
    // Body follows movement direction; head leads with aim (limited twist).
    let targetBody = headYaw;
    if (speed > 0.5) {
      const moveYaw = Math.atan2(-f.vel.x, -f.vel.z);
      let d = angleDiff(headYaw, moveYaw);
      if (Math.abs(d) > Math.PI / 2) d = angleDiff(headYaw, moveYaw + Math.PI);
      targetBody = headYaw + clamp(d, -0.8, 0.8) * 0.6;
    }
    this.bodyYaw = lerpAngle(this.bodyYaw, targetBody, damp(12, dt));
    if (Math.abs(angleDiff(this.bodyYaw, headYaw)) > 1.0)
      this.bodyYaw = headYaw - Math.sign(angleDiff(this.bodyYaw, headYaw)) * 1.0;
    this.body.rotation.y = this.bodyYaw;
    this.head.rotation.y = angleDiff(this.bodyYaw, headYaw);
    const pitch = f.prevPitch + (f.pitch - f.prevPitch) * alpha;
    this.head.rotation.x = clamp(pitch, -1.2, 1.2) * 0.8;

    // Walk cycle
    const moving = f.onGround ? clamp(speed / 5.6, 0, 1.2) : 0;
    this.phase += speed * dt * (f.sprinting ? 2.35 : 2.8);
    const swingAmp = (f.sprinting ? 0.95 : 0.7) * moving;
    const s = Math.sin(this.phase);
    let legL = s * swingAmp;
    let legR = -s * swingAmp;
    let armL = -s * swingAmp * 0.8;
    let armR = s * swingAmp * 0.6;
    let armRz = 0;
    let armLz = 0;

    if (!f.onGround) {
      const up = clamp(f.vel.y / 8, -1, 1);
      legL = 0.35 + up * 0.2;
      legR = -0.5;
      armL = -0.4;
      armLz = -0.3;
    }
    const targetLean = f.crouching ? 0.45 : f.sprinting ? 0.2 : 0;
    this.lean += (targetLean - this.lean) * damp(10, dt);
    this.body.position.y = f.crouching ? -0.22 : Math.abs(Math.cos(this.phase)) * 0.05 * moving;

    // Held item poses
    const holding = f.heldItem()?.id;
    if (holding && holding !== 'gapple') armR = armR * 0.4 + 0.35;
    if (f.blocking) {
      armR = 1.05;
      armRz = 0.55;
    }
    if (f.eating > 0) {
      armR = 1.4 + Math.sin(time * 18) * 0.1;
      armRz = 0.5;
    }
    // Attack swing: a fast diagonal slash
    const st = f.swingTime;
    if (st < 0.28) {
      const k = st / 0.28;
      const e = Math.sin(k * Math.PI);
      armR = 0.35 + e * 1.6 - k * 0.5;
      armRz = 0.2 + Math.sin(k * Math.PI) * 0.5 - k * 0.3;
      this.torso.rotation.y = -Math.sin(k * Math.PI) * 0.35;
    } else {
      this.torso.rotation.y *= 1 - damp(12, dt);
    }

    this.legL.rotation.x = legL;
    this.legR.rotation.x = legR;
    this.armL.rotation.x = armL;
    this.armL.rotation.z = armLz;
    this.armR.rotation.x = armR;
    this.armR.rotation.z = armRz;

    // Hit reaction: flash + recoil away from the hit
    const hurt = clamp(f.hitstun / 0.3, 0, 1);
    this.uniforms.uHurt.value = hurt;
    if (f.hitstun > 0.28) {
      // local recoil direction relative to body
      const local = f.lastHitDir.clone().applyAxisAngle(Y_AXIS, -this.bodyYaw);
      this.recoil.set(local.x, local.z);
    }
    this.recoil.multiplyScalar(1 - damp(7, dt));
    this.torso.rotation.x = -this.lean + this.recoil.y * 0.35 * hurt;
    this.torso.rotation.z = -this.recoil.x * 0.35 * hurt;
  }

  setRim(v: number): void {
    this.uniforms.uRim.value = v;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
