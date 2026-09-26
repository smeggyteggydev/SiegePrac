import { Vector3 } from 'three';
import {
  MAX_HEALTH,
  PLAYER_HEIGHT,
  PLAYER_HEIGHT_CROUCH,
  EYE_HEIGHT,
  EYE_HEIGHT_CROUCH,
  PLAYER_WIDTH,
} from '../config/constants';
import { AABB } from '../game/Physics';
import { type ItemStack, HOTBAR_SIZE, defaultLoadout, itemDef } from '../weapons/Items';

/**
 * One tick of intent for a fighter. Both the local player (from Input) and bots
 * (from BotBrain) produce these; a future network layer would serialise them.
 */
export interface FighterCommand {
  /** -1..1, +1 = forward */
  forward: number;
  /** -1..1, +1 = right */
  strafe: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  /** Number of attack clicks since the previous tick. */
  attacks: number;
  /** Right mouse held: block (weapon) or consume (food). */
  use: boolean;
  yaw: number;
  pitch: number;
  /** Hotbar slot to select this tick, or -1. */
  slot: number;
}

export function emptyCommand(): FighterCommand {
  return {
    forward: 0,
    strafe: 0,
    jump: false,
    sprint: false,
    crouch: false,
    attacks: 0,
    use: false,
    yaw: 0,
    pitch: 0,
    slot: -1,
  };
}

export interface FighterStats {
  swings: number;
  /** Swings whose trace touched an opponent's hitbox (including during their hit window). */
  connects: number;
  hits: number;
  crits: number;
  damageDealt: number;
  damageTaken: number;
  longestCombo: number;
  kills: number;
  deaths: number;
  sprintHits: number;
}

export function emptyStats(): FighterStats {
  return {
    swings: 0,
    connects: 0,
    hits: 0,
    crits: 0,
    damageDealt: 0,
    damageTaken: 0,
    longestCombo: 0,
    kills: 0,
    deaths: 0,
    sprintHits: 0,
  };
}

let nextId = 1;

export class Fighter {
  readonly id = nextId++;
  name: string;
  team: 'blue' | 'red';
  isBot: boolean;

  readonly pos = new Vector3();
  readonly prevPos = new Vector3();
  readonly vel = new Vector3();
  yaw = 0;
  pitch = 0;
  prevYaw = 0;
  prevPitch = 0;

  onGround = false;
  airTime = 0;
  coyote = 0;
  jumpBuffer = 0;
  jumpCooldown = 0;
  crouching = false;
  sprinting = false;
  /** Set after a sprint hit; cleared when forward is released (W-tap) or sprint released. */
  sprintLock = false;
  toggleSprint = false;
  lastForward = 0;
  /** Horizontal distance accumulator for footsteps. */
  stepDist = 0;
  fallStartY = 0;

  health = MAX_HEALTH;
  absorption = 0;
  regenLeft = 0;
  alive = true;
  deathTime = 0;
  /** Time left before this fighter can be damaged again. */
  hurtTimer = 0;
  /** Hitstun visual/control timer. */
  hitstun = 0;
  /** Direction of the last hit taken (unit xz), for camera/model reaction. */
  readonly lastHitDir = new Vector3();
  lastDamagedBy: Fighter | null = null;
  lastDamagedAt = -99;

  /** Seconds since last swing started; drives animation. */
  swingTime = 99;
  swingCooldown = 0;
  blocking = false;
  eating = 0; // progress seconds, 0 when not eating
  /** Remaining seconds of active effects. */
  speedEffect = 0;
  throwCooldown = 0;
  pearlCooldown = 0;
  potsThrown = 0;

  combo = 0;
  lastComboHitAt = -99;
  comboTarget: Fighter | null = null;

  inventory: (ItemStack | null)[] = defaultLoadout();
  selected = 0;

  stats: FighterStats = emptyStats();
  /** Arbitrary per-mode flags (e.g. drill dummies that never attack). */
  passive = false;
  invulnerable = false;

  constructor(name: string, team: 'blue' | 'red', isBot: boolean) {
    this.name = name;
    this.team = team;
    this.isBot = isBot;
  }

  get height(): number {
    return this.crouching ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT;
  }

  get eyeHeight(): number {
    return this.crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT;
  }

  get halfWidth(): number {
    return PLAYER_WIDTH / 2;
  }

  box(): AABB {
    return AABB.fromFeet(this.pos.x, this.pos.y, this.pos.z, this.halfWidth, this.height);
  }

  eye(out = new Vector3()): Vector3 {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  /** Unit look direction from yaw/pitch (yaw 0 looks toward -Z). */
  look(out = new Vector3()): Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Count of an item across the whole inventory. */
  count(id: string): number {
    let n = 0;
    for (const s of this.inventory) if (s && s.id === id) n += s.count;
    return n;
  }

  heldItem(): ItemStack | null {
    return this.inventory[this.selected] ?? null;
  }

  heldDef() {
    return itemDef(this.heldItem());
  }

  selectSlot(i: number): boolean {
    if (i < 0 || i >= HOTBAR_SIZE || i === this.selected) return false;
    this.selected = i;
    this.eating = 0;
    this.blocking = false;
    return true;
  }

  horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  reset(x: number, y: number, z: number, yaw: number): void {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = this.prevYaw = yaw;
    this.pitch = this.prevPitch = 0;
    this.health = MAX_HEALTH;
    this.absorption = 0;
    this.regenLeft = 0;
    this.alive = true;
    this.hurtTimer = 0;
    this.hitstun = 0;
    this.sprinting = false;
    this.sprintLock = false;
    this.blocking = false;
    this.eating = 0;
    this.speedEffect = 0;
    this.throwCooldown = 0;
    this.pearlCooldown = 0;
    this.combo = 0;
    this.comboTarget = null;
    this.onGround = false;
    this.airTime = 0;
    this.swingTime = 99;
    this.swingCooldown = 0;
    this.lastDamagedBy = null;
    this.lastDamagedAt = -99;
    this.fallStartY = y;
  }
}
