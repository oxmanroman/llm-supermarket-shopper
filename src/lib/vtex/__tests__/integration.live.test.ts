/**
 * @jest-environment node
 */
import { STORES } from '~/lib/store';
import type { VtexStore } from '~/lib/store';
import { buildVtexAddToCartUrl } from '../cart';
import { vtexSearch } from '../search';

jest.setTimeout(30_000);

const liveDescribe = process.env.LIVE_TESTS === '1' ? describe : describe.skip;

const VTEX_STORES: VtexStore[] = Object.values(STORES).filter((store): store is VtexStore => store.platform === 'vtex');

type OrderFormItem = { id: string; name: string; quantity: number };
type OrderFormMessage = { code: string; status: string; text: string };
type OrderForm = {
  orderFormId: string;
  salesChannel: string;
  items: OrderFormItem[];
  messages: OrderFormMessage[];
};

liveDescribe.each(VTEX_STORES.map((s) => [s.id, s] as const))('live VTEX integration: %s', (_id, store) => {
  it('returns products for "leche"', async () => {
    const products = await vtexSearch(store, 'leche');
    expect(products.length).toBeGreaterThan(0);
    const first = products[0];
    expect(first.skuId).toMatch(/^\d+$/);
    expect(first.name).toBeTruthy();
    expect(first.price).toBeGreaterThan(0);
  });

  it('builds a syntactically valid add-to-cart URL', async () => {
    const products = await vtexSearch(store, 'leche');
    const url = buildVtexAddToCartUrl(store, [{ skuId: products[0].skuId, qty: 1 }]);
    const parsed = new URL(url);
    expect(parsed.host).toBe(new URL(store.baseUrl).host);
    expect(parsed.pathname).toBe('/checkout/cart/add');
    expect(parsed.searchParams.getAll('sku')).toEqual([products[0].skuId]);
  });

  it('creates an orderForm and adds an item via the public Checkout API', async () => {
    const products = await vtexSearch(store, 'leche');
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
