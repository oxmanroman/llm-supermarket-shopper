/**
 * @jest-environment node
 */
import { buildAddToCartUrl } from '../cart';
import { productSearch } from '../search';
import { STORES, STORE_IDS } from '../stores';

jest.setTimeout(30_000);

const liveDescribe = process.env.LIVE_TESTS === '1' ? describe : describe.skip;

type OrderFormItem = { id: string; name: string; quantity: number };
type OrderFormMessage = { code: string; status: string; text: string };
type OrderForm = {
  orderFormId: string;
  salesChannel: string;
  items: OrderFormItem[];
  messages: OrderFormMessage[];
};

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

  it('creates an orderForm and adds an item via the public Checkout API', async () => {
    const products = await productSearch(store, 'leche');
    const sku = products[0].skuId;
    const sc = store.defaultSalesChannel;

    const createRes = await fetch(`${store.baseUrl}/api/checkout/pub/orderForm?sc=${sc}`, {
      method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json' },
    });
    expect(createRes.ok).toBe(true);
    const created = (await createRes.json()) as OrderForm;
    expect(created.salesChannel).toBe(sc);

    const addRes = await fetch(`${store.baseUrl}/api/checkout/pub/orderForm/${created.orderFormId}/items?sc=${sc}`, {
      method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderItems: [{ id: sku, quantity: 1, seller: store.defaultSeller }] }),
    });
    expect(addRes.ok).toBe(true);
    const after = (await addRes.json()) as OrderForm;

    const messageCodes = (after.messages ?? []).map((m) => m.code);
    expect(messageCodes).not.toContain('ORD027');
    expect(after.items).toHaveLength(1);
    expect(after.items[0].id).toBe(sku);
  });
});
