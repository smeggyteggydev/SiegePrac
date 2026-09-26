import { h, show } from './dom';
import { itemIcon } from './icons';
import { type ItemStack, HOTBAR_SIZE, INVENTORY_SIZE, ITEMS } from '../weapons/Items';
import { audio } from '../audio/AudioEngine';

/**
 * Inventory grid with drag & drop (or click-to-pick / click-to-place),
 * plus hover + number key to swap into a hotbar slot.
 */
export class InventoryUI {
  readonly root: HTMLElement;
  private title = h('div', { class: 'inv-title' });
  private storage = h('div', { class: 'inv-grid' });
  private bar = h('div', { class: 'inv-grid inv-hotbar' });
  private detail = h('div', { class: 'inv-detail' });
  private ghost = h('img', { class: 'inv-ghost hidden', alt: '' });
  private slots: HTMLElement[] = [];
  private inv: (ItemStack | null)[] = [];
  private held: { stack: ItemStack; from: number } | null = null;
  private hover = -1;
  private moved = false;
  onChange: () => void = () => {};
  onClose: () => void = () => {};

  constructor(parent: HTMLElement, closable = true) {
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = h('div', { class: 'inv-slot', 'data-i': i }, h('img', { alt: '' }), h('span', { class: 'slot-count' }), i < HOTBAR_SIZE ? h('span', { class: 'slot-num' }, String(i + 1)) : null);
      slot.addEventListener('pointerdown', (e) => this.pointerDown(i, e));
      slot.addEventListener('pointerenter', () => {
        this.hover = i;
        this.showDetail(i);
      });
      slot.addEventListener('pointerleave', () => {
        if (this.hover === i) this.hover = -1;
      });
      this.slots.push(slot);
      (i < HOTBAR_SIZE ? this.bar : this.storage).appendChild(slot);
    }
    const close = closable
      ? h('button', { class: 'btn-ghost inv-close', onclick: () => this.onClose() }, 'CLOSE  [E]')
      : null;
    this.root = h(
      'div',
      { class: 'inventory' },
      h('div', { class: 'inv-head' }, this.title, close),
      h('div', { class: 'inv-body' }, h('div', { class: 'inv-cols' }, h('div', { class: 'inv-label' }, 'STORAGE'), this.storage, h('div', { class: 'inv-label' }, 'HOTBAR'), this.bar), this.detail),
      h('div', { class: 'inv-help' }, 'Drag to move · Shift-click to quick-move (refill) · Hover + 1–9 to send to hotbar'),
    );
    parent.appendChild(this.root);
    document.body.appendChild(this.ghost);
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('keydown', (e) => this.keyDown(e));
  }

  isOpen(): boolean {
    return !this.root.classList.contains('hidden') && this.root.offsetParent !== null;
  }

  bind(inv: (ItemStack | null)[], title: string): void {
    this.inv = inv;
    this.title.textContent = title;
    this.render();
    this.showDetail(this.inv.findIndex((s) => s !== null));
  }

  render(): void {
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const s = this.inv[i];
      const slot = this.slots[i];
      const img = slot.querySelector('img') as HTMLImageElement;
      if (s) img.src = itemIcon(s.id);
      else img.removeAttribute('src');
      img.style.visibility = s && !(this.held && this.held.from === i) ? 'visible' : 'hidden';
      (slot.querySelector('.slot-count') as HTMLElement).textContent = s && s.count > 1 ? String(s.count) : '';
      slot.classList.toggle('filled', !!s);
    }
  }

  private showDetail(i: number): void {
    const s = i >= 0 ? this.inv[i] : null;
    if (!s) {
      this.detail.innerHTML = '<div class="inv-empty">Hover an item</div>';
      return;
    }
    const d = ITEMS[s.id];
    const stats =
      d.kind === 'weapon'
        ? `<div class="inv-stats"><div><span>DAMAGE</span><b>${(d.damage ?? 0).toFixed(1)}</b></div><div><span>SWING</span><b>${d.swingCooldown! < 0.1 ? 'FAST' : (1 / d.swingCooldown!).toFixed(1) + '/s'}</b></div><div><span>KNOCKBACK</span><b>${Math.round((d.knockbackScale ?? 1) * 100)}%</b></div><div><span>BLOCK</span><b>${d.canBlock ? 'YES' : 'NO'}</b></div></div>`
        : `<div class="inv-stats"><div><span>STACK</span><b>${s.count}</b></div></div>`;
    this.detail.innerHTML = `<img src="${itemIcon(s.id)}" alt=""><div class="inv-name" style="--c:${d.color}">${d.name}</div><div class="inv-desc">${d.description}</div>${stats}`;
  }

  private pointerDown(i: number, e: PointerEvent): void {
    e.preventDefault();
    if (e.shiftKey && !this.held && this.inv[i]) {
      // Quick-move (refill): storage → first empty hotbar slot, hotbar → storage.
      const toHotbar = i >= HOTBAR_SIZE;
      let target = -1;
      for (let j = toHotbar ? 0 : HOTBAR_SIZE; j < (toHotbar ? HOTBAR_SIZE : INVENTORY_SIZE); j++)
        if (!this.inv[j]) {
          target = j;
          break;
        }
      if (target >= 0) {
        this.inv[target] = this.inv[i];
        this.inv[i] = null;
        audio.select();
        this.render();
        this.onChange();
      }
      return;
    }
    this.moved = false;
    if (this.held) {
      this.place(i);
      return;
    }
    const s = this.inv[i];
    if (!s) return;
    this.held = { stack: s, from: i };
    this.ghost.src = itemIcon(s.id);
    show(this.ghost, true);
    this.moveGhost(e.clientX, e.clientY);
    audio.select();
    this.render();
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.held) return;
    this.moved = true;
    this.moveGhost(e.clientX, e.clientY);
  }

  private pointerUp(e: PointerEvent): void {
    if (!this.held) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.inv-slot') as HTMLElement | null;
    const target = el ? Number(el.dataset.i) : -1;
    if (target >= 0 && target !== this.held.from && this.slots[target] === el) this.place(target);
    else if (this.moved && target < 0) this.cancel();
    // click without moving on the same slot: keep holding (click-to-place)
  }

  private place(i: number): void {
    if (!this.held) return;
    const from = this.held.from;
    const tmp = this.inv[i];
    this.inv[i] = this.inv[from];
    this.inv[from] = tmp;
    this.held = null;
    show(this.ghost, false);
    audio.uiClick();
    this.render();
    this.showDetail(i);
    this.onChange();
  }

  cancel(): void {
    this.held = null;
    show(this.ghost, false);
    this.render();
  }

  private moveGhost(x: number, y: number): void {
    this.ghost.style.transform = `translate(${x - 28}px, ${y - 28}px)`;
  }

  private keyDown(e: KeyboardEvent): void {
    if (!this.isOpen() || this.hover < 0) return;
    if (!e.code.startsWith('Digit')) return;
    const n = parseInt(e.code.slice(5), 10) - 1;
    if (n < 0 || n >= HOTBAR_SIZE || n === this.hover) return;
    const tmp = this.inv[n];
    this.inv[n] = this.inv[this.hover];
    this.inv[this.hover] = tmp;
    audio.uiClick();
    this.render();
    this.onChange();
  }
}
