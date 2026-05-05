import type { CotoStore, Product } from '~/lib/store/types';

export type CotoHandoffItem = { skuId: string; qty: number; product?: Product };

// COTO has no anonymous cart-add URL: the cart endpoint requires a logged-in
// session and HMAC-signed requests, and the /carrito route itself is
// auth-gated. The best one-tab hand-off we can offer is the PDP of the first
// matched product (so the user lands on a real product page they can add) or
// the COTO homepage if we have no PDP URLs.
//
// The resolution screen shows per-product "Abrir" links so the user can walk
// the list and add each item manually.
export function buildCotoHandoffUrl(store: CotoStore, items: CotoHandoffItem[]): string {
  if (items.length === 0) {
    throw new Error('items is empty');
  }
  const firstWithPdp = items.find((item) => item.product?.productUrl);
  if (firstWithPdp?.product?.productUrl) {
    return firstWithPdp.product.productUrl;
  }
  return store.baseUrl;
}
