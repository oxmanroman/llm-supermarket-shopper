import type { Store, StoreId } from './types';

// `defaultSalesChannel` per VTEX store was determined by inspecting each
// storefront's /api/sessions response: the `vtex_segment` cookie's `channel`
// field. Mismatched channels cause cart-add to silently fail with ORD027
// ("item not found or unavailable").
//
// COTO is not VTEX. Its anonymous search runs on Constructor.io; the public
// key was extracted from the SPA bundle and is the same key the Coto Digital
// site itself uses from the browser. There is no anonymous cart-add URL on
// COTO (the cart endpoint is auth-gated), so the resolution screen surfaces
// per-product PDP links instead of a single prefilled-cart hand-off.
export const STORES: Record<StoreId, Store> = {
  jumbo: {
    id: 'jumbo',
    name: 'Jumbo',
    baseUrl: 'https://www.jumbo.com.ar',
    platform: 'vtex',
    defaultSalesChannel: '32',
    defaultSeller: '1',
  },
  carrefour: {
    id: 'carrefour',
    name: 'Carrefour',
    baseUrl: 'https://www.carrefour.com.ar',
    platform: 'vtex',
    defaultSalesChannel: '1',
    defaultSeller: '1',
  },
  coto: {
    id: 'coto',
    name: 'Coto',
    baseUrl: 'https://www.cotodigital.com.ar',
    platform: 'coto',
    constructorKey: 'key_r6xzz4IAoTWcipni',
  },
};

export const STORE_IDS = Object.keys(STORES) as StoreId[];

export function isStoreId(value: unknown): value is StoreId {
  return typeof value === 'string' && value in STORES;
}
