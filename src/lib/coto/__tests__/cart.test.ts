import { STORES } from '~/lib/store';
import type { CotoStore } from '~/lib/store';
import { buildCotoHandoffUrl } from '../cart';

const coto = STORES.coto as CotoStore;

describe('buildCotoHandoffUrl', () => {
  it('returns the first matched product PDP URL when available', () => {
    const url = buildCotoHandoffUrl(coto, [
      { skuId: 'a', qty: 1 },
      {
        skuId: 'b',
        qty: 2,
        product: {
          skuId: 'b',
          productId: 'pb',
          name: 'Leche Entera 1L',
          price: 2199,
          available: true,
          productUrl: 'https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-1-1-200',
        },
      },
    ]);
    expect(url).toBe('https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-1-1-200');
  });

  it('falls back to the COTO homepage when no item has a PDP URL', () => {
    const url = buildCotoHandoffUrl(coto, [{ skuId: 'a', qty: 1 }]);
    expect(url).toBe('https://www.cotodigital.com.ar');
  });

  it('throws on empty items', () => {
    expect(() => buildCotoHandoffUrl(coto, [])).toThrow('items is empty');
  });
});
