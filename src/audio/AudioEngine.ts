import { Block } from '../game/World';

/**
 * Fully procedural audio (WebAudio synthesis — no external assets).
 * Every combat sound is layered from a few primitives so it reads as punchy
 * and physical without getting grating on repetition (small random pitch/timbre drift).
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private volumes = { master: 0.8, music: 0.35, sfx: 0.9 };
  private musicNodes: { stop: () => void } | null = null;
  private musicMode: 'menu' | 'game' | 'off' = 'off';
  private listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.connect(comp);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music = this.ctx.createGain();
      this.music.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      if (this.musicMode !== 'off') {
        const m = this.musicMode;
        this.musicMode = 'off';
        this.setMusic(m);
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfx.gain.value = this.volumes.sfx;
    this.music.gain.value = this.volumes.music * 0.5;
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener = { x, y, z, fx: -Math.sin(yaw), fz: -Math.cos(yaw) };
  }

  // ── primitives ────────────────────────────────────────────────────────────
  private now(): number {
    return this.ctx!.currentTime;
  }

  /** A destination node, optionally panned/attenuated for a world position. */
  private out(gain: number, pos?: { x: number; y: number; z: number }): AudioNode {
    const c = this.ctx!;
    const g = c.createGain();
    let vol = gain;
    if (pos) {
      const dx = pos.x - this.listener.x;
      const dz = pos.z - this.listener.z;
      const dy = pos.y - this.listener.y;
      const dist = Math.hypot(dx, dy, dz);
      vol *= 1 / (1 + Math.max(0, dist - 2) * 0.12);
      const rx = -this.listener.fz;
      const rz = this.listener.fx;
      const pan = dist > 0.1 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist)) : 0;
      const p = c.createStereoPanner();
      p.pan.value = pan * 0.75;
      g.connect(p);
      p.connect(this.sfx);
    } else {
      g.connect(this.sfx);
    }
    g.gain.value = vol;
    return g;
  }

  private tone(
    dest: AudioNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    t0: number,
    dur: number,
    peak: number,
    attack = 0.003,
  ): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private burst(
    dest: AudioNode,
    filter: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    t0: number,
    dur: number,
    peak: number,
    attack = 0.002,
  ): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  private ok(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private jitter(v: number, amt = 0.06): number {
    return v * (1 + (Math.random() * 2 - 1) * amt);
  }

  // ── combat ────────────────────────────────────────────────────────────────
  swing(weapon: string, pos?: { x: number; y: number; z: number }): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(pos ? 0.5 : 0.42, pos);
    if (weapon === 'axe') {
      this.burst(d, 'bandpass', 300, 1100, 1.2, t, 0.2, 0.8, 0.02);
    } else {
      this.burst(d, 'bandpass', this.jitter(700), this.jitter(2600), 1.6, t, 0.13, 0.7, 0.012);
      this.burst(d, 'highpass', 4000, 7000, 0.7, t + 0.01, 0.06, 0.12);
    }
  }

  hit(opts: { crit: boolean; blocked: boolean; sprint: boolean; combo: number; mine: boolean; pos?: { x: number; y: number; z: number } }): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(opts.mine ? 0.95 : 0.7, opts.mine ? undefined : opts.pos);
    const comboPitch = 1 + Math.min(opts.combo, 8) * 0.035;
    if (opts.blocked) {
      this.tone(d, 'triangle', 900, 700, t, 0.12, 0.35);
      this.burst(d, 'bandpass', 3200, 2400, 4, t, 0.09, 0.6);
      this.tone(d, 'sine', 120, 60, t, 0.1, 0.5);
      return;
    }
    // body thump
    this.tone(d, 'sine', this.jitter(150), 48, t, 0.16, 1.0, 0.002);
    // meaty mid
    this.burst(d, 'lowpass', 1800, 300, 0.8, t, 0.09, 0.9);
    // blade "shk"
    this.burst(d, 'bandpass', this.jitter(3000) * comboPitch, 1800, 2.5, t, 0.07, 0.55);
    if (opts.sprint) this.tone(d, 'sine', 90, 40, t, 0.2, 0.5);
    if (opts.crit) {
      this.tone(d, 'triangle', 1500 * comboPitch, 2300, t + 0.005, 0.28, 0.28);
      this.tone(d, 'sine', 2600 * comboPitch, 2000, t + 0.01, 0.35, 0.18);
      this.burst(d, 'highpass', 5000, 9000, 0.8, t, 0.12, 0.35);
    }
  }

  hurt(): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.8);
    this.tone(d, 'sine', 110, 45, t, 0.18, 1.0);
    this.burst(d, 'lowpass', 900, 200, 1, t, 0.12, 0.8);
    this.tone(d, 'sawtooth', this.jitter(210), 120, t + 0.01, 0.12, 0.08);
  }

  death(pos?: { x: number; y: number; z: number }): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.8, pos);
    this.tone(d, 'sawtooth', 380, 60, t, 0.7, 0.15, 0.01);
    this.burst(d, 'lowpass', 2400, 120, 1, t, 0.6, 0.7);
    this.tone(d, 'sine', 160, 35, t, 0.5, 0.8);
  }

  kill(): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.5);
    this.tone(d, 'triangle', 880, 880, t, 0.14, 0.4);
    this.tone(d, 'triangle', 1320, 1320, t + 0.08, 0.3, 0.4);
    this.tone(d, 'sine', 1760, 1760, t + 0.08, 0.35, 0.15);
  }

  combo(n: number): void {
    if (!this.ok() || n < 3) return;
    const t = this.now();
    const d = this.out(0.18);
    this.tone(d, 'sine', 700 + Math.min(n, 10) * 60, 700 + Math.min(n, 10) * 60, t, 0.08, 0.3);
  }

  sprintReset(): void {
    if (!this.ok()) return;
    const t = this.now();
    this.burst(this.out(0.12), 'bandpass', 1800, 2600, 3, t, 0.04, 0.4);
  }

  // ── movement ──────────────────────────────────────────────────────────────
  step(surface: number, sprint: boolean, pos?: { x: number; y: number; z: number }): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out((sprint ? 0.32 : 0.24) * (pos ? 0.9 : 1), pos);
    if (surface === Block.Grass || surface === Block.Moss || surface === Block.Dirt || surface === Block.Leaves) {
      this.burst(d, 'lowpass', 1400, 500, 0.7, t, 0.09, 0.6, 0.006);
    } else if (surface === Block.Planks || surface === Block.SlabPlanks || surface === Block.Log) {
      this.burst(d, 'bandpass', 520, 380, 2.5, t, 0.08, 0.9);
      this.tone(d, 'sine', 180, 120, t, 0.06, 0.3);
    } else if (surface === Block.Sand || surface === Block.Clay) {
      this.burst(d, 'bandpass', 2400, 1600, 0.8, t, 0.11, 0.4, 0.01);
    } else {
      this.burst(d, 'bandpass', this.jitter(1500, 0.15), 900, 1.4, t, 0.06, 0.7);
      this.tone(d, 'sine', 140, 90, t, 0.05, 0.25);
    }
  }

  jump(): void {
    if (!this.ok()) return;
    const t = this.now();
    this.burst(this.out(0.15), 'bandpass', 600, 1400, 1, t, 0.12, 0.4, 0.01);
  }

  land(speed: number): void {
    if (!this.ok() || speed < 4) return;
    const t = this.now();
    const k = Math.min(1, (speed - 4) / 12);
    const d = this.out(0.3 + k * 0.5);
    this.tone(d, 'sine', 120, 45, t, 0.12 + k * 0.1, 0.9);
    this.burst(d, 'lowpass', 1200, 200, 0.8, t, 0.1, 0.6);
  }

  eat(): void {
    if (!this.ok()) return;
    const t = this.now();
    this.burst(this.out(0.3), 'bandpass', this.jitter(1600, 0.3), 900, 2, t, 0.07, 0.7);
  }

  eatDone(): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.35);
    [660, 880, 1320].forEach((f, i) => this.tone(d, 'triangle', f, f, t + i * 0.06, 0.25, 0.35));
  }

  throwItem(pos?: { x: number; y: number; z: number }): void {
    if (!this.ok()) return;
    const t = this.now();
    this.burst(this.out(0.22, pos), 'bandpass', 500, 1600, 1.2, t, 0.16, 0.6, 0.02);
  }

  /** Splash potion shattering: glassy tinkles over a short crash. */
  glass(pos?: { x: number; y: number; z: number }): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.5, pos);
    this.burst(d, 'highpass', 3000, 6000, 0.7, t, 0.12, 0.8);
    for (let i = 0; i < 5; i++) {
      const f = 2400 + Math.random() * 3200;
      this.tone(d, 'triangle', f, f * 0.97, t + i * 0.025 + Math.random() * 0.02, 0.18, 0.12);
    }
    this.burst(d, 'lowpass', 900, 300, 0.7, t, 0.1, 0.4);
  }

  heal(): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.2);
    this.tone(d, 'sine', 660, 990, t, 0.25, 0.4, 0.02);
  }

  pearl(pos?: { x: number; y: number; z: number }): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.45, pos);
    this.tone(d, 'sawtooth', 900, 120, t, 0.35, 0.12, 0.01);
    this.burst(d, 'bandpass', 2000, 300, 2, t, 0.3, 0.5);
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  uiHover(): void {
    if (!this.ok()) return;
    this.tone(this.out(0.08), 'sine', 2200, 2000, this.now(), 0.03, 0.5);
  }

  uiClick(): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.25);
    this.tone(d, 'triangle', 1200, 1200, t, 0.05, 0.6);
    this.tone(d, 'triangle', 1800, 1800, t + 0.045, 0.06, 0.5);
  }

  select(): void {
    if (!this.ok()) return;
    this.tone(this.out(0.12), 'triangle', 1500, 1700, this.now(), 0.04, 0.5);
  }

  countdown(go: boolean): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.35);
    if (go) {
      this.tone(d, 'triangle', 990, 990, t, 0.4, 0.6);
      this.tone(d, 'sine', 1980, 1980, t, 0.4, 0.2);
    } else this.tone(d, 'triangle', 660, 660, t, 0.14, 0.5);
  }

  checkpoint(): void {
    if (!this.ok()) return;
    const t = this.now();
    const d = this.out(0.3);
    this.tone(d, 'triangle', 1046, 1046, t, 0.1, 0.5);
    this.tone(d, 'triangle', 1568, 1568, t + 0.06, 0.18, 0.5);
  }

  // ── music: a slow generative pad, calm in menus and quieter in game ─────
  setMusic(mode: 'menu' | 'game' | 'off'): void {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    this.musicNodes?.stop();
    this.musicNodes = null;
    if (!this.ctx || mode === 'off') return;
    const c = this.ctx;
    const bus = c.createGain();
    bus.gain.value = 0;
    bus.gain.linearRampToValueAtTime(mode === 'menu' ? 1 : 0.45, c.currentTime + 2.5);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = mode === 'menu' ? 1400 : 900;
    lp.Q.value = 0.4;
    const delay = c.createDelay(1.0);
    delay.delayTime.value = 0.42;
    const fb = c.createGain();
    fb.gain.value = 0.35;
    delay.connect(fb);
    fb.connect(delay);
    lp.connect(bus);
    lp.connect(delay);
    delay.connect(bus);
    bus.connect(this.music);

    // i - VI - III - VII in D minor
    const chords = [
      [146.83, 174.61, 220.0, 293.66],
      [116.54, 146.83, 174.61, 233.08],
      [174.61, 220.0, 261.63, 349.23],
      [130.81, 164.81, 196.0, 261.63],
    ];
    let step = 0;
    let stopped = false;
    const barLen = 4.2;
    const playBar = () => {
      if (stopped || !this.ctx) return;
      const t = c.currentTime + 0.05;
      const ch = chords[step % chords.length];
      for (const f of ch) {
        for (const det of [-6, 6]) {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.018, t + 1.2);
          g.gain.linearRampToValueAtTime(0.012, t + barLen - 0.6);
          g.gain.linearRampToValueAtTime(0.0001, t + barLen + 0.8);
          o.connect(g);
          g.connect(lp);
          o.start(t);
          o.stop(t + barLen + 1);
        }
      }
      // soft pluck arpeggio
      for (let i = 0; i < 6; i++) {
        const f = ch[(i * 3 + step) % ch.length] * 2;
        const tt = t + 0.35 + i * 0.62;
        const o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(mode === 'menu' ? 0.05 : 0.025, tt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.1);
        o.connect(g);
        g.connect(lp);
        o.start(tt);
        o.stop(tt + 1.2);
      }
      step++;
    };
    playBar();
    const id = window.setInterval(playBar, barLen * 1000);
    this.musicNodes = {
      stop: () => {
        stopped = true;
        window.clearInterval(id);
        const t = c.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(bus.gain.value, t);
        bus.gain.linearRampToValueAtTime(0, t + 0.8);
        window.setTimeout(() => bus.disconnect(), 2000);
      },
    };
  }
}

export const audio = new AudioEngine();
