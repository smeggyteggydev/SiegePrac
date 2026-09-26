import { Vector3 } from 'three';
import * as C from '../config/constants';
import type { Fighter } from '../entities/Fighter';
import type { ItemDef } from '../weapons/Items';
import type { Simulation } from './Simulation';
import { AABB } from './Physics';

export interface TraceResult {
  target: Fighter;
  distance: number;
  point: Vector3;
}

const eye = new Vector3();
const dir = new Vector3();

/** The inflated hitbox used for attack traces. */
export function hitbox(f: Fighter): AABB {
  return f.box().expand(C.HITBOX_INFLATE);
}

/**
 * Deterministic melee trace: a ray from the attacker's eye along their look
 * direction against every opponent's inflated AABB, limited by reach and
 * blocked by world geometry.
 */
export function traceAttack(sim: Simulation, attacker: Fighter, range = C.ATTACK_RANGE): TraceResult | null {
  attacker.eye(eye);
  attacker.look(dir);
  let best: TraceResult | null = null;
  for (const t of sim.fighters) {
    if (t === attacker || !t.alive) continue;
    const box = hitbox(t);
    const d = box.rayHit(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z);
    if (d < 0 || d > range) continue;
    if (best && d >= best.distance) continue;
    const wall = sim.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, d);
    if (wall < d - 1e-3) continue;
    best = { target: t, distance: d, point: eye.clone().addScaledVector(dir, d) };
  }
  return best;
}

export function isCritical(f: Fighter): boolean {
  return !f.onGround && f.vel.y < -0.5 && f.airTime > 0.06;
}

export function resolveAttack(sim: Simulation, attacker: Fighter, weapon: ItemDef | null): void {
  const hit = traceAttack(sim, attacker);
  if (!hit) return;
  const victim = hit.target;
  sim.emit({ type: 'connect', attacker, victim, point: hit.point });
  attacker.stats.connects++;
  if (victim.hurtTimer > 0 || victim.invulnerable) return;
  applyHit(sim, attacker, victim, weapon, hit.point);
}

export function applyHit(
  sim: Simulation,
  attacker: Fighter,
  victim: Fighter,
  weapon: ItemDef | null,
  point: Vector3,
): void {
  const baseDamage = weapon?.damage ?? 1;
  const kbScale = weapon?.knockbackScale ?? 0.85;
  const crit = isCritical(attacker);

  // Blocking only works if the victim is roughly facing the attacker.
  const toAtk = new Vector3(attacker.pos.x - victim.pos.x, 0, attacker.pos.z - victim.pos.z).normalize();
  const vLook = victim.look(new Vector3()).setY(0).normalize();
  const blocked = victim.blocking && vLook.dot(toAtk) > 0.15;

  let damage = baseDamage * (crit ? C.CRIT_MULTIPLIER : 1);
  if (blocked) damage *= C.BLOCK_DAMAGE_FACTOR;

  // Absorption soaks first.
  let remaining = damage;
  if (victim.absorption > 0) {
    const soak = Math.min(victim.absorption, remaining);
    victim.absorption -= soak;
    remaining -= soak;
  }
  victim.health -= remaining;

  // ── Knockback ──
  const dir = new Vector3(victim.pos.x - attacker.pos.x, 0, victim.pos.z - attacker.pos.z);
  if (dir.lengthSq() < 1e-6) attacker.look(dir).setY(0);
  dir.normalize();
  const variance = 1 + (sim.rng.next() * 2 - 1) * C.KNOCKBACK_VARIANCE;
  const blockK = blocked ? C.BLOCK_KNOCKBACK_FACTOR : 1;
  const airK = victim.onGround ? 1 : C.KNOCKBACK_AIR_FACTOR;
  const h = C.KNOCKBACK_HORIZONTAL * kbScale * variance * blockK * airK;

  victim.vel.x = victim.vel.x * C.KNOCKBACK_VELOCITY_KEEP + dir.x * h;
  victim.vel.z = victim.vel.z * C.KNOCKBACK_VELOCITY_KEEP + dir.z * h;
  let vy = C.KNOCKBACK_VERTICAL * blockK;

  const sprint = attacker.sprinting;
  if (sprint) {
    // Sprint knockback follows the attacker's facing: aim steers the combo.
    const facing = attacker.look(new Vector3()).setY(0).normalize();
    const bonus = C.KNOCKBACK_SPRINT_BONUS * kbScale * blockK * airK;
    victim.vel.x += facing.x * bonus;
    victim.vel.z += facing.z * bonus;
    vy += C.KNOCKBACK_SPRINT_VERTICAL_BONUS * blockK;
    attacker.vel.x *= C.SPRINT_HIT_SLOWDOWN;
    attacker.vel.z *= C.SPRINT_HIT_SLOWDOWN;
    attacker.sprinting = false;
    attacker.sprintLock = true;
    attacker.stats.sprintHits++;
  }
  victim.vel.y = Math.min(Math.max(victim.vel.y, 0) * C.KNOCKBACK_VELOCITY_KEEP + vy, C.KNOCKBACK_VERTICAL_MAX);
  victim.onGround = false;
  victim.coyote = 0;

  victim.hurtTimer = C.HURT_INVULN;
  victim.hitstun = C.HITSTUN_TIME;
  victim.lastHitDir.copy(dir);
  victim.lastDamagedBy = attacker;
  victim.lastDamagedAt = sim.time;
  victim.stats.damageTaken += damage;

  // ── Combo bookkeeping ──
  if (attacker.comboTarget === victim && sim.time - attacker.lastComboHitAt <= C.COMBO_TIMEOUT) attacker.combo++;
  else attacker.combo = 1;
  attacker.comboTarget = victim;
  attacker.lastComboHitAt = sim.time;
  if (victim.combo >= 2) sim.emit({ type: 'comboBreak', fighter: victim, combo: victim.combo });
  victim.combo = 0;
  victim.comboTarget = null;

  attacker.stats.hits++;
  attacker.stats.damageDealt += damage;
  if (crit) attacker.stats.crits++;
  if (attacker.combo > attacker.stats.longestCombo) attacker.stats.longestCombo = attacker.combo;

  sim.emit({
    type: 'hit',
    attacker,
    victim,
    damage,
    crit,
    blocked,
    sprint,
    combo: attacker.combo,
    point: point.clone(),
    dir: dir.clone(),
  });

  if (victim.health <= 0) sim.kill(victim, attacker, 'combat');
}
