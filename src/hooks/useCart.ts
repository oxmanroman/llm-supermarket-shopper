'use client';

import { useCallback, useEffect, useState } from 'react';
import { readCart, writeCart, clearCart } from '~/lib/storage/cart';
import type { CartItem, StoreId } from '~/lib/vtex/types';

export function useCart(storeId: StoreId | null) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    setItems(storeId ? readCart(storeId) : []);
  }, [storeId]);

  const persist = useCallback(
    (next: CartItem[]) => {
      setItems(next);
      if (storeId) writeCart(storeId, next);
    },
    [storeId],
  );

  const addItem = useCallback(
    (item: CartItem) => {
      const existing = items.find((i) => i.skuId === item.skuId);
      const next = existing
        ? items.map((i) => (i.skuId === item.skuId ? { ...i, qty: i.qty + item.qty } : i))
        : [...items, item];
      persist(next);
    },
    [items, persist],
  );

  const setQty = useCallback(
    (skuId: string, qty: number) => {
      if (qty <= 0) {
        persist(items.filter((i) => i.skuId !== skuId));
      } else {
        persist(items.map((i) => (i.skuId === skuId ? { ...i, qty } : i)));
      }
    },
    [items, persist],
  );

  const remove = useCallback((skuId: string) => persist(items.filter((i) => i.skuId !== skuId)), [items, persist]);

  const clear = useCallback(() => {
    setItems([]);
    if (storeId) clearCart(storeId);
  }, [storeId]);

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  return { items, total, addItem, setQty, remove, clear };
}
