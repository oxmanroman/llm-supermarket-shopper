import type { VtexStore } from '~/lib/store/types';

export type VtexAddToCartItem = { skuId: string; qty: number };

export function buildVtexAddToCartUrl(store: VtexStore, items: VtexAddToCartItem[]): string {
  if (items.length === 0) {
    throw new Error('items is empty');
  }
  const parts: string[] = [];
  for (const item of items) {
    parts.push(`sku=${encodeURIComponent(item.skuId)}`);
    parts.push(`qty=${encodeURIComponent(String(item.qty))}`);
    parts.push(`seller=${encodeURIComponent(store.defaultSeller)}`);
  }
  parts.push(`sc=${encodeURIComponent(store.defaultSalesChannel)}`);
  parts.push(`redirect=true`);
  return `${store.baseUrl}/checkout/cart/add?${parts.join('&')}`;
}
