import { Vector3 } from 'three';
import * as C from '../config/constants';
import { Fighter, type FighterCommand } from '../entities/Fighter';
import { moveBox } from './Physics';
import { VoxelWorld } from './World';
import { resolveAttack } from './Combat';
import { Rng } from '../utils/rng';

export type SimEvent =
  | { type: 'swing'; fighter: Fighter; weapon: string }
  | {
      type: 'hit';
      attacker: Fighter;
      victim: Fighter;
      damage: number;
      crit: boolean;
      blocked: boolean;
      sprint: boolean;
      combo: number;
      point: Vector3;
      dir: Vector3;
    }
  | { type: 'connect'; attacker: Fighter; victim: Fighter; point: Vector3 }
  | { type: 'death'; victim: Fighter; killer: Fighter | null; cause: 'combat' | 'void' }
  | { type: 'jump'; fighter: Fighter; sprint: boolean }
  | { type: 'land'; fighter: Fighter; speed: number }
  | { type: 'step'; fighter: Fighter; sprint: boolean; surface: number }
  | { type: 'eat'; fighter: Fighter; progress: number }
  | { type: 'eatDone'; fighter: Fighter }
  | { type: 'slot'; fighter: Fighter; slot: number }
  | { type: 'sprintReset'; fighter: Fighter }
  | { type: 'comboBreak'; fighter: Fighter; combo: number }
  | { type: 'throw'; fighter: Fighter; projectile: Projectile }
  | { type: 'splash'; projectile: Projectile; point: Vector3; healed: { fighter: Fighter; amount: number }[] }
  | { type: 'pearl'; fighter: Fighter; from: Vector3; to: Vector3 }
  | { type: 'projectileGone'; projectile: Projectile };

let nextProjectileId = 1;

/** Thrown splash potion or ender pearl. */
export class Projectile {
  readonly id = nextProjectileId++;
  readonly pos = new Vector3();
  readonly prevPos = new Vector3();
  readonly vel = new Vector3();
  age = 0;
  alive = true;
  constructor(
    readonly kind: 'heal_pot' | 'pearl',
    readonly owner: Fighter,
  ) {}
}

/**
 * Pure gameplay simulation: fixed timestep, no rendering, no DOM.
 * Everything the renderer/audio need is emitted as events.
 */
export class Simulation {
  readonly world: VoxelWorld;
  readonly fighters: Fighter[] = [];
  readonly events: SimEvent[] = [];
  readonly projectiles: Projectile[] = [];
  readonly rng: Rng;
  time = 0;
  tick = 0;

  constructor(world: VoxelWorld, seed = 1337) {
    this.world = world;
    this.rng = new Rng(seed);
  }

  add(f: Fighter): Fighter {
    this.fighters.push(f);
    return f;
  }

  remove(f: Fighter): void {
    const i = this.fighters.indexOf(f);
    if (i >= 0) this.fighters.splice(i, 1);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  /** Advance one fixed tick. `commands` maps fighter id → command for this tick. */
  step(commands: Map<number, FighterCommand>): void {
    const dt = C.SIM_DT;
    this.time += dt;
    this.tick++;

    for (const f of this.fighters) {
      f.prevPos.copy(f.pos);
      f.prevYaw = f.yaw;
      f.prevPitch = f.pitch;
    }

    for (const f of this.fighters) {
      const cmd = commands.get(f.id);
      if (!f.alive || !cmd) {
        if (!f.alive) continue;
        this.integrate(f, null, dt);
        continue;
      }
      this.applyIntent(f, cmd, dt);
      this.integrate(f, cmd, dt);
    }

    this.separate();

    for (const f of this.fighters) {
      const cmd = commands.get(f.id);
      if (f.alive && cmd && cmd.attacks > 0) this.processAttacks(f, cmd.attacks);
    }

    this.stepProjectiles(dt);
    for (const f of this.fighters) this.updateTimers(f, dt);
  }

  private throwItem(f: Fighter, kind: 'heal_pot' | 'pearl'): void {
    const stack = f.heldItem();
    if (!stack) return;
    stack.count--;
    if (stack.count <= 0) f.inventory[f.selected] = null;
    f.throwCooldown = C.THROW_COOLDOWN;
    f.swingTime = 0;
    const p = new Projectile(kind, f);
    f.eye(p.pos);
    // Potions are thrown a little above the crosshair; pearls straight.
    const pitch = kind === 'heal_pot' ? Math.min(Math.PI / 2, f.pitch + C.POT_PITCH_OFFSET) : f.pitch;
    const cp = Math.cos(pitch);
    const speed = kind === 'heal_pot' ? C.POT_SPEED : C.PEARL_SPEED;
    p.vel.set(-Math.sin(f.yaw) * cp * speed, Math.sin(pitch) * speed, -Math.cos(f.yaw) * cp * speed);
    p.pos.addScaledVector(p.vel, 0.02);
    p.prevPos.copy(p.pos);
    if (kind === 'pearl') f.pearlCooldown = C.PEARL_COOLDOWN;
    else f.potsThrown++;
    this.projectiles.push(p);
    this.emit({ type: 'throw', fighter: f, projectile: p });
  }

  private stepProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.prevPos.copy(p.pos);
      p.age += dt;
      const g = p.kind === 'heal_pot' ? C.POT_GRAVITY : C.PEARL_GRAVITY;
      p.vel.y -= g * dt;
      const drag = Math.pow(0.99, dt * 20);
      p.vel.multiplyScalar(drag);
      const step = p.vel.length() * dt;
      const dir = p.vel.clone().normalize();
      // world
      let hitT = this.world.raycast(p.pos.x, p.pos.y, p.pos.z, dir.x, dir.y, dir.z, step);
      let hitFighter: Fighter | null = null;
      // fighters (skip the thrower briefly)
      for (const f of this.fighters) {
        if (!f.alive || (f === p.owner && p.age < 0.25)) continue;
        const t = f.box().expand(0.15).rayHit(p.pos.x, p.pos.y, p.pos.z, dir.x, dir.y, dir.z);
        if (t >= 0 && t <= step && t < hitT) {
          hitT = t;
          hitFighter = f;
        }
      }
      if (hitT <= step) {
        p.pos.addScaledVector(dir, Math.max(0, hitT - 0.05));
        this.impact(p, hitFighter);
      } else {
        p.pos.addScaledVector(dir, step);
        if (p.pos.y < C.VOID_Y - 2) {
          p.alive = false;
          this.emit({ type: 'projectileGone', projectile: p });
        }
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (!this.projectiles[i].alive) this.projectiles.splice(i, 1);
  }

  private impact(p: Projectile, direct: Fighter | null): void {
    p.alive = false;
    if (p.kind === 'heal_pot') {
      const healed: { fighter: Fighter; amount: number }[] = [];
      for (const f of this.fighters) {
        if (!f.alive) continue;
        // Classic splash: effectiveness falls off with distance to the feet.
        const d = f.pos.distanceTo(p.pos);
        if (d > C.POT_RADIUS && f !== direct) continue;
        const eff = f === direct ? 1 : 1 - d / C.POT_RADIUS;
        const amount = Math.max(0, C.POT_HEAL * eff);
        if (amount <= 0) continue;
        f.health = Math.min(C.MAX_HEALTH, f.health + amount);
        healed.push({ fighter: f, amount });
      }
      this.emit({ type: 'splash', projectile: p, point: p.pos.clone(), healed });
    } else {
      const f = p.owner;
      if (!f.alive) return;
      const from = f.pos.clone();
      // land on top of whatever we hit, never inside a block
      const to = p.pos.clone();
      to.y = Math.max(to.y - 0.2, this.world.groundHeight(to.x, to.z, to.y + 0.5));
      const box = f.box();
      box.offset(to.x - f.pos.x, to.y - f.pos.y, to.z - f.pos.z);
      if (this.world.intersects(box)) to.y = Math.ceil(to.y);
      f.pos.copy(to);
      f.prevPos.copy(to);
      f.vel.set(0, 0, 0);
      f.fallStartY = to.y;
      f.health -= C.PEARL_DAMAGE;
      f.stats.damageTaken += C.PEARL_DAMAGE;
      this.emit({ type: 'pearl', fighter: f, from, to: to.clone() });
      if (f.health <= 0) this.kill(f, f.lastDamagedBy, 'combat');
    }
    this.emit({ type: 'projectileGone', projectile: p });
  }

  private applyIntent(f: Fighter, c: FighterCommand, dt: number): void {
    f.yaw = c.yaw;
    f.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, c.pitch));

    if (c.slot >= 0 && f.selectSlot(c.slot)) this.emit({ type: 'slot', fighter: f, slot: c.slot });

    // Crouch (with headroom check when standing back up).
    if (c.crouch) f.crouching = true;
    else if (f.crouching) {
      const standBox = f.box();
      standBox.maxY = standBox.minY + C.PLAYER_HEIGHT;
      if (!this.world.intersects(standBox)) f.crouching = false;
    }

    // Use (block / eat / drink / throw)
    const def = f.heldDef();
    const stack = f.heldItem();
    f.blocking = false;
    if (c.use && def && stack) {
      if (def.kind === 'weapon' && def.canBlock && c.attacks === 0) {
        f.blocking = true;
      } else if (def.kind === 'consumable' && stack.count > 0) {
        const before = f.eating;
        f.eating += dt;
        if (Math.floor(before / 0.22) !== Math.floor(f.eating / 0.22))
          this.emit({ type: 'eat', fighter: f, progress: f.eating / C.EAT_TIME });
        if (f.eating >= C.EAT_TIME) this.consume(f);
      } else if (def.kind === 'throwable' && f.throwCooldown <= 0) {
        if (stack.id === 'heal_pot') this.throwItem(f, 'heal_pot');
        else if (stack.id === 'pearl' && f.pearlCooldown <= 0) this.throwItem(f, 'pearl');
      }
    } else {
      f.eating = 0;
    }

    // Sprint. A sprint hit locks sprint until forward or the sprint key is released:
    // that is the W-tap / S-tap skill.
    const forwardHeld = c.forward > 0.3;
    if (!forwardHeld || !c.sprint) {
      if (f.sprintLock) this.emit({ type: 'sprintReset', fighter: f });
      f.sprintLock = false;
    }
    const canSprint =
      c.sprint && forwardHeld && !f.crouching && !f.blocking && f.eating === 0 && !f.sprintLock;
    f.sprinting = canSprint;
    f.lastForward = c.forward;

    // Jump buffer — holding jump bunny-hops like classic PvP.
    if (c.jump) f.jumpBuffer = C.JUMP_BUFFER;
  }

  private integrate(f: Fighter, c: FighterCommand | null, dt: number): void {
    let fwd = 0;
    let str = 0;
    if (c) {
      fwd = c.forward;
      str = c.strafe;
    }
    const sy = Math.sin(f.yaw);
    const cy = Math.cos(f.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    let wx = -sy * fwd + cy * str;
    let wz = -cy * fwd - sy * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    let speed = f.sprinting
      ? C.SPRINT_SPEED
      : f.crouching
        ? C.CROUCH_SPEED
        : f.blocking
          ? C.BLOCK_SPEED
          : f.eating > 0
            ? C.EAT_SPEED
            : C.PLAYER_SPEED;
    if (fwd < 0) speed *= C.BACKPEDAL_FACTOR;
    if (f.speedEffect > 0) speed *= C.SPEED_EFFECT_MULT;
    if (Math.abs(str) > 0.1 && Math.abs(fwd) < 0.1) speed *= C.STRAFE_SPEED_FACTOR;
    const tx = wx * speed;
    const tz = wz * speed;
    const hasWish = wl > 0.01;
    const control = f.hitstun > 0 ? C.HITSTUN_CONTROL : 1;

    if (f.onGround) {
      const rate = (hasWish ? C.GROUND_ACCEL : C.GROUND_FRICTION) * (f.hitstun > 0 ? 0.55 : 1);
      const k = 1 - Math.exp(-rate * dt);
      f.vel.x += (tx - f.vel.x) * k;
      f.vel.z += (tz - f.vel.z) * k;
    } else {
      // Air: constant drag plus a small linear push (classic 0.91/tick drag,
      // ~0.02 b/t² accel). Knockback carries; you can't instantly fight it.
      const drag = Math.exp(-C.AIR_DRAG * dt);
      f.vel.x *= drag;
      f.vel.z *= drag;
      if (hasWish) {
        const acc = (f.sprinting ? C.AIR_ACCEL_SPRINT : C.AIR_ACCEL) * (f.speedEffect > 0 ? C.SPEED_EFFECT_MULT : 1) * control * dt;
        f.vel.x += wx * acc;
        f.vel.z += wz * acc;
      }
    }

    // Jump
    if (f.jumpBuffer > 0 && (f.onGround || f.coyote > 0) && f.jumpCooldown <= 0) {
      f.vel.y = C.JUMP_FORCE;
      if (f.sprinting) {
        const before = Math.hypot(f.vel.x, f.vel.z);
        f.vel.x += -sy * C.SPRINT_JUMP_BOOST;
        f.vel.z += -cy * C.SPRINT_JUMP_BOOST;
        const after = Math.hypot(f.vel.x, f.vel.z);
        const cap = Math.max(before, C.MAX_SPRINT_JUMP_SPEED);
        if (after > cap) {
          f.vel.x *= cap / after;
          f.vel.z *= cap / after;
        }
      }
      f.onGround = false;
      f.coyote = 0;
      f.jumpBuffer = 0;
      f.jumpCooldown = C.JUMP_COOLDOWN;
      this.emit({ type: 'jump', fighter: f, sprint: f.sprinting });
    }

    f.vel.y -= C.GRAVITY * dt;
    if (f.vel.y < -C.TERMINAL_VELOCITY) f.vel.y = -C.TERMINAL_VELOCITY;

    const box = f.box();
    const vyBefore = f.vel.y;
    const wasGround = f.onGround;
    const r = moveBox(
      this.world,
      box,
      f.vel.x * dt,
      f.vel.y * dt,
      f.vel.z * dt,
      wasGround ? C.STEP_HEIGHT : 0,
      f.crouching,
      wasGround,
    );
    f.pos.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
    if (r.hitX) f.vel.x = 0;
    if (r.hitZ) f.vel.z = 0;
    if (r.onGround || r.hitCeiling) f.vel.y = 0;

    if (r.onGround && !wasGround) {
      this.emit({ type: 'land', fighter: f, speed: -vyBefore });
    }
    if (!r.onGround && wasGround && f.vel.y <= 0) f.coyote = C.COYOTE_TIME;
    f.onGround = r.onGround;
    if (f.onGround) {
      f.airTime = 0;
      const moved = Math.hypot(r.dx, r.dz);
      f.stepDist += moved;
      const stride = f.sprinting ? 2.35 : 1.95;
      if (f.stepDist > stride) {
        f.stepDist = 0;
        const under = this.world.get(Math.floor(f.pos.x), Math.floor(f.pos.y - 0.05), Math.floor(f.pos.z));
        this.emit({ type: 'step', fighter: f, sprint: f.sprinting, surface: under });
      }
    } else {
      f.airTime += dt;
    }

    if (f.pos.y < C.VOID_Y) {
      const killer = this.time - f.lastDamagedAt < 8 ? f.lastDamagedBy : null;
      this.kill(f, killer, 'void');
    }
  }

  /** Soft push so fighters can't stand inside each other. */
  private separate(): void {
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++)
      for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i];
        const b = fs[j];
        if (!a.alive || !b.alive) continue;
        if (Math.abs(a.pos.y - b.pos.y) > C.PLAYER_HEIGHT) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = C.PLAYER_WIDTH * 0.95;
        if (d < min) {
          const nx = d > 1e-4 ? dx / d : 1;
          const nz = d > 1e-4 ? dz / d : 0;
          const push = (min - d) * 0.5;
          this.nudge(a, -nx * push, -nz * push);
          this.nudge(b, nx * push, nz * push);
        }
      }
  }

  private nudge(f: Fighter, dx: number, dz: number): void {
    const box = f.box();
    const r = moveBox(this.world, box, dx, 0, dz, 0, false, false);
    f.pos.x += r.dx;
    f.pos.z += r.dz;
  }

  private processAttacks(f: Fighter, clicks: number): void {
    for (let n = 0; n < clicks; n++) {
      if (f.swingCooldown > 0) break;
      const def = f.heldDef();
      const weapon = def && def.kind === 'weapon' ? def : null;
      f.eating = 0;
      f.blocking = false;
      f.swingCooldown = weapon?.swingCooldown ?? C.ATTACK_COOLDOWN;
      f.swingTime = 0;
      f.stats.swings++;
      this.emit({ type: 'swing', fighter: f, weapon: weapon?.id ?? 'fist' });
      if (f.passive) continue;
      resolveAttack(this, f, weapon);
    }
  }

  private consume(f: Fighter): void {
    const stack = f.heldItem();
    f.eating = 0;
    if (!stack) return;
    stack.count--;
    if (stack.count <= 0) f.inventory[f.selected] = null;
    if (stack.id === 'speed_pot') f.speedEffect = C.SPEED_EFFECT_TIME;
    if (stack.id === 'gapple') {
      f.health = Math.min(C.MAX_HEALTH, f.health + C.GAPPLE_HEAL);
      f.absorption = Math.max(f.absorption, C.GAPPLE_ABSORB);
      f.regenLeft = C.GAPPLE_REGEN;
    }
    this.emit({ type: 'eatDone', fighter: f });
  }

  private updateTimers(f: Fighter, dt: number): void {
    f.swingTime += dt;
    if (f.swingCooldown > 0) f.swingCooldown -= dt;
    if (f.hurtTimer > 0) f.hurtTimer -= dt;
    if (f.hitstun > 0) f.hitstun -= dt;
    if (f.jumpBuffer > 0) f.jumpBuffer -= dt;
    if (f.jumpCooldown > 0) f.jumpCooldown -= dt;
    if (f.throwCooldown > 0) f.throwCooldown -= dt;
    if (f.pearlCooldown > 0) f.pearlCooldown -= dt;
    if (f.speedEffect > 0) f.speedEffect -= dt;
    if (f.coyote > 0 && !f.onGround) f.coyote -= dt;
    if (f.alive && f.regenLeft > 0) {
      const h = Math.min(f.regenLeft, (C.GAPPLE_REGEN / C.GAPPLE_REGEN_TIME) * dt);
      f.regenLeft -= h;
      f.health = Math.min(C.MAX_HEALTH, f.health + h);
    }
    if (f.combo > 0 && f.comboTarget) {
      const t = f.comboTarget;
      const far = t.pos.distanceTo(f.pos) > C.COMBO_BREAK_DISTANCE;
      if (this.time - f.lastComboHitAt > C.COMBO_TIMEOUT || far || !t.alive) {
        if (f.combo >= 2) this.emit({ type: 'comboBreak', fighter: f, combo: f.combo });
        f.combo = 0;
        f.comboTarget = null;
      }
    }
  }

  kill(victim: Fighter, killer: Fighter | null, cause: 'combat' | 'void'): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.health = 0;
    victim.deathTime = this.time;
    victim.sprinting = false;
    victim.blocking = false;
    victim.eating = 0;
    victim.stats.deaths++;
    if (killer && killer !== victim) killer.stats.kills++;
    this.emit({ type: 'death', victim, killer, cause });
  }
}
