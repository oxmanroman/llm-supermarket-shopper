import { buildAddToCartUrl } from '../cart';
import { STORES } from '../stores';

describe('buildAddToCartUrl', () => {
  it('builds a single-item URL for Jumbo using its sc=32 channel', () => {
    const url = buildAddToCartUrl(STORES.jumbo, [{ skuId: '12345', qty: 1 }]);
    expect(url).toBe('https://www.jumbo.com.ar/checkout/cart/add?sku=12345&qty=1&seller=1&sc=32&redirect=true');
  });

  it('builds a multi-item URL for Carrefour with repeated triples', () => {
    const url = buildAddToCartUrl(STORES.carrefour, [
      { skuId: 'A', qty: 1 },
      { skuId: 'B', qty: 2 },
    ]);
    expect(url).toBe(
      'https://www.carrefour.com.ar/checkout/cart/add?sku=A&qty=1&seller=1&sku=B&qty=2&seller=1&sc=1&redirect=true',
    );
  });

  it('throws on empty items', () => {
    expect(() => buildAddToCartUrl(STORES.jumbo, [])).toThrow('items is empty');
  });

  it('escapes special characters in skuId', () => {
    const url = buildAddToCartUrl(STORES.jumbo, [{ skuId: 'a b&c', qty: 1 }]);
    expect(url).toContain('sku=a%20b%26c');
  });
});
