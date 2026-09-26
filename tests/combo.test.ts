import { it, expect } from 'vitest';
import * as C from '../src/config/constants';
import { buildArena } from '../src/maps/Arena';
import { Simulation } from '../src/game/Simulation';
import { Fighter, emptyCommand } from '../src/entities/Fighter';
import { yawTo } from '../src/utils/math';

/** A perfect W-tapper vs. a victim who holds W (and optionally strafes). */
function comboRun(victimStrafe: number, wtap: boolean, seconds = 8, spacing = true) {
  const { world } = buildArena();
  const sim = new Simulation(world, 5);
  const a = sim.add(new Fighter('A', 'blue', false));
  const v = sim.add(new Fighter('V', 'red', true));
  // long open lane along x = 11.5 (between pillars and east pit)
  a.reset(0.5, 0, -12, Math.PI);
  v.reset(0.5, 0, -8.5, 0);
  v.invulnerable = false;
  let release = 0;
  let longest = 0;
  const log: number[] = [];
  for (let i = 0; i < seconds * C.SIM_HZ; i++) {
    const ya = yawTo(a.pos.x, a.pos.z, v.pos.x, v.pos.z);
    const yv = yawTo(v.pos.x, v.pos.z, a.pos.x, a.pos.z);
    const dist = Math.hypot(v.pos.x - a.pos.x, v.pos.z - a.pos.z);
    const ca = { ...emptyCommand(), yaw: ya, pitch: -0.1, sprint: true, forward: 1 };
    if (a.sprintLock && wtap && release === 0) release = 3;
    if (release > 0) {
      ca.forward = 0;
      release--;
    } else if (spacing && dist < 3.6 && v.hurtTimer > 0.1) {
      // spacing: hold off while they're in their hit window, then re-enter at reach
      ca.forward = dist > 3.3 ? 1 : 0;
    }
    if (dist < 3.05 && v.hurtTimer <= 0.02) ca.attacks = 1;
    const cv = { ...emptyCommand(), yaw: yv, forward: 1, strafe: victimStrafe, sprint: true };
    if (dist < 3.0 && i % 6 === 0) cv.attacks = 1; // ~10 CPS
    a.health = 20;
    sim.step(new Map([[a.id, ca], [v.id, cv]]));
    for (const e of sim.events) if (e.type === 'hit' && e.attacker === a) log.push(+(sim.time).toFixed(2));
    sim.events.length = 0;
    longest = Math.max(longest, a.combo);
    v.health = 20; // measure the combo, not the kill
    if (!v.alive || !a.alive) break;
  }
  return { longest, hits: log.length, bHits: v.stats.hits };
}

it('W-tapping keeps a combo on a W-holding opponent; not W-tapping trades', () => {
  const tap = comboRun(0, true);
  const noTap = comboRun(0, false, 8, false);
  const strafe = comboRun(1, true);
  console.log('wtap', tap, 'no-wtap', noTap, 'victim strafes', strafe);
  expect(tap.longest).toBeGreaterThanOrEqual(6);
  expect(noTap.bHits).toBeGreaterThan(tap.bHits);
  // strafing out of the combo line must actually work
  expect(strafe.longest).toBeLessThan(tap.longest);
});
