import { describe, it, expect } from 'vitest';
import * as C from '../src/config/constants';
import { buildArena } from '../src/maps/Arena';
import { Simulation } from '../src/game/Simulation';
import { Fighter, emptyCommand, type FighterCommand } from '../src/entities/Fighter';
import { NavGrid } from '../src/game/NavGrid';
import { BotBrain, BOT_PROFILES } from '../src/entities/BotBrain';
import { traceAttack } from '../src/game/Combat';

function setup() {
  const { world } = buildArena();
  const sim = new Simulation(world, 42);
  const a = sim.add(new Fighter('A', 'blue', false));
  const b = sim.add(new Fighter('B', 'red', true));
  a.reset(0.5, 0, -6.5, Math.PI);
  b.reset(0.5, 0, 12.5, 0);
  return { sim, a, b, world };
}

function run(sim: Simulation, ticks: number, cmds: (t: number) => Map<number, FighterCommand>) {
  for (let i = 0; i < ticks; i++) {
    sim.step(cmds(i));
    sim.events.length = 0;
  }
}

describe('movement', () => {
  it('settles on the ground and reaches walk / sprint speed quickly', () => {
    const { sim, a } = setup();
    run(sim, C.SIM_HZ / 2, () => new Map([[a.id, { ...emptyCommand(), yaw: Math.PI }]]));
    expect(a.onGround).toBe(true);
    expect(a.pos.y).toBeCloseTo(0, 3);
    let t95 = -1;
    for (let i = 0; i < C.SIM_HZ; i++) {
      sim.step(new Map([[a.id, { ...emptyCommand(), forward: 1, sprint: true, yaw: Math.PI }]]));
      sim.events.length = 0;
      if (t95 < 0 && a.horizontalSpeed() > C.SPRINT_SPEED * 0.95) t95 = i;
    }
    expect(a.sprinting).toBe(true);
    expect(a.horizontalSpeed()).toBeGreaterThan(C.SPRINT_SPEED * 0.97);
    expect(t95 / C.SIM_HZ).toBeLessThan(0.3);
    // Releasing keys stops quickly (no ice skating)
    run(sim, C.SIM_HZ / 5, () => new Map([[a.id, { ...emptyCommand(), yaw: Math.PI }]]));
    expect(a.horizontalSpeed()).toBeLessThan(0.3);
  });

  it('jumps about one block high', () => {
    const { sim, a } = setup();
    run(sim, C.SIM_HZ / 3, () => new Map([[a.id, { ...emptyCommand(), yaw: Math.PI }]]));
    let maxY = 0;
    for (let i = 0; i < C.SIM_HZ; i++) {
      sim.step(new Map([[a.id, { ...emptyCommand(), jump: i === 0, yaw: Math.PI }]]));
      sim.events.length = 0;
      maxY = Math.max(maxY, a.pos.y);
    }
    expect(maxY).toBeGreaterThan(1.05);
    expect(maxY).toBeLessThan(1.35);
    expect(a.onGround).toBe(true);
  });

  it('walks up half-block stairs to the high platform', () => {
    const { sim, a } = setup();
    a.reset(-6.5, 0, -4.5, 0); // bottom of west stairs, facing north
    run(sim, C.SIM_HZ * 2.5, () => new Map([[a.id, { ...emptyCommand(), forward: 1, yaw: 0 }]]));
    expect(a.pos.y).toBeGreaterThan(4.9);
  });
});

describe('combat', () => {
  it('hits within reach, misses beyond it', () => {
    const { sim, a, b } = setup();
    b.reset(0.5, 0, -6.5 + 2.8, 0);
    run(sim, 10, () => new Map());
    a.pitch = 0;
    expect(traceAttack(sim, a)?.target).toBe(b);
    b.reset(0.5, 0, -6.5 + 3.6, 0);
    run(sim, 10, () => new Map());
    expect(traceAttack(sim, a)).toBeNull();
  });

  it('sprint hits knock further and require a reset', () => {
    const measure = (sprint: boolean) => {
      const { sim, a, b } = setup();
      a.reset(11.5, 0, -4.5, Math.PI);
      b.reset(11.5, 0, -4.5 + 2.6, 0);
      run(sim, 30, (i) =>
        new Map([
          [a.id, { ...emptyCommand(), yaw: Math.PI, forward: sprint && i > 5 ? 1 : 0, sprint }],
          [b.id, { ...emptyCommand(), yaw: 0 }],
        ]),
      );
      // Put them back at exactly 2.6m; keep a's velocity/sprint state.
      a.pos.z = -4.5;
      b.pos.z = -4.5 + 2.6;
      const z0 = b.pos.z;
      sim.step(new Map([[a.id, { ...emptyCommand(), yaw: Math.PI, forward: sprint ? 1 : 0, sprint, attacks: 1 }]]));
      expect(b.health).toBeLessThan(C.MAX_HEALTH);
      const locked = a.sprintLock;
      run(sim, Math.round(C.SIM_HZ * 0.67), () => new Map());
      return { dist: b.pos.z - z0, locked };
    };
    const walk = measure(false);
    const sprint = measure(true);
    console.log(`knockback distance walk=${walk.dist.toFixed(2)} sprint=${sprint.dist.toFixed(2)}`);
    expect(sprint.locked).toBe(true);
    expect(walk.dist).toBeGreaterThan(1.5);
    expect(sprint.dist).toBeGreaterThan(walk.dist * 1.3);
  });

  it('respects the hurt window', () => {
    const { sim, a, b } = setup();
    b.reset(0.5, 0, -4.2, 0);
    run(sim, 10, () => new Map());
    sim.step(new Map([[a.id, { ...emptyCommand(), yaw: Math.PI, attacks: 1 }]]));
    const h1 = b.health;
    b.pos.z = -4.2;
    b.vel.set(0, 0, 0);
    run(sim, 5, () => new Map());
    b.pos.z = -4.2;
    sim.step(new Map([[a.id, { ...emptyCommand(), yaw: Math.PI, attacks: 1 }]]));
    expect(b.health).toBe(h1);
  });
});

describe('bots', () => {
  it('normal bot actually fights and lands combos against easy bot', () => {
    const { sim, a, b, world } = setup();
    const nav = new NavGrid(world, -24, -30, 24, 40);
    const ba = new BotBrain(a, sim, nav, BOT_PROFILES.normal, 1);
    const bb = new BotBrain(b, sim, nav, BOT_PROFILES.easy, 2);
    ba.target = b;
    bb.target = a;
    let deaths = { a: 0, b: 0 };
    for (let i = 0; i < C.SIM_HZ * 90; i++) {
      sim.step(new Map([
        [a.id, ba.update(C.SIM_DT)],
        [b.id, bb.update(C.SIM_DT)],
      ]));
      for (const e of sim.events) if (e.type === 'death') e.victim === a ? deaths.a++ : deaths.b++;
      sim.events.length = 0;
      for (const f of [a, b])
        if (!f.alive && sim.time - f.deathTime > 1) {
          f.reset(f === a ? 0.5 : 0.5, 0, f === a ? -6.5 : 12.5, f === a ? Math.PI : 0);
          (f === a ? ba : bb).reset();
        }
    }
    console.log('normal vs easy', deaths, a.stats, b.stats);
    expect(a.stats.hits).toBeGreaterThan(20);
    expect(deaths.b).toBeGreaterThan(deaths.a);
    expect(a.stats.longestCombo).toBeGreaterThanOrEqual(3);
  });

  it('hard bot beats normal bot', () => {
    const { sim, a, b, world } = setup();
    const nav = new NavGrid(world, -24, -30, 24, 40);
    const ba = new BotBrain(a, sim, nav, BOT_PROFILES.hard, 3);
    const bb = new BotBrain(b, sim, nav, BOT_PROFILES.normal, 4);
    ba.target = b;
    bb.target = a;
    let deaths = { a: 0, b: 0 };
    for (let i = 0; i < C.SIM_HZ * 120; i++) {
      sim.step(new Map([
        [a.id, ba.update(C.SIM_DT)],
        [b.id, bb.update(C.SIM_DT)],
      ]));
      for (const e of sim.events) if (e.type === 'death') e.victim === a ? deaths.a++ : deaths.b++;
      sim.events.length = 0;
      for (const f of [a, b])
        if (!f.alive && sim.time - f.deathTime > 1) {
          f.reset(0.5, 0, f === a ? -6.5 : 12.5, f === a ? Math.PI : 0);
          (f === a ? ba : bb).reset();
        }
    }
    console.log('hard vs normal', deaths, a.stats, b.stats);
    expect(deaths.b + deaths.a).toBeGreaterThan(3);
    expect(deaths.b).toBeGreaterThan(deaths.a);
  });
});
