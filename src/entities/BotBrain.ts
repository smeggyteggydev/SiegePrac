import * as C from '../config/constants';
import { Fighter, type FighterCommand, emptyCommand } from './Fighter';
import type { Simulation } from '../game/Simulation';
import type { NavGrid } from '../game/NavGrid';
import { Rng } from '../utils/rng';
import { angleDiff, clamp, yawTo } from '../utils/math';

export type BotDifficulty = 'easy' | 'normal' | 'hard' | 'siege';

export interface BotProfile {
  label: string;
  /** Perception delay (s): the bot reacts to where you *were*. */
  reaction: number;
  /** Max turn rate (rad/s). */
  aimSpeed: number;
  /** Tracking responsiveness (1/s). */
  aimSnap: number;
  /** Standard deviation of aim wander (rad). */
  aimError: number;
  /** How much the bot extrapolates your velocity (s). */
  lead: number;
  cps: number;
  cpsJitter: number;
  /** 0..1 — how intelligently it strafes / counter-strafes. */
  strafeSkill: number;
  strafeSwitch: [number, number];
  /** Probability it sprint-resets after landing a sprint hit. */
  wtap: number;
  /** Probability a reset is an S-tap rather than a W-tap. */
  stap: number;
  /** Ideal distance to hold while trading (m). */
  range: number;
  /** 0..1 — how hard it chases to extend combos. */
  comboFocus: number;
  retreatHealth: number;
  jumpChance: number;
  critChance: number;
  blockChance: number;
  /** Chance per second of a deliberate mistake (whiff streak, wrong strafe, overrun). */
  mistakeRate: number;
  /** Learns the player's strafe rhythm. */
  adaptive: boolean;
  /** NoDebuff: health at which it pots. */
  potHealth: number;
}

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: {
    label: 'EASY',
    reaction: 0.3,
    aimSpeed: 5.5,
    aimSnap: 6,
    aimError: 0.11,
    lead: 0,
    cps: 5.5,
    cpsJitter: 1.5,
    strafeSkill: 0.2,
    strafeSwitch: [0.9, 2.2],
    wtap: 0.08,
    stap: 0,
    range: 2.1,
    comboFocus: 0.2,
    retreatHealth: 0,
    jumpChance: 0.35,
    critChance: 0.05,
    blockChance: 0,
    mistakeRate: 0.35,
    adaptive: false,
    potHealth: 7,
  },
  normal: {
    label: 'NORMAL',
    reaction: 0.2,
    aimSpeed: 9,
    aimSnap: 11,
    aimError: 0.07,
    lead: 0.06,
    cps: 7.5,
    cpsJitter: 2,
    strafeSkill: 0.55,
    strafeSwitch: [0.45, 1.3],
    wtap: 0.4,
    stap: 0.25,
    range: 2.65,
    comboFocus: 0.5,
    retreatHealth: 6,
    jumpChance: 0.15,
    critChance: 0.2,
    blockChance: 0.1,
    mistakeRate: 0.18,
    adaptive: false,
    potHealth: 9,
  },
  hard: {
    label: 'HARD',
    reaction: 0.115,
    aimSpeed: 16,
    aimSnap: 17,
    aimError: 0.032,
    lead: 0.1,
    cps: 11,
    cpsJitter: 2,
    strafeSkill: 0.85,
    strafeSwitch: [0.3, 0.95],
    wtap: 0.82,
    stap: 0.35,
    range: 2.85,
    comboFocus: 0.85,
    retreatHealth: 7,
    jumpChance: 0.08,
    critChance: 0.35,
    blockChance: 0.2,
    mistakeRate: 0.05,
    adaptive: false,
    potHealth: 11,
  },
  siege: {
    label: 'SIEGE',
    reaction: 0.1,
    aimSpeed: 18,
    aimSnap: 18,
    aimError: 0.028,
    lead: 0.12,
    cps: 12,
    cpsJitter: 1.8,
    strafeSkill: 0.95,
    strafeSwitch: [0.25, 0.85],
    wtap: 0.9,
    stap: 0.4,
    range: 2.9,
    comboFocus: 0.95,
    retreatHealth: 7,
    jumpChance: 0.06,
    critChance: 0.4,
    blockChance: 0.22,
    mistakeRate: 0.035,
    adaptive: true,
    potHealth: 12,
  },
};

export type BotBehavior = 'fight' | 'aimTarget' | 'comboDummy' | 'idle';

interface Snapshot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  hurt: number;
  hitstun: number;
  combo: number;
  onGround: boolean;
  alive: boolean;
  swingTime: number;
}

type Mode = 'approach' | 'engage' | 'retreat' | 'heal';

const BUF = 64;

/** Learns how long the player tends to hold a strafe direction. */
class StrafeModel {
  lastSign = 0;
  holdStart = 0;
  avgHold = 0.8;
  leftBias = 0.5;
  samples = 0;

  observe(lateral: number, t: number) {
    const s = Math.abs(lateral) < 1.2 ? 0 : Math.sign(lateral);
    if (s !== 0 && s !== this.lastSign) {
      if (this.lastSign !== 0) {
        const held = t - this.holdStart;
        if (held > 0.08 && held < 4) {
          this.avgHold = this.avgHold * 0.85 + held * 0.15;
          this.samples++;
        }
      }
      this.leftBias = this.leftBias * 0.9 + (s < 0 ? 0.1 : 0);
      this.lastSign = s;
      this.holdStart = t;
    }
  }

  /** Expected lateral sign a short time ahead, blending in a likely switch. */
  predictSwitchSoon(t: number, horizon: number): boolean {
    if (this.samples < 3 || this.lastSign === 0) return false;
    return t - this.holdStart + horizon > this.avgHold;
  }
}

/**
 * Practice bot AI. Produces the same FighterCommand a human would, reading the
 * world through a reaction-time delay, and aims with a rate-limited, noisy
 * "mouse" — so its hits land (or miss) through the exact same hit detection.
 */
export class BotBrain {
  readonly bot: Fighter;
  target: Fighter | null = null;
  profile: BotProfile;
  behavior: BotBehavior = 'fight';
  private sim: Simulation;
  private nav: NavGrid;
  private rng: Rng;

  private buf: Snapshot[] = [];
  private bufHead = 0;
  private mode: Mode = 'approach';
  private modeTime = 0;

  private yaw = 0;
  private pitch = 0;
  private noiseYaw = 0;
  private noisePitch = 0;

  private strafeDir = 1;
  private strafeTimer = 0;
  private nextClick = 0;
  private wtapTimer = 0;
  private wtapBack = false;
  private prevLock = false;
  private lockTime = 0;
  private blockTimer = 0;
  private mistakeTimer = 0;
  private mistakeKind: 'whiff' | 'overrun' | 'freeze' | null = null;
  private stuckTime = 0;
  private path: { x: number; z: number; y: number }[] | null = null;
  private pathTimer = 0;
  private weaveT = 0;
  private strafeModel = new StrafeModel();
  private approachJumpCd = 0;
  private potting = false;
  private potStart = 0;
  private lastPot = -10;
  private potsBefore = 0;
  private refillTimer = 0;

  constructor(bot: Fighter, sim: Simulation, nav: NavGrid, profile: BotProfile, seed = 7) {
    this.bot = bot;
    this.sim = sim;
    this.nav = nav;
    this.profile = profile;
    this.rng = new Rng(seed);
    this.yaw = bot.yaw;
    this.strafeDir = this.rng.sign();
  }

  reset(): void {
    this.buf = [];
    this.bufHead = 0;
    this.mode = 'approach';
    this.modeTime = 0;
    this.yaw = this.bot.yaw;
    this.pitch = 0;
    this.noiseYaw = this.noisePitch = 0;
    this.wtapTimer = 0;
    this.blockTimer = 0;
    this.mistakeKind = null;
    this.path = null;
    this.prevLock = false;
    this.potting = false;
    this.refillTimer = 0;
  }

  private record(): void {
    const t = this.target;
    if (!t) return;
    const s: Snapshot = {
      x: t.pos.x,
      y: t.pos.y,
      z: t.pos.z,
      vx: t.vel.x,
      vy: t.vel.y,
      vz: t.vel.z,
      yaw: t.yaw,
      hurt: t.hurtTimer,
      hitstun: t.hitstun,
      combo: t.combo,
      onGround: t.onGround,
      alive: t.alive,
      swingTime: t.swingTime,
    };
    if (this.buf.length < BUF) this.buf.push(s);
    else this.buf[this.bufHead] = s;
    this.bufHead = (this.bufHead + 1) % BUF;
  }

  /** The target as the bot perceives it: `reaction` seconds in the past. */
  private perceived(): Snapshot | null {
    if (this.buf.length === 0) return null;
    const delayTicks = Math.min(this.buf.length - 1, Math.round(this.profile.reaction * C.SIM_HZ));
    const newest = (this.bufHead - 1 + this.buf.length) % this.buf.length;
    const idx = this.buf.length < BUF ? this.buf.length - 1 - delayTicks : (newest - delayTicks + BUF) % BUF;
    return this.buf[Math.max(0, idx)];
  }

  private gauss(): number {
    const u = Math.max(1e-6, this.rng.next());
    const v = this.rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  update(dt: number): FighterCommand {
    const cmd = emptyCommand();
    const b = this.bot;
    this.record();
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    if (!b.alive || !this.target || this.behavior === 'idle') return cmd;
    const p = this.profile;
    const snap = this.perceived();
    if (!snap || !snap.alive) {
      cmd.yaw = this.yaw;
      return cmd;
    }
    this.modeTime += dt;
    this.weaveT += dt;

    // ── Perception ────────────────────────────────────────────────────────
    const lookAhead = p.reaction * 0.7 + p.lead;
    let px = snap.x + snap.vx * lookAhead;
    let pz = snap.z + snap.vz * lookAhead;
    const py = snap.y + Math.max(-0.4, Math.min(0.6, snap.vy * lookAhead * 0.5));
    const dx = snap.x - b.pos.x;
    const dz = snap.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    const nx = dist > 1e-3 ? dx / dist : 0;
    const nz = dist > 1e-3 ? dz / dist : 1;
    // Target's lateral speed relative to the line between us (+ = moving to our right).
    const lateral = snap.vx * -nz + snap.vz * nx;
    const rightX = -nz;
    const rightZ = nx;

    if (p.adaptive) {
      this.strafeModel.observe(lateral, this.sim.time);
      if (this.strafeModel.predictSwitchSoon(this.sim.time, lookAhead + 0.1)) {
        // Anticipate the reversal: pull our lead back toward the other side.
        px -= rightX * lateral * lookAhead * 1.6;
        pz -= rightZ * lateral * lookAhead * 1.6;
      }
    }

    // ── Mistakes ──────────────────────────────────────────────────────────
    if (this.mistakeTimer > 0) {
      this.mistakeTimer -= dt;
      if (this.mistakeTimer <= 0) this.mistakeKind = null;
    } else if (this.behavior === 'fight' && this.rng.chance(p.mistakeRate * dt)) {
      const r = this.rng.next();
      this.mistakeKind = r < 0.45 ? 'whiff' : r < 0.8 ? 'overrun' : 'freeze';
      this.mistakeTimer = this.mistakeKind === 'freeze' ? this.rng.range(0.12, 0.3) : this.rng.range(0.25, 0.6);
      if (this.mistakeKind === 'overrun') this.strafeDir = -this.strafeDir;
    }

    // ── Mode selection ────────────────────────────────────────────────────
    const hasGapple = b.inventory.some((s) => s?.id === 'gapple');
    const beingComboed = snap.combo >= 2 && b.hitstun > 0;
    if (this.behavior === 'fight') {
      switch (this.mode) {
        case 'approach':
          if (dist < 5.2 && Math.abs(snap.y - b.pos.y) < 1.6) this.setMode('engage');
          break;
        case 'engage':
          if (dist > 7 || Math.abs(snap.y - b.pos.y) > 2.2) this.setMode('approach');
          else if (
            p.retreatHealth > 0 &&
            b.health < p.retreatHealth &&
            hasGapple &&
            this.target.health > b.health + 1 &&
            this.modeTime > 1.5 &&
            this.rng.chance(1.5 * dt)
          )
            this.setMode('retreat');
          break;
        case 'retreat':
          if (dist > 8.5) this.setMode('heal');
          else if ((dist < 2.4 && this.modeTime > 1.2) || this.modeTime > 5) this.setMode('engage');
          break;
        case 'heal':
          if (!hasGapple || b.health >= C.MAX_HEALTH - 2 || (dist < 3.6 && b.eating < C.EAT_TIME * 0.7))
            this.setMode(dist < 5 ? 'engage' : 'approach');
          break;
      }
    }

    // ── Aim ───────────────────────────────────────────────────────────────
    const eyeY = b.pos.y + b.eyeHeight;
    const aimY = py + 1.15;
    let wantYaw = yawTo(b.pos.x, b.pos.z, px, pz);
    let wantPitch = Math.atan2(aimY - eyeY, Math.max(0.4, Math.hypot(px - b.pos.x, pz - b.pos.z)));
    const angVel = Math.abs(lateral) / Math.max(1.5, dist);
    const sigma = p.aimError * (1 + angVel * 0.9) * (b.hitstun > 0 ? 1.8 : 1);
    const tau = 0.25;
    this.noiseYaw += (-this.noiseYaw / tau) * dt + sigma * Math.sqrt((2 * dt) / tau) * this.gauss();
    this.noisePitch += (-this.noisePitch / tau) * dt + sigma * 0.6 * Math.sqrt((2 * dt) / tau) * this.gauss();

    let lookAtTarget = true;
    let moveYaw = wantYaw;
    if (this.mode === 'retreat') {
      lookAtTarget = false;
      moveYaw = this.retreatYaw(snap);
      wantYaw = moveYaw;
      wantPitch = -0.1;
    }
    if (this.mode === 'approach' && !this.directWalk(snap)) {
      const wp = this.followPath(snap, dt);
      if (wp) {
        moveYaw = yawTo(b.pos.x, b.pos.z, wp.x, wp.z);
        if (dist > 6) {
          wantYaw = moveYaw;
          wantPitch = 0;
          lookAtTarget = false;
        }
        if (wp.y - b.pos.y > 0.6 && b.onGround) cmd.jump = true;
      }
    } else {
      this.path = null;
    }

    wantYaw += this.noiseYaw;
    wantPitch += this.noisePitch;
    const eYaw = angleDiff(this.yaw, wantYaw);
    const maxTurn = p.aimSpeed * dt * (this.mistakeKind === 'freeze' ? 0.2 : 1);
    const k = 1 - Math.exp(-p.aimSnap * dt);
    this.yaw += clamp(eYaw * k, -maxTurn, maxTurn);
    this.pitch += clamp((wantPitch - this.pitch) * k, -maxTurn, maxTurn);
    this.pitch = clamp(this.pitch, -1.4, 1.4);
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;

    // Movement is expressed relative to our facing.
    const moveRel = angleDiff(this.yaw, moveYaw);
    let fwd = 0;
    let str = 0;
    let sprint = true;

    if (this.behavior === 'aimTarget') {
      return this.aimDrill(cmd, dist, dt);
    }
    if (this.behavior === 'comboDummy') {
      return this.comboDummy(cmd, dist, dt);
    }

    switch (this.mode) {
      case 'approach': {
        fwd = Math.cos(moveRel);
        str = -Math.sin(moveRel);
        if (dist < 11 && lookAtTarget && p.strafeSkill > 0.3) {
          // Weave on approach so we're not a free first hit.
          str += Math.sin(this.weaveT * (2.2 + p.strafeSkill)) * 0.6 * p.strafeSkill;
        }
        this.approachJumpCd -= dt;
        if (dist > 7.5 && b.onGround && b.sprinting && Math.abs(moveRel) < 0.3 && this.approachJumpCd <= 0) {
          if (this.rng.chance(0.5)) cmd.jump = true;
          this.approachJumpCd = this.rng.range(0.6, 1.4);
        }
        break;
      }
      case 'engage': {
        const range = p.range + (this.mistakeKind === 'overrun' ? -1.4 : 0);
        // Spacing: push in when out of range, hold or back off when too close.
        if (snap.hurt > 0.1 && this.rng.next() < p.comboFocus + 0.15) {
          // Combo spacing: don't run into them during their hit window —
          // hover just outside reach, re-enter as it ends.
          fwd = dist > C.ATTACK_RANGE + 0.3 ? 1 : dist < range - 0.9 ? -1 : 0;
        } else if (dist > range + 0.25) fwd = 1;
        else if (dist < range - 0.9) {
          fwd = -1;
          sprint = false;
        } else fwd = 1;

        // Strafing
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeTimer = this.rng.range(p.strafeSwitch[0], p.strafeSwitch[1]);
          if (this.rng.chance(0.65)) this.strafeDir = -this.strafeDir;
        }
        if (Math.abs(lateral) > 1.8 && this.rng.chance(p.strafeSkill * 2 * dt)) {
          // Mirror the opponent's strafe so they have to track us harder.
          this.strafeDir = Math.sign(lateral);
        }
        str = this.strafeDir * (0.55 + 0.45 * p.strafeSkill);

        if (beingComboed) {
          // Escape: strafe hard, and sometimes block to soften the combo.
          str = this.strafeDir;
          if (this.blockTimer <= 0 && this.rng.chance(p.blockChance * 6 * dt)) this.blockTimer = this.rng.range(0.12, 0.3);
        }

        // Sprint reset after a sprint hit.
        if (b.sprintLock && !this.prevLock) {
          this.lockTime = 0;
          if (this.rng.chance(p.wtap)) {
            this.wtapTimer = this.rng.range(0.06, 0.13) + (this.mistakeKind ? 0.1 : 0);
            this.wtapBack = this.rng.chance(p.stap);
          }
        }
        if (b.sprintLock) {
          this.lockTime += dt;
          // Sloppy players eventually let go of W anyway.
          if (this.lockTime > 0.5 && this.wtapTimer <= 0 && this.rng.chance(2 * dt)) this.wtapTimer = 0.1;
        }
        if (this.wtapTimer > 0) {
          this.wtapTimer -= dt;
          fwd = this.wtapBack ? -1 : 0;
        }

        // Crit attempt: hop while they're stunned so we come down on them.
        if (
          b.onGround &&
          snap.hitstun > 0.15 &&
          dist < 3.4 &&
          dist > 1.6 &&
          this.rng.chance(p.critChance * 4 * dt)
        )
          cmd.jump = true;
        else if (b.onGround && this.rng.chance(p.jumpChance * dt)) cmd.jump = true;
        break;
      }
      case 'retreat': {
        fwd = 1;
        str = Math.sin(this.weaveT * 3) * 0.5;
        break;
      }
      case 'heal': {
        fwd = dist < 6 ? -1 : 0;
        str = this.strafeDir * 0.6;
        sprint = false;
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeTimer = this.rng.range(0.6, 1.4);
          this.strafeDir = -this.strafeDir;
        }
        break;
      }
    }

    // ── Hazard avoidance: never walk off into the lake ───────────────────
    [fwd, str] = this.avoidHazards(fwd, str);

    // ── Stuck: jump over small obstacles ─────────────────────────────────
    const moving = Math.abs(fwd) + Math.abs(str) > 0.3;
    if (moving && b.onGround && b.horizontalSpeed() < 0.6) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 0.25) {
      cmd.jump = true;
      this.stuckTime = 0;
      this.strafeDir = -this.strafeDir;
    }

    cmd.forward = clamp(fwd, -1, 1);
    cmd.strafe = clamp(str, -1, 1);
    cmd.sprint = sprint;

    // ── NoDebuff: pot, refill, speed ─────────────────────────────────────
    const nd = this.noDebuff(cmd, snap, dist, dt);
    if (nd) {
      this.prevLock = b.sprintLock;
      return nd;
    }

    // ── Items ────────────────────────────────────────────────────────────
    const gappleSlot = b.inventory.findIndex((s, i) => i < 9 && s?.id === 'gapple');
    const swordSlot = b.inventory.findIndex((s, i) => i < 9 && s?.id === 'sword');
    if (this.mode === 'heal' && gappleSlot >= 0) {
      if (b.selected !== gappleSlot) cmd.slot = gappleSlot;
      else cmd.use = true;
      return cmd;
    }
    if (swordSlot >= 0 && b.selected !== swordSlot) cmd.slot = swordSlot;

    // ── Attacking ─────────────────────────────────────────────────────────
    if (this.blockTimer > 0) {
      this.blockTimer -= dt;
      cmd.use = true;
    }
    const reachy = dist < C.ATTACK_RANGE + 0.7 && Math.abs(snap.y - b.pos.y) < 2.5;
    const aimed = Math.abs(angleDiff(this.yaw, yawTo(b.pos.x, b.pos.z, snap.x, snap.z))) < 0.55;
    if (reachy && aimed && lookAtTarget && this.mistakeKind !== 'whiff' && this.sim.time >= this.nextClick) {
      cmd.attacks = 1;
      cmd.use = false;
      const rate = Math.max(2, p.cps + this.gauss() * p.cpsJitter);
      this.nextClick = this.sim.time + 1 / rate;
    }
    this.prevLock = b.sprintLock;
    return cmd;
  }

  private hotbarSlot(id: string): number {
    return this.bot.inventory.findIndex((s, i) => i < 9 && s?.id === id);
  }

  /** Returns a command when NoDebuff logic takes over this tick. */
  private noDebuff(cmd: FighterCommand, snap: Snapshot, dist: number, dt: number): FighterCommand | null {
    const b = this.bot;
    const p = this.profile;
    const pots = b.count('heal_pot');
    if (pots === 0 && b.count('speed_pot') === 0) return null;
    const now = this.sim.time;

    // Refill: pull pots from storage into empty hotbar slots (takes a moment, like a real player).
    if (this.refillTimer > 0) {
      this.refillTimer -= dt;
      if (this.refillTimer <= 0) {
        for (let h = 0; h < 9; h++) {
          if (b.inventory[h]) continue;
          const from = b.inventory.findIndex((s, i) => i >= 9 && s?.id === 'heal_pot');
          if (from < 0) break;
          b.inventory[h] = b.inventory[from];
          b.inventory[from] = null;
        }
      }
      return this.runAway(cmd, snap, false);
    }

    const wantPot = pots > 0 && (this.potting || (b.health <= p.potHealth && now - this.lastPot > 0.55));
    if (wantPot) {
      const slot = this.hotbarSlot('heal_pot');
      if (slot < 0) {
        this.refillTimer = 0.7 + (1 - p.strafeSkill) * 0.6;
        this.potting = false;
        return this.runAway(cmd, snap, false);
      }
      if (!this.potting) {
        this.potting = true;
        this.potStart = now;
        this.potsBefore = b.potsThrown;
      }
      if (b.potsThrown > this.potsBefore || now - this.potStart > 1.5) {
        this.potting = false;
        this.lastPot = now;
        return null;
      }
      // Face away, sprint, look down, throw — then run into the splash.
      const c = this.runAway(cmd, snap, true);
      if (b.selected !== slot) c.slot = slot;
      else if (this.pitch < -1.15 && now - this.potStart > 0.12) c.use = true;
      return c;
    }

    // Drink speed when there's room to do it.
    if (b.speedEffect <= 0 && dist > 7) {
      const slot = this.hotbarSlot('speed_pot');
      if (slot >= 0) {
        const c = this.runAway(cmd, snap, false);
        c.sprint = false;
        c.forward = 0;
        if (b.selected !== slot) c.slot = slot;
        else c.use = true;
        return c;
      }
    }
    return null;
  }

  private runAway(cmd: FighterCommand, snap: Snapshot, lookDown: boolean): FighterCommand {
    const dt = C.SIM_DT;
    const yaw = this.retreatYaw(snap);
    const k = 1 - Math.exp(-14 * dt);
    this.yaw += angleDiff(this.yaw, yaw) * k;
    const wantPitch = lookDown ? -1.45 : -0.1;
    this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-16 * dt));
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    let [f, st] = this.avoidHazards(1, Math.sin(this.weaveT * 3) * 0.3);
    cmd.forward = f;
    cmd.strafe = st;
    cmd.sprint = true;
    cmd.attacks = 0;
    return cmd;
  }

  private setMode(m: Mode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.modeTime = 0;
    if (m === 'engage') this.strafeTimer = 0;
  }

  get currentMode(): string {
    return this.mode;
  }

  private directWalk(snap: Snapshot): boolean {
    const b = this.bot;
    if (Math.abs(snap.y - b.pos.y) > 1.4) return false;
    const dx = snap.x - b.pos.x;
    const dz = snap.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    const steps = Math.ceil(d / 0.7);
    let prevH = b.pos.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const h = this.nav.heightAt(b.pos.x + dx * t, b.pos.z + dz * t);
      if (Number.isNaN(h)) return false;
      if (h - prevH > 1.05 || prevH - h > 2.5) return false;
      prevH = h;
    }
    return true;
  }

  private followPath(snap: Snapshot, dt: number) {
    const b = this.bot;
    this.pathTimer -= dt;
    if (!this.path || this.pathTimer <= 0) {
      this.path = this.nav.findPath(b.pos.x, b.pos.z, snap.x, snap.z);
      this.pathTimer = 0.45;
    }
    const path = this.path;
    if (!path || path.length === 0) return null;
    // Drop reached waypoints; skip ahead while the next is close.
    while (path.length > 1 && Math.hypot(path[0].x - b.pos.x, path[0].z - b.pos.z) < 0.9) path.shift();
    // Look a few cells ahead on flat stretches for smoother steering.
    let i = 0;
    while (i + 1 < path.length && i < 3 && Math.abs(path[i + 1].y - b.pos.y) < 0.6) i++;
    return path[i];
  }

  private retreatYaw(snap: Snapshot): number {
    const b = this.bot;
    const away = yawTo(snap.x, snap.z, b.pos.x, b.pos.z);
    let best = away;
    let bestScore = -Infinity;
    for (let k = -3; k <= 3; k++) {
      const yaw = away + k * 0.4;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      let ok = true;
      for (let d = 1; d <= 4; d++) {
        if (this.nav.isHazard(b.pos.x + fx * d, b.pos.z + fz * d, b.pos.y)) {
          ok = false;
          break;
        }
      }
      const ex = b.pos.x + fx * 4 - snap.x;
      const ez = b.pos.z + fz * 4 - snap.z;
      const score = Math.hypot(ex, ez) - Math.abs(k) * 0.3 - (ok ? 0 : 100);
      if (score > bestScore) {
        bestScore = score;
        best = yaw;
      }
    }
    return best;
  }

  private avoidHazards(fwd: number, str: number): [number, number] {
    const b = this.bot;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const check = (f: number, s: number) => {
      const wx = -sy * f + cy * s;
      const wz = -cy * f - sy * s;
      const l = Math.hypot(wx, wz);
      if (l < 0.05) return false;
      const speed = Math.max(1, b.horizontalSpeed());
      for (const d of [0.55, 1.1, 0.3 + speed * 0.25]) {
        if (this.nav.isHazard(b.pos.x + (wx / l) * d, b.pos.z + (wz / l) * d, b.pos.y)) return true;
      }
      return false;
    };
    if (!check(fwd, str)) return [fwd, str];
    if (!check(fwd, 0)) {
      this.strafeDir = -this.strafeDir;
      return [fwd, 0];
    }
    if (!check(0, str)) return [0, str];
    if (!check(0, -str)) {
      this.strafeDir = -this.strafeDir;
      return [0, -str];
    }
    return [-Math.sign(fwd || 1) * 0.6, 0];
  }

  /** Aim drill: an evasive, non-attacking target that keeps mid range. */
  private aimDrill(cmd: FighterCommand, dist: number, dt: number): FighterCommand {
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = this.rng.range(0.25, 1.1);
      this.strafeDir = this.rng.sign();
    }
    let fwd = dist > 7 ? 1 : dist < 4 ? -1 : 0;
    let str = this.strafeDir;
    if (this.bot.onGround && this.rng.chance(0.5 * dt)) cmd.jump = true;
    [fwd, str] = this.avoidHazards(fwd, str);
    cmd.forward = fwd;
    cmd.strafe = str;
    cmd.sprint = this.rng.chance(0.7);
    return cmd;
  }

  /** Combo drill: walks at you in straight-ish lines so you can practise chaining. */
  private comboDummy(cmd: FighterCommand, dist: number, dt: number): FighterCommand {
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = this.rng.range(0.8, 2);
      this.strafeDir = this.rng.chance(0.5) ? 0 : this.rng.sign();
    }
    let fwd = dist > 2.2 ? 1 : 0;
    let str = this.strafeDir * 0.5;
    [fwd, str] = this.avoidHazards(fwd, str);
    cmd.forward = fwd;
    cmd.strafe = str;
    cmd.sprint = dist > 5;
    return cmd;
  }
}

/** Convenience to create a fresh bot fighter. */
export function createBotFighter(name: string): Fighter {
  const f = new Fighter(name, 'red', true);
  return f;
}
