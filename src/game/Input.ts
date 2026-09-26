import { settings } from '../config/settings';
import { type FighterCommand, emptyCommand } from '../entities/Fighter';
import { HOTBAR_SIZE } from '../weapons/Items';

/** Radians per pixel of mouse movement at sensitivity 1.0. */
const BASE_SENS = 0.0022;

export type InputAction = 'inventory' | 'restart' | 'view' | 'pause' | 'drop';

/**
 * Raw keyboard + mouse state. Look is applied immediately (every mouse event)
 * so aiming latency is never tied to the simulation tick.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  private keys = new Set<string>();
  private pendingClicks = 0;
  private clickTimes: number[] = [];
  private rightDown = false;
  private leftDown = false;
  private pendingSlot = -1;
  locked = false;
  enabled = false;
  /** Called on actions that aren't part of the fighter command. */
  onAction: (a: InputAction) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  onLook: (dYaw: number, dPitch: number) => void = () => {};
  onSlotScroll: (slot: number) => void = () => {};
  /** Current selected slot, used to resolve scroll wheel. */
  currentSlot = () => 0;

  constructor(private canvas: HTMLElement) {
    document.addEventListener('keydown', (e) => this.keyDown(e));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('mousemove', (e) => this.mouseMove(e));
    document.addEventListener('mousedown', (e) => this.mouseDown(e));
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.leftDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked || !this.enabled) return;
        const dir = Math.sign(e.deltaY);
        if (!dir) return;
        const s = (this.currentSlot() + dir + HOTBAR_SIZE) % HOTBAR_SIZE;
        this.pendingSlot = s;
        this.onSlotScroll(s);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.rightDown = false;
        this.leftDown = false;
      }
      this.onLockChange(this.locked);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  async lock(): Promise<boolean> {
    if (this.locked) return true;
    const el = this.canvas as HTMLElement & {
      requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      const r = el.requestPointerLock(settings.get('rawInput') ? { unadjustedMovement: true } : undefined);
      if (r instanceof Promise) await r;
      return true;
    } catch {
      try {
        const r = el.requestPointerLock();
        if (r instanceof Promise) await r;
        return true;
      } catch {
        return false;
      }
    }
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.code === 'Tab' && this.locked) e.preventDefault();
    if (e.repeat) {
      if (this.locked && e.code === 'Space') e.preventDefault();
      return;
    }
    this.keys.add(e.code);
    if (!this.enabled) return;
    if (e.code === 'KeyE') this.onAction('inventory');
    if (e.code === 'KeyR') this.onAction('restart');
    if (e.code === 'KeyV' || e.code === 'F5') {
      e.preventDefault();
      this.onAction('view');
    }
    if (!this.locked) return;
    if (e.code === 'Space') e.preventDefault();
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= HOTBAR_SIZE) this.pendingSlot = n - 1;
    }
  }

  private mouseMove(e: MouseEvent): void {
    if (!this.locked || !this.enabled) return;
    let dx = e.movementX;
    let dy = e.movementY;
    // Some browsers occasionally report huge spurious deltas on lock; drop them.
    if (Math.abs(dx) > 900 || Math.abs(dy) > 900) return;
    const s = BASE_SENS * settings.get('sensitivity');
    if (settings.get('invertY')) dy = -dy;
    const dYaw = -dx * s;
    const dPitch = -dy * s;
    this.yaw += dYaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch + dPitch));
    this.onLook(dYaw, dPitch);
  }

  private mouseDown(e: MouseEvent): void {
    if (!this.locked || !this.enabled) return;
    if (e.button === 0) {
      this.leftDown = true;
      this.pendingClicks++;
      this.clickTimes.push(performance.now());
    } else if (e.button === 2) {
      this.rightDown = true;
    }
  }

  /** Clicks per second over the last second. */
  cps(): number {
    const now = performance.now();
    while (this.clickTimes.length && now - this.clickTimes[0] > 1000) this.clickTimes.shift();
    return this.clickTimes.length;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  get attackHeld(): boolean {
    return this.leftDown;
  }

  /** Build this tick's command and consume one-shot inputs. */
  command(): FighterCommand {
    const c = emptyCommand();
    c.yaw = this.yaw;
    c.pitch = this.pitch;
    if (!this.enabled || !this.locked) return c;
    const k = this.keys;
    c.forward = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    c.strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    c.jump = k.has('Space');
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    // Auto-sprint (default): always sprint when moving forward, Shift sneaks —
    // releasing W is the sprint reset. Manual mode: hold Shift to sprint, C to sneak.
    const auto = settings.get('autoSprint');
    c.crouch = k.has('KeyC') || (auto && shift);
    c.sprint = auto ? true : shift;
    c.use = this.rightDown;
    // Consume at most 2 clicks per tick; the rest carry over (no lost clicks at high CPS).
    c.attacks = Math.min(this.pendingClicks, 2);
    this.pendingClicks -= c.attacks;
    c.slot = this.pendingSlot;
    this.pendingSlot = -1;
    return c;
  }

  clearPending(): void {
    this.pendingClicks = 0;
    this.pendingSlot = -1;
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }
}
