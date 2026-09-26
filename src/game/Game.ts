import * as C from '../config/constants';
import { settings, loadLoadout, loadRecords, saveRecords } from '../config/settings';
import { buildArena, type ArenaData } from '../maps/Arena';
import { Simulation, type SimEvent } from './Simulation';
import { NavGrid } from './NavGrid';
import { Fighter, type FighterCommand, emptyCommand, emptyStats } from '../entities/Fighter';
import { FighterModel } from '../entities/FighterModel';
import { BotBrain, BOT_PROFILES, type BotDifficulty } from '../entities/BotBrain';
import { Renderer } from '../render/Renderer';
import { Input } from './Input';
import { CameraRig } from './CameraRig';
import { audio } from '../audio/AudioEngine';
import { Hud } from '../ui/Hud';
import { Menu, Overlays, type GameMode } from '../ui/Menu';
import { InventoryUI } from '../ui/InventoryUI';
import { h, show } from '../ui/dom';
import { angleDiff, yawTo } from '../utils/math';
import { Checkpoints } from './Checkpoints';

type Phase = 'menu' | 'countdown' | 'fight' | 'roundEnd' | 'results';

const AIM_DRILL_TIME = 40;

export class Game {
  readonly arena: ArenaData;
  readonly sim: Simulation;
  readonly nav: NavGrid;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly camRig: CameraRig;
  readonly hud: Hud;
  readonly menu: Menu;
  readonly overlays: Overlays;
  readonly inventory: InventoryUI;
  private invWrap: HTMLElement;

  readonly player: Fighter;
  readonly bot: Fighter;
  private botBrain: BotBrain;
  /** Drives the player's fighter in the menu attract-mode duel. */
  private attractBrain: BotBrain;
  private models = new Map<number, FighterModel>();
  private checkpoints: Checkpoints;

  private phase: Phase = 'menu';
  private mode: GameMode = 'duel';
  private difficulty: BotDifficulty = 'normal';
  private firstTo = 3;
  private score = { player: 0, bot: 0 };
  private round = 0;
  private phaseTimer = 0;
  private countdownShown = -1;
  private matchStart = 0;
  private paused = false;
  private invOpen = false;
  private killer: Fighter | null = null;
  private timeScale = 1;
  private slowmoTimer = 0;
  private drillTime = 0;
  private drillBestCombo = 0;
  private records = loadRecords();

  private acc = 0;
  private last = performance.now();
  private renderTime = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsValue = 0;
  private perfTimer = 0;
  private menuCamT = 0;

  constructor(container: HTMLElement) {
    const canvas = h('canvas', { id: 'game' });
    container.appendChild(canvas);

    this.arena = buildArena();
    this.sim = new Simulation(this.arena.world, (Math.random() * 1e9) | 0);
    this.nav = new NavGrid(this.arena.world, -24, -30, 24, 40);
    this.renderer = new Renderer(canvas, this.arena);
    this.renderer.setQuality(settings.get('quality'));

    this.player = this.sim.add(new Fighter('You', 'blue', false));
    this.bot = this.sim.add(new Fighter('Siege Bot', 'red', true));
    for (const f of [this.player, this.bot]) {
      const m = new FighterModel(f);
      this.models.set(f.id, m);
      this.renderer.scene.add(m.root);
    }
    this.botBrain = new BotBrain(this.bot, this.sim, this.nav, BOT_PROFILES.normal, 11);
    this.botBrain.target = this.player;
    this.attractBrain = new BotBrain(this.player, this.sim, this.nav, BOT_PROFILES.normal, 12);
    this.attractBrain.target = this.bot;
    this.checkpoints = new Checkpoints(this.arena.world);
    this.renderer.scene.add(this.checkpoints.group);

    this.input = new Input(canvas);
    this.camRig = new CameraRig(this.renderer.camera);

    const ui = h('div', { id: 'ui' });
    container.appendChild(ui);
    this.hud = new Hud(ui);
    this.invWrap = h('div', { class: 'overlay inv-overlay hidden' });
    ui.appendChild(this.invWrap);
    this.inventory = new InventoryUI(this.invWrap, true);
    this.inventory.onClose = () => this.toggleInventory(false);
    this.overlays = new Overlays(ui, {
      resume: () => this.resume(),
      restart: () => this.startMode(this.mode),
      settings: () => {
        this.overlays.showPause(false);
        this.menu.settingsBack = () => {
          this.menu.go('none');
          this.overlays.showPause(true, 'Click RESUME to capture the mouse.');
        };
        this.menu.go('settings');
      },
      menu: () => this.toMenu(),
      changeMode: () => {
        this.toMenu();
        this.menu.openModes(this.mode);
      },
    });
    this.menu = new Menu(ui, { start: (m) => this.startMode(m) });

    this.bindInput();
    this.applySettings();
    settings.onChange(() => this.applySettings());
    window.addEventListener('resize', () => this.renderer.resize());
    canvas.addEventListener('click', () => {
      audio.unlock();
      if (this.phase !== 'menu' && !this.paused && !this.invOpen && !this.input.locked) void this.input.lock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase !== 'menu' && !this.paused) this.pause();
    });

    this.enterMenu();
    this.exposeDebug();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  private lastQuality = settings.get('quality');
  private applySettings(): void {
    const q = settings.get('quality');
    if (q !== this.lastQuality) {
      this.lastQuality = q;
      this.renderer.setQuality(q);
    }
    this.renderer.particles.scale = settings.get('particles') ? 1 : 0.25;
    this.renderer.motionBlur = settings.get('motionBlur');
    audio.setVolumes(settings.get('masterVolume'), settings.get('musicVolume'), settings.get('sfxVolume'));
  }

  // ── Input wiring ─────────────────────────────────────────────────────────
  private bindInput(): void {
    this.input.currentSlot = () => this.player.selected;
    this.input.onLook = (dy, dp) => this.renderer.viewModel.look(dy, dp);
    this.input.onLockChange = (locked) => {
      if (this.phase === 'menu') return;
      if (locked) {
        this.hud.setLockHint(false);
        if (this.paused) this.resume();
      } else if (!this.invOpen && this.phase !== 'results') {
        this.pause();
      }
    };
    this.input.onAction = (a) => {
      if (this.phase === 'menu') return;
      if (a === 'restart' && (this.phase === 'results' || this.input.locked)) {
        this.startMode(this.mode);
      } else if (a === 'inventory' && this.phase !== 'results' && !this.paused) {
        this.toggleInventory(!this.invOpen);
      } else if (a === 'view' && this.input.locked) {
        this.camRig.thirdPerson = !this.camRig.thirdPerson;
      }
    };
  }

  private toggleInventory(open: boolean): void {
    if (open === this.invOpen) return;
    this.invOpen = open;
    show(this.invWrap, open);
    if (open) {
      this.inventory.bind(this.player.inventory, 'INVENTORY');
      this.input.unlock();
      audio.uiClick();
    } else {
      this.inventory.cancel();
      void this.input.lock();
    }
  }

  // ── Flow ─────────────────────────────────────────────────────────────────
  private enterMenu(): void {
    this.phase = 'menu';
    this.input.enabled = false;
    this.hud.setVisible(false);
    this.overlays.showPause(false);
    this.overlays.showResults(false);
    show(this.invWrap, false);
    this.invOpen = false;
    this.paused = false;
    this.menu.go('main');
    this.renderer.showViewModel = false;
    audio.setMusic('menu');
    // Attract mode: two bots duelling in the background.
    this.ensureBot(true);
    this.botBrain.profile = BOT_PROFILES.normal;
    this.botBrain.behavior = 'fight';
    this.attractBrain.behavior = 'fight';
    this.player.name = 'Challenger';
    this.resetFighters();
    for (const m of this.models.values()) m.root.visible = true;
    this.checkpoints.setActive(false);
  }

  private toMenu(): void {
    this.input.unlock();
    this.enterMenu();
  }

  startMode(mode: GameMode): void {
    audio.unlock();
    this.mode = mode;
    this.difficulty = settings.get('difficulty');
    this.firstTo = settings.get('firstTo');
    this.menu.go('none');
    this.overlays.showResults(false);
    this.overlays.showPause(false);
    this.paused = false;
    this.invOpen = false;
    show(this.invWrap, false);
    this.hud.reset();
    this.hud.setVisible(true);
    this.renderer.showViewModel = true;
    this.input.enabled = true;
    this.player.name = 'You';
    this.player.stats = emptyStats();
    this.bot.stats = emptyStats();
    this.score = { player: 0, bot: 0 };
    this.round = 0;
    this.matchStart = this.sim.time;
    this.drillBestCombo = 0;
    this.timeScale = 1;
    audio.setMusic(settings.get('musicVolume') > 0 ? 'game' : 'off');

    const profile = BOT_PROFILES[this.difficulty];
    this.botBrain.profile = profile;
    this.bot.passive = false;
    this.checkpoints.setActive(false);
    this.ensureBot(mode !== 'movement');
    switch (mode) {
      case 'duel':
        this.bot.name = `Siege Bot`;
        this.botBrain.behavior = 'fight';
        break;
      case 'combo':
        this.bot.name = 'Combo Dummy';
        this.botBrain.behavior = 'comboDummy';
        this.botBrain.profile = BOT_PROFILES.normal;
        this.bot.passive = true;
        break;
      case 'aim':
        this.bot.name = 'Target';
        this.botBrain.behavior = 'aimTarget';
        this.botBrain.profile = BOT_PROFILES.hard;
        this.bot.passive = true;
        break;
      case 'movement':
        this.checkpoints.setActive(true);
        break;
    }
    void this.input.lock().then((ok) => {
      if (!ok) this.hud.setLockHint(true);
    });
    this.startRound();
  }

  private ensureBot(present: boolean): void {
    const inSim = this.sim.fighters.includes(this.bot);
    if (present && !inSim) this.sim.add(this.bot);
    if (!present && inSim) this.sim.remove(this.bot);
    this.models.get(this.bot.id)!.root.visible = present;
  }

  private resetFighters(): void {
    const w = this.arena.world;
    const sb = w.marker('spawn_blue');
    const sr = w.marker('spawn_red');
    if (this.phase !== 'menu' && this.mode === 'movement') {
      const p = w.marker('platform');
      this.player.reset(p.x, p.y, p.z, p.yaw);
    } else if (this.phase !== 'menu' && this.mode !== 'duel') {
      this.player.reset(sb.x, sb.y, sb.z + 4, sb.yaw);
    } else {
      this.player.reset(sb.x, sb.y, sb.z, sb.yaw);
    }
    const botZ = this.phase !== 'menu' && (this.mode === 'combo' || this.mode === 'aim') ? sr.z - 6 : sr.z;
    this.bot.reset(sr.x, sr.y, botZ, sr.yaw);
    const loadout = loadLoadout();
    this.player.inventory = loadout.map((s) => (s ? { ...s } : null));
    this.bot.inventory = [
      { id: 'sword', count: 1 },
      null,
      { id: 'gapple', count: 2 },
      ...new Array(this.player.inventory.length - 3).fill(null),
    ];
    this.player.selected = Math.max(0, this.player.inventory.findIndex((s, i) => i < 9 && s?.id === 'sword'));
    this.bot.selected = 0;
    this.input.setLook(this.player.yaw, 0);
    this.botBrain.reset();
    this.attractBrain.reset();
    this.killer = null;
    this.camRig.resetDeath();
    this.checkpoints.reset();
  }

  private startRound(): void {
    this.round++;
    this.phase = 'countdown';
    this.resetFighters();
    this.phaseTimer = this.mode === 'duel' ? C.ROUND_COUNTDOWN : 1.2;
    this.countdownShown = -1;
    this.drillTime = 0;
    this.input.clearPending();
    if (this.mode === 'duel') {
      const label = this.firstTo === 1 ? 'DUEL' : `ROUND ${this.round}`;
      this.hud.message(label, `FIRST TO ${this.firstTo} · ${BOT_PROFILES[this.difficulty].label}`, 1.1, 'neutral');
    } else {
      const names = { combo: 'COMBO DRILL', aim: 'AIM DRILL', movement: 'MOVEMENT DRILL', duel: '' };
      this.hud.message(names[this.mode], this.mode === 'movement' ? 'REACH EVERY CHECKPOINT' : '', 1.1);
    }
  }

  private pause(): void {
    if (this.paused || this.phase === 'menu') return;
    this.paused = true;
    this.overlays.showPause(true);
  }

  private resume(): void {
    void this.input.lock().then((ok) => {
      if (ok) {
        this.paused = false;
        this.overlays.showPause(false);
        this.last = performance.now();
      } else {
        this.overlays.showPause(true, 'Browser blocked mouse capture — click RESUME again.');
      }
    });
  }

  // ── Main loop ────────────────────────────────────────────────────────────
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dtReal = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.renderTime += dtReal;

    this.fpsFrames++;
    this.fpsTime += dtReal;
    if (this.fpsTime >= 0.5) {
      this.fpsValue = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const simPaused = this.paused || this.invOpen || (this.phase === 'menu' && this.menu.screen === 'settings');
    if (this.slowmoTimer > 0) {
      this.slowmoTimer -= dtReal;
      this.timeScale = this.slowmoTimer > 0 ? 0.35 : 1;
    }
    if (!simPaused) {
      this.acc += dtReal * this.timeScale;
      let steps = 0;
      while (this.acc >= C.SIM_DT && steps < 8) {
        this.tick();
        this.acc -= C.SIM_DT;
        steps++;
      }
      if (steps === 8) this.acc = 0;
    }
    const alpha = simPaused ? 1 : this.acc / C.SIM_DT;
    this.renderFrame(alpha, dtReal);
  }

  private tick(): void {
    const cmds = new Map<number, FighterCommand>();
    const frozen = this.phase === 'countdown' || this.phase === 'results';
    if (this.phase === 'menu') {
      cmds.set(this.player.id, this.attractBrain.update(C.SIM_DT));
      cmds.set(this.bot.id, this.botBrain.update(C.SIM_DT));
    } else {
      let pc = this.input.command();
      if (frozen || this.phase === 'roundEnd' && !this.player.alive) pc = lookOnly(pc);
      cmds.set(this.player.id, pc);
      if (this.sim.fighters.includes(this.bot)) {
        let bc = this.botBrain.update(C.SIM_DT);
        if (frozen) bc = lookOnly(bc);
        cmds.set(this.bot.id, bc);
      }
    }
    this.sim.step(cmds);
    if (this.phase !== 'menu') this.camRig.tick(this.player, C.SIM_DT);
    for (const e of this.sim.events) this.handleEvent(e);
    this.sim.events.length = 0;
    this.updatePhase();
  }

  private updatePhase(): void {
    const dt = C.SIM_DT;
    switch (this.phase) {
      case 'menu': {
        for (const f of [this.player, this.bot]) {
          if (!f.alive && this.sim.time - f.deathTime > 2) {
            this.resetFighters();
            break;
          }
        }
        break;
      }
      case 'countdown': {
        this.phaseTimer -= dt;
        const n = Math.ceil(this.phaseTimer);
        if (this.mode === 'duel' && n <= 2 && n > 0 && n !== this.countdownShown) {
          this.countdownShown = n;
          this.hud.message(String(n), '', 0.8, 'neutral');
          audio.countdown(false);
        }
        if (this.phaseTimer <= 0) {
          this.phase = 'fight';
          if (this.mode === 'duel' || this.mode === 'aim') {
            this.hud.message('FIGHT', '', 0.6, 'gold');
            audio.countdown(true);
          }
          if (this.mode === 'combo' || this.mode === 'aim') this.drillTime = 0;
        }
        break;
      }
      case 'fight': {
        this.drillTime += dt;
        if (this.mode === 'aim' && this.drillTime >= AIM_DRILL_TIME) this.finishDrill();
        if (this.mode === 'combo' || this.mode === 'aim') {
          // Dummies never die; keep them topped up and in bounds.
          if (this.bot.health < 8) this.bot.health = C.MAX_HEALTH;
        }
        if (this.mode === 'movement') {
          const res = this.checkpoints.update(this.player, dt);
          if (res === 'hit') audio.checkpoint();
          if (res === 'done') this.finishDrill();
        }
        break;
      }
      case 'roundEnd': {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          if (this.mode === 'duel' && (this.score.player >= this.firstTo || this.score.bot >= this.firstTo)) this.finishMatch();
          else if (this.mode === 'duel') this.startRound();
          else {
            // Drills: respawn in place and continue
            this.phase = 'fight';
            const saveT = this.drillTime;
            this.resetFighters();
            this.drillTime = saveT;
          }
        }
        break;
      }
    }
  }

  private finishMatch(): void {
    this.phase = 'results';
    this.input.unlock();
    const won = this.score.player > this.score.bot;
    if (won) {
      this.records.wins[this.difficulty] = (this.records.wins[this.difficulty] ?? 0) + 1;
      saveRecords(this.records);
    }
    const p = this.player.stats;
    const b = this.bot.stats;
    const dur = this.sim.time - this.matchStart;
    const acc = p.swings ? Math.round((p.connects / p.swings) * 100) : 0;
    const html = `
      <div class="res-title ${won ? 'win' : 'loss'}">${won ? 'VICTORY' : 'DEFEAT'}</div>
      <div class="res-score"><span class="you">${this.score.player}</span><span class="dash">—</span><span class="them">${this.score.bot}</span></div>
      <div class="res-sub">vs SIEGE BOT · ${BOT_PROFILES[this.difficulty].label} · first to ${this.firstTo}</div>
      <div class="res-grid">
        ${stat('KILLS', p.kills)}${stat('DEATHS', p.deaths)}${stat('HITS', p.hits)}${stat('ACCURACY', acc + '%')}
        ${stat('LONGEST COMBO', p.longestCombo)}${stat('CRITS', p.crits)}${stat('SPRINT HITS', p.sprintHits)}${stat('DURATION', fmtTime(dur))}
      </div>
      <div class="res-compare">Bot: ${b.hits} hits · longest combo ${b.longestCombo} · ${b.sprintHits} sprint hits</div>
      <div class="res-tip">${tipFor(p, b)}</div>`;
    this.overlays.showResults(true, html);
  }

  private finishDrill(): void {
    this.phase = 'results';
    this.input.unlock();
    const p = this.player.stats;
    let html = '';
    if (this.mode === 'aim') {
      const acc = p.swings ? Math.round((p.connects / p.swings) * 100) : 0;
      const best = p.hits > this.records.bestAimScore;
      if (best) this.records.bestAimScore = p.hits;
      html = `<div class="res-title win">AIM DRILL</div><div class="res-score"><span class="you">${p.hits}</span></div><div class="res-sub">damaging hits in ${AIM_DRILL_TIME}s${best ? ' · <b class="gold">NEW BEST</b>' : ''}</div>
        <div class="res-grid">${stat('HITS', p.hits)}${stat('CONNECTS', p.connects)}${stat('SWINGS', p.swings)}${stat('ACCURACY', acc + '%')}${stat('CRITS', p.crits)}${stat('BEST COMBO', p.longestCombo)}</div>
        <div class="res-tip">Accuracy counts every swing that touched the hitbox. Keep your crosshair on the chest while strafing with them.</div>`;
    } else if (this.mode === 'movement') {
      const t = this.checkpoints.elapsed;
      const best = this.records.bestMovementTime === null || t < this.records.bestMovementTime;
      if (best) this.records.bestMovementTime = t;
      html = `<div class="res-title win">COURSE COMPLETE</div><div class="res-score"><span class="you">${t.toFixed(2)}s</span></div><div class="res-sub">${best ? '<b class="gold">NEW BEST</b>' : `best ${this.records.bestMovementTime!.toFixed(2)}s`}</div>
        <div class="res-grid">${this.checkpoints.splits.map((s, i) => stat(`CP ${i + 1}`, s.toFixed(2))).join('')}</div>
        <div class="res-tip">Sprint-jump on long straights: jumping while sprinting adds a burst of speed.</div>`;
    }
    saveRecords(this.records);
    this.overlays.showResults(true, html);
  }

  // ── Events → feedback ────────────────────────────────────────────────────
  private handleEvent(e: SimEvent): void {
    const inMenu = this.phase === 'menu';
    const P = this.player;
    const R = this.renderer;
    switch (e.type) {
      case 'swing':
        if (inMenu) break;
        if (e.fighter === P) {
          R.viewModel.swing();
          audio.swing(e.weapon);
        } else audio.swing(e.weapon, e.fighter.pos);
        break;
      case 'hit': {
        R.particles.hitBurst(e.point, e.dir, e.crit, e.blocked);
        if (e.crit) R.particles.critRing(e.victim.pos);
        if (inMenu) break;
        const mine = e.attacker === P || e.victim === P;
        audio.hit({ crit: e.crit, blocked: e.blocked, sprint: e.sprint, combo: e.combo, mine, pos: e.victim.pos });
        if (e.attacker === P) {
          this.hud.hitmarker(e.crit);
          R.viewModel.hit(e.crit);
          this.camRig.attackKick(e.crit ? 1 : 0.5);
          this.hud.combo(e.combo);
          audio.combo(e.combo);
          if (this.mode === 'combo' && e.combo > this.drillBestCombo) {
            this.drillBestCombo = e.combo;
            if (e.combo > this.records.bestCombo) {
              this.records.bestCombo = e.combo;
              saveRecords(this.records);
            }
          }
        }
        if (e.victim === P) {
          audio.hurt();
          this.camRig.hurt(e.dir, this.input.yaw);
          R.damage = 1;
          const attackerYaw = yawTo(P.pos.x, P.pos.z, e.attacker.pos.x, e.attacker.pos.z);
          this.hud.damage(-angleDiff(this.input.yaw, attackerYaw));
          if (e.combo >= 3) this.hud.comboEnd();
        }
        break;
      }
      case 'comboBreak':
        if (e.fighter === P && !inMenu) this.hud.comboEnd();
        break;
      case 'death': {
        R.particles.deathBurst(e.victim.pos, e.victim.team);
        if (inMenu) break;
        audio.death(e.victim === P ? undefined : e.victim.pos);
        const lake = e.cause === 'void';
        // Only the first death of a round counts.
        if (this.phase !== 'fight') break;
        if (e.victim === P) {
          this.killer = e.killer;
          if (this.mode === 'duel') {
            this.score.bot++;
            this.hud.message(lake ? 'KNOCKED OUT' : 'ELIMINATED', `${e.victim.name === 'You' ? 'by ' + this.bot.name.toUpperCase() : ''}`, 1.4, 'bad');
          } else this.hud.message(lake ? 'INTO THE LAKE' : 'DOWN', '', 1, 'bad');
          this.hud.feedItem(`<b class="red">${this.bot.name}</b> ${lake ? '<i>☄</i>' : '<i>⚔</i>'} <b class="blue">You</b>`);
        } else if (e.victim === this.bot) {
          if (this.mode === 'duel') {
            this.score.player++;
            audio.kill();
            this.slowmoTimer = 0.35;
            this.hud.message(lake ? 'KNOCKED OUT' : 'ELIMINATED', this.bot.name.toUpperCase(), 1.4, 'good');
            this.hud.feedItem(`<b class="blue">You</b> ${lake ? '<i>☄</i>' : '<i>⚔</i>'} <b class="red">${this.bot.name}</b>`);
          }
        }
        if (this.phase === 'fight') {
          this.phase = 'roundEnd';
          this.phaseTimer = this.mode === 'duel' ? C.RESPAWN_DELAY : 0.8;
        }
        break;
      }
      case 'jump':
        if (e.fighter === P && !inMenu) audio.jump();
        break;
      case 'land':
        if (e.speed > 9) R.particles.dust(e.fighter.pos.x, e.fighter.pos.y, e.fighter.pos.z, 8);
        if (e.fighter === P && !inMenu) {
          R.viewModel.land(e.speed);
          this.camRig.land(e.speed);
          audio.land(e.speed);
        }
        break;
      case 'step':
        if (e.fighter.sprinting && Math.random() < 0.35) R.particles.dust(e.fighter.pos.x, e.fighter.pos.y, e.fighter.pos.z, 2);
        if (inMenu) break;
        if (e.fighter === P) audio.step(e.surface, e.sprint);
        else audio.step(e.surface, e.sprint, e.fighter.pos);
        break;
      case 'eat':
        if (!inMenu && (e.fighter === P || e.fighter.pos.distanceTo(P.pos) < 12)) audio.eat();
        break;
      case 'eatDone':
        R.particles.gappleSparkle(e.fighter.pos);
        if (!inMenu && e.fighter === P) audio.eatDone();
        break;
      case 'slot':
        if (e.fighter === P && !inMenu) audio.select();
        break;
      case 'sprintReset':
        break;
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  private renderFrame(alpha: number, dt: number): void {
    const R = this.renderer;
    const P = this.player;
    const t = this.renderTime;

    for (const m of this.models.values()) m.update(alpha, dt, t);

    if (this.phase === 'menu') {
      this.menuCamT += dt;
      const a = this.menuCamT * 0.06 + 0.6;
      const cx = (P.pos.x + this.bot.pos.x) / 2;
      const cz = (P.pos.z + this.bot.pos.z) / 2;
      const cam = R.camera;
      const tx = cx * 0.5;
      const tz = cz * 0.5 + 2;
      cam.position.set(tx + Math.sin(a) * 24, 9 + Math.sin(this.menuCamT * 0.13) * 1.5, tz + Math.cos(a) * 24);
      cam.lookAt(tx, 2.2, tz);
      if (cam.fov !== 60) {
        cam.fov = 60;
        cam.updateProjectionMatrix();
      }
      this.models.get(P.id)!.root.visible = true;
      this.models.get(P.id)!.setNameTagVisible(false);
      this.models.get(this.bot.id)!.setNameTagVisible(false);
    } else {
      this.camRig.update(P, alpha, this.input.yaw, this.input.pitch, dt, this.arena.world, this.killer);
      const tp = this.camRig.isThirdPerson;
      this.models.get(P.id)!.root.visible = tp || !P.alive;
      this.models.get(P.id)!.setNameTagVisible(false);
      this.models.get(this.bot.id)!.setNameTagVisible(this.bot.alive);
      R.showViewModel = !tp && P.alive;
      const bobOn = settings.get('viewBobbing');
      R.viewModel.setBob(-this.camRig.walkPhase(alpha), bobOn ? this.camRig.bobAmount : 0, bobOn ? this.camRig.bobPitch : 0);
      R.viewModel.update(P, dt, R.camera.quaternion, this.input.yaw, this.input.pitch);
      audio.setListener(R.camera.position.x, R.camera.position.y, R.camera.position.z, this.input.yaw);

      // HUD
      this.perfTimer -= dt;
      if (this.perfTimer <= 0) {
        this.perfTimer = 0.25;
        this.hud.setPerf(this.fpsValue, this.input.cps());
      }
      this.hud.setHealth(Math.max(0, P.health), P.absorption);
      this.hud.setHotbar(P.inventory, P.selected);
      this.hud.setSprint(P.sprintLock ? 'locked' : P.sprinting ? 'on' : 'off');
      this.hud.setEat(P.eating);
      const hasBot = this.sim.fighters.includes(this.bot);
      this.hud.setOpponent(hasBot ? `${this.bot.name.toUpperCase()}${this.mode === 'duel' ? ' · ' + BOT_PROFILES[this.difficulty].label : ''}` : null, this.bot.health, this.bot.absorption);
      this.hud.setScore(
        this.mode === 'duel'
          ? `<span class="you">${this.score.player}</span><span class="pips">${pips(this.score.player, this.firstTo, 'blue')}<i>FT${this.firstTo}</i>${pips(this.score.bot, this.firstTo, 'red')}</span><span class="them">${this.score.bot}</span>`
          : null,
      );
      this.hud.setDrill(this.drillHtml());
      this.hud.update(dt, P.health, this.bot.health);
      this.hud.setLockHint(!this.input.locked && !this.paused && !this.invOpen && this.phase !== 'results');
    }

    this.checkpoints.render(t);
    R.damage = Math.max(0, R.damage - dt * 2.2);
    R.lowHealth = this.phase !== 'menu' && P.alive && P.health <= 6 ? 1 - P.health / 6 * 0.6 : 0;
    R.render(t, dt);
  }

  private drillHtml(): string | null {
    const cp = this.checkpoints;
    switch (this.mode) {
      case 'combo':
        return `<div class="dr-title">COMBO DRILL</div><div class="dr-row"><span>CURRENT</span><b>${this.player.combo}</b></div><div class="dr-row"><span>SESSION BEST</span><b>${this.drillBestCombo}</b></div><div class="dr-row"><span>ALL-TIME</span><b>${this.records.bestCombo}</b></div><div class="dr-hint">Land a sprint hit, release W for a split second, press again. Repeat.</div>`;
      case 'aim': {
        const left = Math.max(0, AIM_DRILL_TIME - (this.phase === 'fight' ? this.drillTime : 0));
        const p = this.player.stats;
        const acc = p.swings ? Math.round((p.connects / p.swings) * 100) : 0;
        return `<div class="dr-title">AIM DRILL</div><div class="dr-big">${left.toFixed(1)}</div><div class="dr-row"><span>HITS</span><b>${p.hits}</b></div><div class="dr-row"><span>ACCURACY</span><b>${acc}%</b></div>`;
      }
      case 'movement':
        return `<div class="dr-title">MOVEMENT</div><div class="dr-big">${cp.elapsed.toFixed(2)}</div><div class="dr-row"><span>CHECKPOINT</span><b>${cp.index}/${cp.count}</b></div><div class="dr-hint">${cp.started ? 'Follow the beacon.' : 'Timer starts when you move.'}</div>`;
      default:
        return null;
    }
  }

  // ── Debug / automated playtest hooks ────────────────────────────────────
  private exposeDebug(): void {
    (window as unknown as { __siege: unknown }).__siege = {
      game: this,
      sim: this.sim,
      player: this.player,
      bot: this.bot,
      start: (m: GameMode) => this.startMode(m),
      /** Simulate input without pointer lock (for automated tests). */
      forceInput: (on: boolean) => {
        this.input.locked = on;
        this.input.enabled = on;
      },
      state: () => ({ phase: this.phase, mode: this.mode, score: this.score, fps: this.fpsValue, botMode: this.botBrain.currentMode }),
    };
  }
}

function lookOnly(c: FighterCommand): FighterCommand {
  const o = emptyCommand();
  o.yaw = c.yaw;
  o.pitch = c.pitch;
  o.slot = c.slot;
  return o;
}

function stat(label: string, v: string | number): string {
  return `<div class="res-stat"><span>${label}</span><b>${v}</b></div>`;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function pips(n: number, of: number, team: string): string {
  if (of <= 1) return '';
  let s = '';
  for (let i = 0; i < of; i++) s += `<b class="pip ${team} ${i < n ? 'on' : ''}"></b>`;
  return s;
}

function tipFor(p: ReturnType<typeof emptyStats>, b: ReturnType<typeof emptyStats>): string {
  if (p.hits > 4 && p.sprintHits / p.hits < 0.3)
    return 'Tip: most of your hits were without sprint. Release W for a split second after each hit (W-tap) to re-arm sprint knockback.';
  if (b.longestCombo >= 4) return 'Tip: when you get comboed, strafe hard to one side — knockback pushes you in a straight line.';
  if (p.swings > 0 && p.connects / p.swings < 0.35)
    return 'Tip: lots of swings missed the hitbox. Track the chest and strafe with your opponent to keep your crosshair steady.';
  if (p.crits < 2) return 'Tip: jump as your opponent is stunned and hit them while falling for a critical hit.';
  return 'Tip: hold your spacing around 2.8 blocks — hit at the edge of reach so they can’t hit back.';
}
