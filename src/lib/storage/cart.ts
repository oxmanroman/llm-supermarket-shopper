import type { CartItem } from '~/lib/vtex/types';
import type { StoreId } from '~/lib/vtex/types';

const KEY = (storeId: StoreId) => `cart:${storeId}`;

export function readCart(storeId: StoreId): CartItem[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(KEY(storeId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function writeCart(storeId: StoreId, items: CartItem[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY(storeId), JSON.stringify(items));
}

export function clearCart(storeId: StoreId): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY(storeId));
}
