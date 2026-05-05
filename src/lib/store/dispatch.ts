import { buildCotoHandoffUrl, type CotoHandoffItem } from '~/lib/coto/cart';
import { cotoSearch } from '~/lib/coto/search';
import { buildVtexAddToCartUrl } from '~/lib/vtex/cart';
import { vtexSearch } from '~/lib/vtex/search';
import type { Product, Store } from './types';

export async function productSearch(store: Store, query: string): Promise<Product[]> {
  switch (store.platform) {
    case 'vtex':
      return vtexSearch(store, query);
    case 'coto':
      return cotoSearch(store, query);
  }
}

export type AddToCartItem = {
  skuId: string;
  qty: number;
  // Optional product reference. VTEX cart-add only uses skuId+qty; COTO has
  // no anonymous cart endpoint and falls back to opening a PDP, which needs
  // the product's productUrl.
  product?: Product;
};

export function buildAddToCartUrl(store: Store, items: AddToCartItem[]): string {
  switch (store.platform) {
    case 'vtex':
      return buildVtexAddToCartUrl(
        store,
        items.map((item) => ({ skuId: item.skuId, qty: item.qty })),
      );
    case 'coto':
      return buildCotoHandoffUrl(store, items satisfies CotoHandoffItem[]);
  }
}
