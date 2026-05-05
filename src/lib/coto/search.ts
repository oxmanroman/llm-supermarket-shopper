import type { CotoStore, Product } from '~/lib/store/types';

// Constructor.io result envelope for COTO. Captures only the fields we
// actually consume so changes upstream that we don't depend on don't break
// the type check.
type CotoConstructorResult = {
  value: string;
  data: {
    id?: string;
    // Constructor.io returns these as numbers despite the leading-zero
    // appearance ("00008899" comes back as 8899). We coerce to string at
    // the boundary so downstream code can treat skuId uniformly.
    sku_id?: string | number;
    sku_plu?: string | number;
    sku_display_name?: string;
    product_brand?: string;
    product_list_price?: number;
    image_url?: string;
    product_large_image_url?: string;
    product_medium_image_url?: string;
    url?: string;
    store_availability?: { store: string; available?: boolean }[];
  };
};

type CotoConstructorResponse = {
  response?: {
    results?: CotoConstructorResult[];
  };
};

const PAGE_SIZE = 12;

// COTO's own checkout uses store '200' as the central digital pricing channel
// (visible in the `price[]` array and `store_availability[]` per-store rows).
const PRICING_STORE = '200';

export async function cotoSearch(store: CotoStore, query: string): Promise<Product[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = new URL('https://ac.cnstrc.com/search/' + encodeURIComponent(trimmed));
  url.searchParams.set('key', store.constructorKey);
  url.searchParams.set('i', 'llm-supermarket-shopper');
  url.searchParams.set('s', '1');
  url.searchParams.set('num_results_per_page', String(PAGE_SIZE));
  url.searchParams.set('_dt', String(Date.now()));

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'es-AR,es;q=0.9',
      Referer: `${store.baseUrl}/`,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`COTO ${store.id} ${response.status} on Constructor.io`);
  }
  const data = (await response.json()) as CotoConstructorResponse;

  const products: Product[] = [];
  for (const r of data.response?.results ?? []) {
    const rawSkuId = r.data.sku_plu ?? r.data.sku_id ?? r.data.id;
    const skuId = rawSkuId != null ? String(rawSkuId) : undefined;
    const productId = r.data.id ?? skuId;
    if (!skuId || !productId) continue;
    const price = r.data.product_list_price;
    if (typeof price !== 'number') continue;

    const availabilityRows = r.data.store_availability ?? [];
    const central = availabilityRows.find((row) => row.store === PRICING_STORE);
    // If COTO didn't return a central-store availability row at all, default
    // to "available" — Constructor.io only returns indexed/sellable products
    // in the first place. We only mark unavailable if the row is present and
    // explicitly false.
    const available = central ? central.available !== false : true;

    products.push({
      skuId,
      productId,
      name: r.data.sku_display_name ?? r.value,
      brand: r.data.product_brand,
      imageUrl: r.data.product_medium_image_url ?? r.data.image_url ?? r.data.product_large_image_url,
      price,
      available,
      productUrl: r.data.url ? `${store.baseUrl}/sitios/cdigi/productos/${r.data.url}` : undefined,
    });
  }
  return products;
}
