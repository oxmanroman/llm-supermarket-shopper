/**
 * @jest-environment node
 */
import { STORES } from '~/lib/store';
import type { CotoStore } from '~/lib/store';
import { cotoSearch } from '../search';

const coto = STORES.coto as CotoStore;

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => mockFetch.mockReset());

const mkResult = (over: { data?: Record<string, unknown>; value?: string } = {}) => ({
  value: over.value ?? 'Leche Larga Vida Entera COTO Ttb 1 L',
  data: {
    id: 'prod00008899',
    sku_id: '00008899',
    sku_plu: '00008899',
    sku_display_name: 'Leche Larga Vida Entera COTO Ttb 1 L',
    product_brand: 'COTO',
    product_list_price: 2199,
    image_url: 'https://static.cotodigital3.com.ar/sitios/fotos/large/00008800/00008899.jpg',
    product_medium_image_url: 'https://static.cotodigital3.com.ar/sitios/fotos/medium/00008800/00008899.jpg',
    url: '_/R-00008899-00008899-200',
    store_availability: [{ store: '200', available: true }],
    ...over.data,
  },
});

describe('cotoSearch', () => {
  it('normalizes a Constructor.io result into Product[] with PDP URL', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: { results: [mkResult()] } }), { status: 200 }),
    );

    const products = await cotoSearch(coto, 'leche');

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      skuId: '00008899',
      productId: 'prod00008899',
      name: 'Leche Larga Vida Entera COTO Ttb 1 L',
      brand: 'COTO',
      price: 2199,
      available: true,
      productUrl: 'https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-00008899-00008899-200',
    });
    expect(products[0].imageUrl).toMatch(/static\.cotodigital3\.com\.ar/);
  });

  it('hits Constructor.io with the configured key and url-encoded query', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ response: { results: [] } }), { status: 200 }));
    await cotoSearch(coto, 'queso untable');
    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain('https://ac.cnstrc.com/search/queso%20untable');
    expect(callUrl).toContain(`key=${coto.constructorKey}`);
    expect(callUrl).toContain('num_results_per_page=12');
  });

  it('returns [] when query is empty without making a request', async () => {
    const products = await cotoSearch(coto, '   ');
    expect(products).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when Constructor.io returns non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('blocked', { status: 403 }));
    await expect(cotoSearch(coto, 'leche')).rejects.toThrow(/403/);
  });

  it('skips results without a usable id or price', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: {
            results: [
              mkResult({ data: { id: undefined, sku_id: undefined, sku_plu: undefined } }),
              mkResult({ data: { product_list_price: undefined } }),
              mkResult(),
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const products = await cotoSearch(coto, 'leche');
    expect(products).toHaveLength(1);
  });

  it('treats missing central-store availability row as available', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: { results: [mkResult({ data: { store_availability: [] } })] } }), {
        status: 200,
      }),
    );
    const products = await cotoSearch(coto, 'leche');
    expect(products[0].available).toBe(true);
  });

  it('marks unavailable when central store explicitly says false', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: { results: [mkResult({ data: { store_availability: [{ store: '200', available: false }] } })] },
        }),
        { status: 200 },
      ),
    );
    const products = await cotoSearch(coto, 'leche');
    expect(products[0].available).toBe(false);
  });
});
