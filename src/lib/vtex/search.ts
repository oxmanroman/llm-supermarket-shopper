import { vtexFetch } from './client';
import type { Product, Store } from './types';

type VtexItem = {
  itemId: string;
  name: string;
  images?: { imageUrl?: string }[];
  sellers?: {
    sellerId: string;
    commertialOffer: { Price: number; IsAvailable: boolean };
  }[];
};

type VtexProduct = {
  productId: string;
  productName: string;
  brand?: string;
  items?: VtexItem[];
};

const PAGE_SIZE = 12;

export async function productSearch(store: Store, query: string): Promise<Product[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const path = `/api/catalog_system/pub/products/search/?ft=${encodeURIComponent(trimmed)}&_from=0&_to=${PAGE_SIZE - 1}&sc=${store.defaultSalesChannel}`;
  const response = await vtexFetch(store, path);
  const data = (await response.json()) as VtexProduct[];
  const products: Product[] = [];
  for (const p of data) {
    const item = p.items?.[0];
    const seller = item?.sellers?.[0];
    if (!item || !seller) continue;
    products.push({
      skuId: item.itemId,
      productId: p.productId,
      name: p.productName,
      brand: p.brand,
      imageUrl: item.images?.[0]?.imageUrl,
      price: seller.commertialOffer.Price,
      available: seller.commertialOffer.IsAvailable,
    });
  }
  return products;
}
