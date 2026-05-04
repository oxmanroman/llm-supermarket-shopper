import { isStoreId } from '~/lib/vtex/stores';
import type { StoreId } from '~/lib/vtex/types';

const KEY = 'store';

export function readStore(): StoreId | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  return isStoreId(raw) ? raw : null;
}

export function writeStore(storeId: StoreId): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, storeId);
}

export function clearStore(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
