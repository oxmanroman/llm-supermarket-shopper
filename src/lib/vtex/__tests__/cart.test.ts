import { STORES } from '~/lib/store';
import type { VtexStore } from '~/lib/store';
import { buildVtexAddToCartUrl } from '../cart';

const jumbo = STORES.jumbo as VtexStore;
const carrefour = STORES.carrefour as VtexStore;

describe('buildVtexAddToCartUrl', () => {
  it('builds a single-item URL for Jumbo using its sc=32 channel', () => {
    const url = buildVtexAddToCartUrl(jumbo, [{ skuId: '12345', qty: 1 }]);
    expect(url).toBe('https://www.jumbo.com.ar/checkout/cart/add?sku=12345&qty=1&seller=1&sc=32&redirect=true');
  });

  it('builds a multi-item URL for Carrefour with repeated triples', () => {
    const url = buildVtexAddToCartUrl(carrefour, [
      { skuId: 'A', qty: 1 },
      { skuId: 'B', qty: 2 },
    ]);
    expect(url).toBe(
      'https://www.carrefour.com.ar/checkout/cart/add?sku=A&qty=1&seller=1&sku=B&qty=2&seller=1&sc=1&redirect=true',
    );
  });

  it('throws on empty items', () => {
    expect(() => buildVtexAddToCartUrl(jumbo, [])).toThrow('items is empty');
  });

  it('escapes special characters in skuId', () => {
    const url = buildVtexAddToCartUrl(jumbo, [{ skuId: 'a b&c', qty: 1 }]);
    expect(url).toContain('sku=a%20b%26c');
  });
});
