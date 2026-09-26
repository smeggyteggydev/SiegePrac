import { itemIconUrl } from '../weapons/PixelItems';
import type { ItemId } from '../weapons/Items';

const cache = new Map<ItemId, string>();

/** Hotbar/inventory icons are the item sprites themselves, so they match the hand exactly. */
export function itemIcon(id: ItemId): string {
  let u = cache.get(id);
  if (!u) {
    u = itemIconUrl(id);
    cache.set(id, u);
  }
  return u;
}
