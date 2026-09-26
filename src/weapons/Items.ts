import { BASE_DAMAGE, ATTACK_COOLDOWN } from '../config/constants';

export type ItemId = 'sword' | 'axe' | 'gapple' | 'heal_pot' | 'speed_pot' | 'pearl';

export type ItemKind = 'weapon' | 'consumable' | 'throwable';

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: ItemKind;
  description: string;
  maxStack: number;
  /** Weapon fields */
  damage?: number;
  /** Minimum time between swings for this weapon. */
  swingCooldown?: number;
  knockbackScale?: number;
  canBlock?: boolean;
  /** Accent colour used by icons and view models. */
  color: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  sword: {
    id: 'sword',
    name: 'Siege Blade',
    kind: 'weapon',
    description: 'Fast, precise, combo-friendly. Right-click to block.',
    maxStack: 1,
    damage: BASE_DAMAGE,
    swingCooldown: ATTACK_COOLDOWN,
    knockbackScale: 1,
    canBlock: true,
    color: '#7fd8ff',
  },
  axe: {
    id: 'axe',
    name: 'Breaker Axe',
    kind: 'weapon',
    description: 'Heavy hits, low knockback, slow recovery. Punishes bad spacing.',
    maxStack: 1,
    damage: BASE_DAMAGE * 1.45,
    swingCooldown: 0.62,
    knockbackScale: 0.72,
    canBlock: false,
    color: '#ffb35c',
  },
  gapple: {
    id: 'gapple',
    name: 'Golden Apple',
    kind: 'consumable',
    description: 'Hold right-click to eat. Heals and grants absorption.',
    maxStack: 16,
    color: '#ffd24a',
  },
  heal_pot: {
    id: 'heal_pot',
    name: 'Splash Potion of Healing II',
    kind: 'throwable',
    description: 'Right-click to throw. Heals everyone in the splash — look down to pot yourself.',
    maxStack: 1,
    color: '#ff4a6a',
  },
  speed_pot: {
    id: 'speed_pot',
    name: 'Potion of Swiftness II',
    kind: 'consumable',
    description: 'Hold right-click to drink. Speed II for 90 seconds.',
    maxStack: 1,
    color: '#7ac8ff',
  },
  pearl: {
    id: 'pearl',
    name: 'Ender Pearl',
    kind: 'throwable',
    description: 'Right-click to throw and teleport where it lands. 10s cooldown.',
    maxStack: 16,
    color: '#2fa89a',
  },
};

export interface ItemStack {
  id: ItemId;
  count: number;
}

export function itemDef(stack: ItemStack | null): ItemDef | null {
  return stack ? ITEMS[stack.id] : null;
}

export const HOTBAR_SIZE = 9;
export const INVENTORY_ROWS = 3;
export const INVENTORY_SIZE = HOTBAR_SIZE + INVENTORY_ROWS * 9;

/** Standard NoDebuff kit: sword, pearls, speed, then heals everywhere else. */
export function nodebuffLoadout(): (ItemStack | null)[] {
  const inv: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);
  for (let i = 0; i < INVENTORY_SIZE; i++) inv[i] = { id: 'heal_pot', count: 1 };
  inv[0] = { id: 'sword', count: 1 };
  inv[1] = { id: 'pearl', count: 16 };
  inv[2] = { id: 'speed_pot', count: 1 };
  inv[9] = { id: 'speed_pot', count: 1 };
  inv[10] = { id: 'speed_pot', count: 1 };
  return inv;
}

/** The default loadout: slot indices 0-8 are the hotbar. */
export function defaultLoadout(): (ItemStack | null)[] {
  const inv: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);
  inv[0] = { id: 'sword', count: 1 };
  inv[1] = { id: 'axe', count: 1 };
  inv[2] = { id: 'gapple', count: 3 };
  return inv;
}
