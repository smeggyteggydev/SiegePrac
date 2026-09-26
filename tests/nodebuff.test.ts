import { it, expect } from 'vitest';
import * as C from '../src/config/constants';
import { buildArena } from '../src/maps/Arena';
import { Simulation } from '../src/game/Simulation';
import { Fighter } from '../src/entities/Fighter';
import { NavGrid } from '../src/game/NavGrid';
import { BotBrain, BOT_PROFILES } from '../src/entities/BotBrain';
import { nodebuffLoadout } from '../src/weapons/Items';

it('NoDebuff bots pot, heal and still finish fights', () => {
  const { world } = buildArena();
  const sim = new Simulation(world, 9);
  const nav = new NavGrid(world, -24, -30, 24, 40);
  const a = sim.add(new Fighter('A', 'blue', true));
  const b = sim.add(new Fighter('B', 'red', true));
  const ba = new BotBrain(a, sim, nav, BOT_PROFILES.hard, 1);
  const bb = new BotBrain(b, sim, nav, BOT_PROFILES.normal, 2);
  ba.target = b;
  bb.target = a;
  const spawn = () => {
    a.reset(0.5, 0, -9.5, Math.PI);
    b.reset(0.5, 0, 13.5, 0);
    a.inventory = nodebuffLoadout();
    b.inventory = nodebuffLoadout();
    ba.reset();
    bb.reset();
  };
  spawn();
  let heals = 0;
  let splashes = 0;
  let deaths = 0;
  let pearls = 0;
  for (let i = 0; i < C.SIM_HZ * 150; i++) {
    sim.step(new Map([
      [a.id, ba.update(C.SIM_DT)],
      [b.id, bb.update(C.SIM_DT)],
    ]));
    for (const e of sim.events) {
      if (e.type === 'splash') {
        splashes++;
        for (const h of e.healed) heals += h.amount;
      }
      if (e.type === 'pearl') pearls++;
      if (e.type === 'death') deaths++;
    }
    sim.events.length = 0;
    if ((!a.alive || !b.alive) && sim.time - Math.max(a.deathTime, b.deathTime) > 1) spawn();
  }
  console.log({ splashes, heals: heals.toFixed(0), deaths, pearls, potsA: a.count('heal_pot'), potsB: b.count('heal_pot'), speedA: a.speedEffect.toFixed(0) });
  expect(splashes).toBeGreaterThanOrEqual(3);
  expect(heals).toBeGreaterThan(splashes * 4);
  expect(deaths).toBeGreaterThan(0);
});
