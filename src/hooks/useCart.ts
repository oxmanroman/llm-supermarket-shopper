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
    (updater: (prev: CartItem[]) => CartItem[]) => {
      setItems((prev) => {
        const next = updater(prev);
        if (storeId) writeCart(storeId, next);
        return next;
      });
    },
    [storeId],
  );

  const addItem = useCallback(
    (item: CartItem) => {
      persist((prev) => {
        const existing = prev.find((i) => i.skuId === item.skuId);
        return existing
          ? prev.map((i) => (i.skuId === item.skuId ? { ...i, qty: i.qty + item.qty } : i))
          : [...prev, item];
      });
    },
    [persist],
  );

  const setQty = useCallback(
    (skuId: string, qty: number) => {
      persist((prev) =>
        qty <= 0 ? prev.filter((i) => i.skuId !== skuId) : prev.map((i) => (i.skuId === skuId ? { ...i, qty } : i)),
      );
    },
    [persist],
  );

  const remove = useCallback((skuId: string) => persist((prev) => prev.filter((i) => i.skuId !== skuId)), [persist]);

  const clear = useCallback(() => {
    setItems([]);
    if (storeId) clearCart(storeId);
  }, [storeId]);

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  return { items, total, addItem, setQty, remove, clear };
}
