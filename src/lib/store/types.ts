export type StoreId = 'jumbo' | 'carrefour' | 'coto';

type StoreCommon = {
  id: StoreId;
  name: string;
  baseUrl: string;
};

export type VtexStore = StoreCommon & {
  platform: 'vtex';
  defaultSalesChannel: string;
  defaultSeller: string;
};

export type CotoStore = StoreCommon & {
  platform: 'coto';
  constructorKey: string;
};

export type Store = VtexStore | CotoStore;

export type Product = {
  skuId: string;
  productId: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  price: number;
  available: boolean;
  // Absolute URL of the product detail page on the store's site. Optional
  // because some adapters (VTEX) don't surface this from search; populated
  // for COTO so the UI can link out for manual cart loading.
  productUrl?: string;
};

export type CartItem = {
  skuId: string;
  qty: number;
  name: string;
  imageUrl?: string;
  price: number;
};
