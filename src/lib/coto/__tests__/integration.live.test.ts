/**
 * @jest-environment node
 */
import { STORES } from '~/lib/store';
import type { CotoStore } from '~/lib/store';
import { cotoSearch } from '../search';

jest.setTimeout(30_000);

const liveDescribe = process.env.LIVE_TESTS === '1' ? describe : describe.skip;

const coto = STORES.coto as CotoStore;

liveDescribe('live COTO integration', () => {
  it('returns products for "leche" via Constructor.io', async () => {
    const products = await cotoSearch(coto, 'leche');
    expect(products.length).toBeGreaterThan(0);

    const first = products[0];
    expect(first.skuId).toBeTruthy();
    expect(first.name.toLowerCase()).toContain('leche');
    expect(first.price).toBeGreaterThan(0);
    expect(first.productUrl).toMatch(/^https:\/\/www\.cotodigital\.com\.ar\/sitios\/cdigi\/productos\//);
  });

  it('returns [] for nonsense query without throwing', async () => {
    const products = await cotoSearch(coto, 'asdfqwerzxcv-no-such-product-12345');
    expect(Array.isArray(products)).toBe(true);
  });
});
