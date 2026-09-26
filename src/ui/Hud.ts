import { h, setText, show } from './dom';
import { itemIcon } from './icons';
import { type ItemStack, HOTBAR_SIZE, ITEMS } from '../weapons/Items';
import { MAX_HEALTH, EAT_TIME } from '../config/constants';
import { settings } from '../config/settings';

const HEART_PATH =
  'M8 14.2 1.9 8.4C.4 6.9.4 4.4 1.9 2.9s4-1.5 5.5 0L8 3.5l.6-.6c1.5-1.5 4-1.5 5.5 0s1.5 4 0 5.5z';

function heartSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.classList.add('heart');
  const bg = document.createElementNS(ns, 'path');
  bg.setAttribute('d', HEART_PATH);
  bg.setAttribute('class', 'heart-bg');
  const clip = document.createElementNS(ns, 'clipPath');
  const id = 'hc' + Math.random().toString(36).slice(2);
  clip.setAttribute('id', id);
  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width', '16');
  rect.setAttribute('height', '16');
  clip.appendChild(rect);
  const fg = document.createElementNS(ns, 'path');
  fg.setAttribute('d', HEART_PATH);
  fg.setAttribute('class', 'heart-fg');
  fg.setAttribute('clip-path', `url(#${id})`);
  svg.append(clip, bg, fg);
  return svg;
}

export class Hud {
  readonly root: HTMLElement;
  private fps = h('div', { class: 'perf-line' });
  private cps = h('div', { class: 'perf-line' });
  private crosshair = h('div', { class: 'crosshair' });
  private hitmark = h('div', { class: 'hitmarker' });
  private dmgIndicator = h('div', { class: 'dmg-indicator' });
  private comboEl = h('div', { class: 'combo hidden' });
  private comboNum = h('span', { class: 'combo-num' });
  private center = h('div', { class: 'center-msg' });
  private feed = h('div', { class: 'killfeed' });
  private drill = h('div', { class: 'drill-info hidden' });
  private hearts: SVGSVGElement[] = [];
  private heartsEl = h('div', { class: 'hearts' });
  private hpFill = h('div', { class: 'hp-fill' });
  private hpGhost = h('div', { class: 'hp-ghost' });
  private hpAbsorb = h('div', { class: 'hp-absorb' });
  private hpText = h('div', { class: 'hp-text' });
  private hotbar = h('div', { class: 'hotbar' });
  private slots: HTMLElement[] = [];
  private itemName = h('div', { class: 'item-name' });
  private sprint = h('div', { class: 'sprint-ind' });
  private eatBar = h('div', { class: 'eat-bar hidden' }, h('div', { class: 'eat-fill' }));
  private opp = h('div', { class: 'opponent hidden' });
  private oppName = h('div', { class: 'opp-name' });
  private oppFill = h('div', { class: 'hp-fill' });
  private oppGhost = h('div', { class: 'hp-ghost' });
  private oppAbsorb = h('div', { class: 'hp-absorb' });
  private scoreEl = h('div', { class: 'score' });
  private lockHint = h('div', { class: 'lock-hint hidden' }, h('div', { class: 'lock-key' }, 'CLICK'), h('div', null, 'TO CAPTURE MOUSE'));
  private ghost = MAX_HEALTH;
  private oppGhostV = MAX_HEALTH;
  private lastHp = -1;
  private lastOpp = -1;
  private itemNameTimer = 0;
  private centerTimer = 0;
  private comboTimer = 0;
  private hitTimer = 0;
  private dmgTimer = 0;
  private hotbarKey = '';

  constructor(parent: HTMLElement) {
    for (let i = 0; i < 10; i++) {
      const s = heartSvg();
      this.hearts.push(s);
      this.heartsEl.appendChild(s);
    }
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = h('div', { class: 'slot' }, h('span', { class: 'slot-num' }, String(i + 1)), h('img', { class: 'slot-icon', alt: '' }), h('span', { class: 'slot-count' }));
      this.slots.push(s);
      this.hotbar.appendChild(s);
    }
    this.comboEl.append(this.comboNum, h('span', { class: 'combo-label' }, 'HIT COMBO'));
    this.opp.append(
      this.scoreEl,
      this.oppName,
      h('div', { class: 'hp-bar opp-bar' }, this.oppGhost, this.oppFill, this.oppAbsorb),
    );
    this.root = h(
      'div',
      { id: 'hud', class: 'hidden' },
      h('div', { class: 'perf' }, this.cps, this.fps),
      this.opp,
      this.feed,
      this.drill,
      this.crosshair,
      this.hitmark,
      this.dmgIndicator,
      this.comboEl,
      this.center,
      this.lockHint,
      h(
        'div',
        { class: 'bottom' },
        this.itemName,
        this.eatBar,
        h(
          'div',
          { class: 'status' },
          this.sprint,
          h('div', { class: 'vitals' }, this.heartsEl, h('div', { class: 'hp-bar' }, this.hpGhost, this.hpFill, this.hpAbsorb), this.hpText),
        ),
        this.hotbar,
      ),
    );
    parent.appendChild(this.root);
    this.applySettings();
    settings.onChange(() => this.applySettings());
  }

  applySettings(): void {
    show(this.fps, settings.get('showFps'));
    show(this.cps, settings.get('showCps'));
    this.crosshair.className = 'crosshair ' + settings.get('crosshair');
    this.root.style.setProperty('--xhair', settings.get('crosshairColor'));
  }

  setVisible(v: boolean): void {
    show(this.root, v);
  }

  setLockHint(v: boolean): void {
    show(this.lockHint, v);
  }

  setPerf(fps: number, cps: number): void {
    setText(this.fps, `${fps} FPS`);
    setText(this.cps, `${cps} CPS`);
  }

  setHealth(hp: number, absorb: number): void {
    const key = Math.round(hp * 10) + Math.round(absorb * 10) * 1000;
    if (key !== this.lastHp) {
      this.lastHp = key;
      for (let i = 0; i < 10; i++) {
        const fill = Math.max(0, Math.min(1, (hp - i * 2) / 2));
        const rect = this.hearts[i].querySelector('rect')!;
        rect.setAttribute('width', String(16 * fill));
        this.hearts[i].classList.toggle('low', hp <= 6);
      }
      this.hpFill.style.width = `${(hp / MAX_HEALTH) * 100}%`;
      this.hpAbsorb.style.width = `${Math.min(1, absorb / MAX_HEALTH) * 100}%`;
      this.hpFill.classList.toggle('low', hp <= 6);
      setText(this.hpText, (Math.ceil(hp * 2) / 2).toFixed(1) + (absorb > 0 ? `  +${absorb.toFixed(0)}` : ''));
    }
    if (hp > this.ghost) this.ghost = hp;
  }

  setOpponent(name: string | null, hp = 0, absorb = 0): void {
    show(this.opp, name !== null);
    if (name === null) return;
    setText(this.oppName, name);
    const key = Math.round(hp * 10) + Math.round(absorb * 10) * 1000;
    if (key !== this.lastOpp) {
      this.lastOpp = key;
      this.oppFill.style.width = `${(Math.max(0, hp) / MAX_HEALTH) * 100}%`;
      this.oppAbsorb.style.width = `${Math.min(1, absorb / MAX_HEALTH) * 100}%`;
      this.oppFill.classList.toggle('low', hp <= 6);
    }
    if (hp > this.oppGhostV) this.oppGhostV = hp;
  }

  setScore(html: string | null): void {
    show(this.scoreEl, html !== null);
    if (html !== null && this.scoreEl.innerHTML !== html) this.scoreEl.innerHTML = html;
  }

  setHotbar(inv: (ItemStack | null)[], selected: number): void {
    const key = inv.slice(0, HOTBAR_SIZE).map((s) => (s ? s.id + s.count : '-')).join(',') + '|' + selected;
    if (key === this.hotbarKey) return;
    const prevSel = this.hotbarKey.split('|')[1];
    this.hotbarKey = key;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = inv[i];
      const slot = this.slots[i];
      slot.classList.toggle('selected', i === selected);
      const img = slot.querySelector('img') as HTMLImageElement;
      const src = s ? itemIcon(s.id) : '';
      if (img.getAttribute('src') !== src) {
        if (src) img.setAttribute('src', src);
        else img.removeAttribute('src');
      }
      img.style.visibility = s ? 'visible' : 'hidden';
      setText(slot.querySelector('.slot-count') as HTMLElement, s && s.count > 1 ? String(s.count) : '');
    }
    if (prevSel !== undefined && prevSel !== String(selected)) {
      const s = inv[selected];
      setText(this.itemName, s ? ITEMS[s.id].name.toUpperCase() : '');
      this.itemName.classList.add('show');
      this.itemNameTimer = 1.4;
      const el = this.slots[selected];
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  setSprint(state: 'on' | 'off' | 'locked'): void {
    if (this.sprint.dataset.state === state) return;
    this.sprint.dataset.state = state;
    this.sprint.innerHTML =
      state === 'locked'
        ? '<span class="sp-icon">»</span><span class="sp-label">RESET</span>'
        : '<span class="sp-icon">»</span><span class="sp-label">SPRINT</span>';
  }

  setEat(progress: number): void {
    show(this.eatBar, progress > 0);
    if (progress > 0) (this.eatBar.firstChild as HTMLElement).style.width = `${Math.min(1, progress / EAT_TIME) * 100}%`;
  }

  hitmarker(crit: boolean): void {
    this.hitmark.classList.remove('on', 'crit');
    void this.hitmark.offsetWidth;
    this.hitmark.classList.add('on');
    if (crit) this.hitmark.classList.add('crit');
    this.crosshair.classList.add('hit');
    this.hitTimer = 0.12;
  }

  /** `angle` is relative to view: 0 = in front, +π/2 = right. */
  damage(angle: number): void {
    this.dmgIndicator.style.transform = `translate(-50%,-50%) rotate(${angle}rad)`;
    this.dmgIndicator.classList.remove('on');
    void this.dmgIndicator.offsetWidth;
    this.dmgIndicator.classList.add('on');
    this.dmgTimer = 0.8;
  }

  combo(n: number): void {
    if (n < 2) {
      return;
    }
    show(this.comboEl, true);
    this.comboEl.classList.remove('fade');
    setText(this.comboNum, String(n));
    this.comboEl.classList.remove('pop');
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('pop');
    this.comboEl.classList.toggle('hot', n >= 5);
    this.comboTimer = 1.5;
  }

  comboEnd(): void {
    this.comboTimer = Math.min(this.comboTimer, 0.35);
  }

  message(text: string, sub = '', duration = 1.2, tone: 'neutral' | 'good' | 'bad' | 'gold' = 'neutral'): void {
    this.center.innerHTML = `<div class="cm-main">${text}</div>${sub ? `<div class="cm-sub">${sub}</div>` : ''}`;
    this.center.className = `center-msg on ${tone}`;
    this.centerTimer = duration;
  }

  clearMessage(): void {
    this.center.className = 'center-msg';
    this.centerTimer = 0;
  }

  feedItem(html: string): void {
    const el = h('div', { class: 'feed-item', html });
    this.feed.prepend(el);
    while (this.feed.children.length > 4) this.feed.lastElementChild?.remove();
    window.setTimeout(() => el.classList.add('out'), 4200);
    window.setTimeout(() => el.remove(), 4800);
  }

  setDrill(html: string | null): void {
    show(this.drill, html !== null);
    if (html !== null && this.drill.innerHTML !== html) this.drill.innerHTML = html;
  }

  reset(): void {
    this.comboTimer = 0;
    show(this.comboEl, false);
    this.clearMessage();
    this.feed.innerHTML = '';
    this.ghost = MAX_HEALTH;
    this.oppGhostV = MAX_HEALTH;
    this.lastHp = -1;
    this.lastOpp = -1;
  }

  update(dt: number, hp: number, oppHp: number): void {
    // Ghost bars drain after a short delay: shows the chunk you just lost.
    this.ghost = Math.max(hp, this.ghost - dt * 9);
    this.hpGhost.style.width = `${(Math.max(0, this.ghost) / MAX_HEALTH) * 100}%`;
    this.oppGhostV = Math.max(oppHp, this.oppGhostV - dt * 9);
    this.oppGhost.style.width = `${(Math.max(0, this.oppGhostV) / MAX_HEALTH) * 100}%`;

    if (this.itemNameTimer > 0) {
      this.itemNameTimer -= dt;
      if (this.itemNameTimer <= 0) this.itemName.classList.remove('show');
    }
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) this.center.classList.remove('on');
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0.3) this.comboEl.classList.add('fade');
      if (this.comboTimer <= 0) show(this.comboEl, false);
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.crosshair.classList.remove('hit');
    }
    if (this.dmgTimer > 0) {
      this.dmgTimer -= dt;
      if (this.dmgTimer <= 0) this.dmgIndicator.classList.remove('on');
    }
  }
}
