import { h, show } from './dom';
import { settings, loadLoadout, saveLoadout, loadRecords, type Settings } from '../config/settings';
import { audio } from '../audio/AudioEngine';
import { InventoryUI } from './InventoryUI';
import { defaultLoadout } from '../weapons/Items';
import { BOT_PROFILES, type BotDifficulty } from '../entities/BotBrain';

export type GameMode = 'duel' | 'combo' | 'aim' | 'movement';

export interface MenuCallbacks {
  start(mode: GameMode): void;
}

type Screen = 'main' | 'modes' | 'loadout' | 'settings' | 'none';

function btn(label: string, onclick: () => void, cls = 'menu-btn', idx?: string): HTMLButtonElement {
  const b = h('button', { class: cls }, idx ? h('span', { class: 'idx' }, idx) : null, h('span', { class: 'lbl' }, label));
  b.addEventListener('mouseenter', () => audio.uiHover());
  b.addEventListener('click', () => {
    audio.unlock();
    audio.uiClick();
    onclick();
  });
  return b;
}

export class Menu {
  readonly root: HTMLElement;
  private screens: Record<Exclude<Screen, 'none'>, HTMLElement>;
  private current: Screen = 'main';
  private loadoutInv: InventoryUI;
  private modeCards: HTMLElement;
  private settingsPanel: SettingsPanel;
  private selectedMode: GameMode = 'duel';
  /** Where the settings screen returns to. */
  settingsBack: () => void = () => this.go('main');

  constructor(parent: HTMLElement, private cb: MenuCallbacks) {
    // ── Main ──
    const main = h(
      'div',
      { class: 'screen main-screen' },
      h(
        'div',
        { class: 'brand' },
        h('div', { class: 'logo' }, h('span', { class: 'logo-a' }, 'SIEGE'), h('span', { class: 'logo-b' }, 'prac')),
        h('div', { class: 'tagline' }, 'MASTER THE FIGHT.'),
      ),
      h(
        'nav',
        { class: 'main-nav' },
        btn('PLAY', () => this.openModes('duel'), 'menu-btn primary', '01'),
        btn('PRACTICE', () => this.openModes('combo'), 'menu-btn', '02'),
        btn('LOADOUT', () => this.go('loadout'), 'menu-btn', '03'),
        btn('SETTINGS', () => {
          this.settingsBack = () => this.go('main');
          this.go('settings');
        }, 'menu-btn', '04'),
      ),
      h(
        'div',
        { class: 'controls-strip' },
        ...[
          ['WASD', 'Move'],
          ['SPACE', 'Jump'],
          ['SHIFT', 'Sneak'],
          ['LMB', 'Attack'],
          ['RMB', 'Block / Eat'],
          ['1-9', 'Slots'],
          ['E', 'Inventory'],
          ['R', 'Rematch'],
        ].map(([k, v]) => h('div', { class: 'ctl' }, h('kbd', null, k), h('span', null, v))),
      ),
      h('div', { class: 'version' }, 'FIRST STRIKE · v0.1'),
    );

    // ── Modes ──
    this.modeCards = h('div', { class: 'mode-grid' });
    const modes = h(
      'div',
      { class: 'screen modes-screen' },
      h('div', { class: 'screen-head' }, btn('BACK', () => this.go('main'), 'btn-ghost back'), h('h2', null, 'SELECT MODE')),
      this.modeCards,
    );

    // ── Loadout ──
    const loadoutWrap = h('div', { class: 'loadout-wrap' });
    this.loadoutInv = new InventoryUI(loadoutWrap, false);
    const loadout = h(
      'div',
      { class: 'screen loadout-screen' },
      h(
        'div',
        { class: 'screen-head' },
        btn('BACK', () => this.go('main'), 'btn-ghost back'),
        h('h2', null, 'LOADOUT'),
        btn('RESET DEFAULT', () => {
          const d = defaultLoadout();
          this.loadoutState.splice(0, this.loadoutState.length, ...d);
          saveLoadout(this.loadoutState);
          this.loadoutInv.render();
        }, 'btn-ghost right'),
      ),
      h('p', { class: 'screen-sub' }, 'Arrange your kit. Every round starts with this layout.'),
      loadoutWrap,
    );
    this.loadoutInv.onChange = () => saveLoadout(this.loadoutState);

    // ── Settings ──
    this.settingsPanel = new SettingsPanel();
    const settingsScreen = h(
      'div',
      { class: 'screen settings-screen' },
      h(
        'div',
        { class: 'screen-head' },
        btn('BACK', () => this.settingsBack(), 'btn-ghost back'),
        h('h2', null, 'SETTINGS'),
        btn('RESET DEFAULTS', () => {
          settings.reset();
          this.settingsPanel.refresh();
        }, 'btn-ghost right'),
      ),
      this.settingsPanel.root,
    );

    this.screens = { main, modes, loadout, settings: settingsScreen };
    this.root = h('div', { id: 'menu' }, h('div', { class: 'menu-shade' }), main, modes, loadout, settingsScreen);
    parent.appendChild(this.root);
    this.go('main');
  }

  private loadoutState = loadLoadout();

  go(s: Screen): void {
    this.current = s;
    show(this.root, s !== 'none');
    for (const [k, el] of Object.entries(this.screens)) show(el, k === s);
    if (s === 'loadout') {
      this.loadoutState = loadLoadout();
      this.loadoutInv.bind(this.loadoutState, 'YOUR KIT');
    }
    if (s === 'settings') this.settingsPanel.refresh();
    this.root.classList.toggle('dim', s !== 'main');
  }

  get screen(): Screen {
    return this.current;
  }

  openModes(focus: GameMode): void {
    this.selectedMode = focus;
    this.renderModes();
    this.go('modes');
  }

  private renderModes(): void {
    const rec = loadRecords();
    const diff = settings.get('difficulty');
    const firstTo = settings.get('firstTo');
    const card = (mode: GameMode, title: string, desc: string, extra: HTMLElement | null, record: string) => {
      const el = h(
        'div',
        { class: `mode-card ${this.selectedMode === mode ? 'active' : ''}` },
        h('div', { class: 'mode-title' }, title),
        h('div', { class: 'mode-desc' }, desc),
        extra,
        h('div', { class: 'mode-foot' }, h('span', { class: 'mode-rec' }, record), btn('START', () => this.cb.start(mode), 'btn-solid')),
      );
      el.addEventListener('mouseenter', () => {
        if (this.selectedMode === mode) return;
        this.selectedMode = mode;
        this.modeCards.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('active'));
        el.classList.add('active');
      });
      return el;
    };
    const seg = <T extends string | number>(label: string, opts: [T, string][], cur: T, set: (v: T) => void) =>
      h(
        'div',
        { class: 'seg-row' },
        h('span', { class: 'seg-label' }, label),
        h(
          'div',
          { class: 'seg' },
          ...opts.map(([v, l]) => {
            const b = h('button', { class: v === cur ? 'on' : '' }, l);
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              audio.uiClick();
              set(v);
              this.renderModes();
            });
            return b;
          }),
        ),
      );
    const wins = (d: BotDifficulty) => rec.wins[d] ?? 0;
    const duelExtra = h(
      'div',
      { class: 'mode-opts' },
      seg<BotDifficulty>(
        'BOT',
        (Object.keys(BOT_PROFILES) as BotDifficulty[]).map((d) => [d, BOT_PROFILES[d].label]),
        diff,
        (v) => settings.set('difficulty', v),
      ),
      seg<number>('FIRST TO', [[1, '1'], [3, '3'], [5, '5']], firstTo, (v) => settings.set('firstTo', v)),
      h('div', { class: 'diff-note' }, DIFF_NOTES[diff]),
    );
    this.modeCards.replaceChildren(
      card('duel', 'BOT DUEL', 'A real 1v1 against the practice bot. Strafe, space, W-tap, combo.', duelExtra, `WINS VS ${BOT_PROFILES[diff].label}: ${wins(diff)}`),
      card('combo', 'COMBO', 'A dummy that walks into you. Chain hits and keep sprint knockback with W-taps.', null, `BEST COMBO: ${rec.bestCombo}`),
      card('aim', 'AIM', '40 seconds. An evasive target strafes and jumps. Track it and land clean hits.', null, `BEST: ${rec.bestAimScore} HITS`),
      card('movement', 'MOVEMENT', 'Race through 12 checkpoints across the arena. Sprint-jump, take the stairs, cut corners.', null, rec.bestMovementTime ? `BEST: ${rec.bestMovementTime.toFixed(2)}s` : 'NO TIME SET'),
    );
  }
}

const DIFF_NOTES: Record<BotDifficulty, string> = {
  easy: 'Slow reactions, loose aim. Learn the basics.',
  normal: 'Strafes, spaces, W-taps sometimes. A real fight.',
  hard: 'Fast tracking, crits, disciplined resets.',
  siege: 'Learns your strafe rhythm. Punishes patterns.',
};

// ── Settings panel ─────────────────────────────────────────────────────────
class SettingsPanel {
  readonly root = h('div', { class: 'settings-grid' });
  private refreshers: (() => void)[] = [];

  constructor() {
    const col = (title: string, ...rows: HTMLElement[]) => h('div', { class: 'set-col' }, h('h3', null, title), ...rows);
    this.root.append(
      col(
        'CONTROLS',
        this.slider('Mouse sensitivity', 'sensitivity', 0.1, 4, 0.01, (v) => v.toFixed(2)),
        this.slider('Field of view', 'fov', 70, 110, 1, (v) => `${v}°`),
        this.toggle('Auto-sprint (Shift = sneak)', 'autoSprint'),
        this.toggle('Raw mouse input', 'rawInput'),
        this.toggle('Invert Y', 'invertY'),
      ),
      col(
        'VIDEO',
        this.choice('Graphics quality', 'quality', [
          ['low', 'LOW'],
          ['medium', 'MED'],
          ['high', 'HIGH'],
        ]),
        this.toggle('Particles', 'particles'),
        this.slider('Camera shake', 'cameraShake', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
        this.toggle('View bobbing', 'viewBobbing'),
        this.toggle('FPS counter', 'showFps'),
        this.toggle('CPS counter', 'showCps'),
        this.choice('Crosshair', 'crosshair', [
          ['cross', 'CROSS'],
          ['dot', 'DOT'],
          ['circle', 'RING'],
        ]),
        this.choice('Crosshair color', 'crosshairColor', [
          ['#ffffff', 'WHITE'],
          ['#7dff8a', 'GREEN'],
          ['#62e0ff', 'CYAN'],
          ['#ffe45c', 'YELLOW'],
        ]),
      ),
      col(
        'AUDIO',
        this.slider('Master volume', 'masterVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
        this.slider('Music volume', 'musicVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
        this.slider('SFX volume', 'sfxVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      ),
    );
  }

  refresh(): void {
    for (const r of this.refreshers) r();
  }

  private slider(label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement {
    const input = h('input', { type: 'range', min, max, step }) as HTMLInputElement;
    const val = h('input', { type: 'text', class: 'set-val' }) as HTMLInputElement;
    const sync = () => {
      const v = settings.get(key) as number;
      input.value = String(v);
      val.value = fmt(v);
      input.style.setProperty('--p', `${((v - min) / (max - min)) * 100}%`);
    };
    input.addEventListener('input', () => {
      settings.set(key, Number(input.value) as never);
      sync();
    });
    val.addEventListener('change', () => {
      const n = parseFloat(val.value);
      if (Number.isFinite(n)) settings.set(key, Math.min(max, Math.max(min, n)) as never);
      sync();
    });
    this.refreshers.push(sync);
    sync();
    return h('div', { class: 'set-row' }, h('label', null, label), h('div', { class: 'set-ctl' }, input, val));
  }

  private toggle(label: string, key: keyof Settings): HTMLElement {
    const b = h('button', { class: 'toggle' }, h('span'));
    const sync = () => b.classList.toggle('on', !!settings.get(key));
    b.addEventListener('click', () => {
      audio.uiClick();
      settings.set(key, !settings.get(key) as never);
      sync();
    });
    this.refreshers.push(sync);
    sync();
    return h('div', { class: 'set-row' }, h('label', null, label), h('div', { class: 'set-ctl' }, b));
  }

  private choice(label: string, key: keyof Settings, opts: [string, string][]): HTMLElement {
    const seg = h('div', { class: 'seg' });
    const buttons = opts.map(([v, l]) => {
      const b = h('button', null, l);
      b.addEventListener('click', () => {
        audio.uiClick();
        settings.set(key, v as never);
        sync();
      });
      seg.appendChild(b);
      return b;
    });
    const sync = () => buttons.forEach((b, i) => b.classList.toggle('on', settings.get(key) === opts[i][0]));
    this.refreshers.push(sync);
    sync();
    return h('div', { class: 'set-row' }, h('label', null, label), h('div', { class: 'set-ctl' }, seg));
  }
}

// ── Pause & results overlays ─────────────────────────────────────────────
export class Overlays {
  readonly pause: HTMLElement;
  readonly results: HTMLElement;
  private resultsBody = h('div', { class: 'res-body' });
  private pauseMsg = h('div', { class: 'pause-msg' });

  constructor(
    parent: HTMLElement,
    cb: { resume(): void; restart(): void; settings(): void; menu(): void; changeMode(): void },
  ) {
    this.pause = h(
      'div',
      { class: 'overlay pause hidden' },
      h(
        'div',
        { class: 'pause-panel' },
        h('h2', null, 'PAUSED'),
        this.pauseMsg,
        btn('RESUME', () => cb.resume(), 'menu-btn primary small'),
        btn('RESTART', () => cb.restart(), 'menu-btn small'),
        btn('SETTINGS', () => cb.settings(), 'menu-btn small'),
        btn('MAIN MENU', () => cb.menu(), 'menu-btn small'),
      ),
    );
    this.results = h(
      'div',
      { class: 'overlay results hidden' },
      h(
        'div',
        { class: 'res-panel' },
        this.resultsBody,
        h(
          'div',
          { class: 'res-actions' },
          btn('REMATCH  [R]', () => cb.restart(), 'btn-solid big'),
          btn('CHANGE MODE', () => cb.changeMode(), 'btn-ghost'),
          btn('MAIN MENU', () => cb.menu(), 'btn-ghost'),
        ),
      ),
    );
    parent.append(this.pause, this.results);
  }

  showPause(v: boolean, msg = ''): void {
    show(this.pause, v);
    this.pauseMsg.textContent = msg;
  }

  showResults(v: boolean, html = ''): void {
    show(this.results, v);
    if (v) this.resultsBody.innerHTML = html;
  }
}
