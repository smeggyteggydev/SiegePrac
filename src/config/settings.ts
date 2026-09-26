import type { BotDifficulty } from '../entities/BotBrain';
import { type ItemStack, defaultLoadout, INVENTORY_SIZE, ITEMS } from '../weapons/Items';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;
  fov: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  quality: Quality;
  particles: boolean;
  cameraShake: number;
  motionBlur: number;
  viewBobbing: boolean;
  showFps: boolean;
  showCps: boolean;
  autoSprint: boolean;
  rawInput: boolean;
  invertY: boolean;
  crosshair: 'cross' | 'dot' | 'circle';
  crosshairColor: string;
  difficulty: BotDifficulty;
  firstTo: number;
}

const DEFAULTS: Settings = {
  sensitivity: 1.0,
  fov: 90,
  masterVolume: 0.8,
  musicVolume: 0.35,
  sfxVolume: 0.9,
  quality: 'high',
  particles: true,
  cameraShake: 0.6,
  motionBlur: 0.3,
  viewBobbing: true,
  showFps: true,
  showCps: true,
  autoSprint: true,
  rawInput: true,
  invertY: false,
  crosshair: 'cross',
  crosshairColor: '#ffffff',
  difficulty: 'normal',
  firstTo: 3,
};

const KEY = 'siegeprac.settings.v1';
const LOADOUT_KEY = 'siegeprac.loadout.v1';
const RECORDS_KEY = 'siegeprac.records.v1';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

type Listener = (s: Settings) => void;

class SettingsStore {
  data: Settings;
  private listeners: Listener[] = [];

  constructor() {
    this.data = { ...DEFAULTS, ...(read<Partial<Settings>>(KEY) ?? {}) };
  }

  get<K extends keyof Settings>(k: K): Settings[K] {
    return this.data[k];
  }

  set<K extends keyof Settings>(k: K, v: Settings[K]): void {
    this.data[k] = v;
    write(KEY, this.data);
    for (const l of this.listeners) l(this.data);
  }

  reset(): void {
    this.data = { ...DEFAULTS };
    write(KEY, this.data);
    for (const l of this.listeners) l(this.data);
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }
}

export const settings = new SettingsStore();

export function loadLoadout(): (ItemStack | null)[] {
  const saved = read<(ItemStack | null)[]>(LOADOUT_KEY);
  if (!saved || saved.length !== INVENTORY_SIZE) return defaultLoadout();
  // validate
  return saved.map((s) => (s && s.id in ITEMS && s.count > 0 ? { id: s.id, count: s.count } : null));
}

export function saveLoadout(inv: (ItemStack | null)[]): void {
  write(LOADOUT_KEY, inv);
}

export interface Records {
  bestCombo: number;
  bestMovementTime: number | null;
  bestAimScore: number;
  wins: Record<string, number>;
}

export function loadRecords(): Records {
  return { bestCombo: 0, bestMovementTime: null, bestAimScore: 0, wins: {}, ...(read<Partial<Records>>(RECORDS_KEY) ?? {}) };
}

export function saveRecords(r: Records): void {
  write(RECORDS_KEY, r);
}
