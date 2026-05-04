export type StoreId = 'jumbo' | 'carrefour';

export type Store = {
  id: StoreId;
  name: string;
  baseUrl: string;
  defaultSalesChannel: string;
  defaultSeller: string;
};

export type Product = {
  skuId: string;
  productId: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  price: number;
  available: boolean;
};

export type CartItem = {
  skuId: string;
  qty: number;
  name: string;
  imageUrl?: string;
  price: number;
};
