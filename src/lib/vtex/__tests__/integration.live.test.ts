/**
 * @jest-environment node
 */
import { buildAddToCartUrl } from '../cart';
import { productSearch } from '../search';
import { STORES, STORE_IDS } from '../stores';

jest.setTimeout(20_000);

const liveDescribe = process.env.LIVE_TESTS === '1' ? describe : describe.skip;

liveDescribe.each(STORE_IDS)('live VTEX integration: %s', (storeId) => {
  const store = STORES[storeId];

  it('returns products for "leche"', async () => {
    const products = await productSearch(store, 'leche');
    expect(products.length).toBeGreaterThan(0);
    const first = products[0];
    expect(first.skuId).toMatch(/^\d+$/);
    expect(first.name).toBeTruthy();
    expect(first.price).toBeGreaterThan(0);
  });

  it('builds a syntactically valid add-to-cart URL', async () => {
    const products = await productSearch(store, 'leche');
    const url = buildAddToCartUrl(store, [{ skuId: products[0].skuId, qty: 1 }]);
    const parsed = new URL(url);
    expect(parsed.host).toBe(new URL(store.baseUrl).host);
    expect(parsed.pathname).toBe('/checkout/cart/add');
    expect(parsed.searchParams.getAll('sku')).toEqual([products[0].skuId]);
  });
});
