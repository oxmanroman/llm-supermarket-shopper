'use client';

import { useCallback, useEffect, useState } from 'react';
import { clearCart } from '~/lib/storage/cart';
import { clearStore, readStore, writeStore } from '~/lib/storage/store';
import { STORES } from '~/lib/vtex/stores';
import type { Store, StoreId } from '~/lib/vtex/types';

export function useStore() {
  const [storeId, setStoreId] = useState<StoreId | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setStoreId(readStore());
    setHydrated(true);
  }, []);

  const selectStore = useCallback((id: StoreId) => {
    writeStore(id);
    setStoreId(id);
  }, []);

  const switchStore = useCallback((newId: StoreId) => {
    const prev = readStore();
    if (prev) clearCart(prev);
    writeStore(newId);
    setStoreId(newId);
  }, []);

  const reset = useCallback(() => {
    const prev = readStore();
    if (prev) clearCart(prev);
    clearStore();
    setStoreId(null);
  }, []);

  const store: Store | null = storeId ? STORES[storeId] : null;
  return { store, storeId, hydrated, selectStore, switchStore, reset };
}
