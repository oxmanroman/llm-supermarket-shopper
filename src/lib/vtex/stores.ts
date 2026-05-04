import type { Store, StoreId } from './types';

// `defaultSalesChannel` per store was determined by inspecting each storefront's
// /api/sessions response: the `vtex_segment` cookie's `channel` field. Mismatched
// channels cause cart-add to silently fail with ORD027 ("item not found or unavailable").
export const STORES: Record<StoreId, Store> = {
  jumbo: {
    id: 'jumbo',
    name: 'Jumbo',
    baseUrl: 'https://www.jumbo.com.ar',
    defaultSalesChannel: '32',
    defaultSeller: '1',
  },
  carrefour: {
    id: 'carrefour',
    name: 'Carrefour',
    baseUrl: 'https://www.carrefour.com.ar',
    defaultSalesChannel: '1',
    defaultSeller: '1',
  },
};

export const STORE_IDS = Object.keys(STORES) as StoreId[];

export function isStoreId(value: unknown): value is StoreId {
  return typeof value === 'string' && value in STORES;
}
