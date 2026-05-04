/**
 * @jest-environment node
 */
import { productSearch } from '../search';
import { STORES } from '../stores';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const sampleVtexResponse = [
  {
    productId: '111',
    productName: 'La Serenísima Leche Entera 1L',
    brand: 'La Serenísima',
    items: [
      {
        itemId: '1001',
        name: 'La Serenísima Leche Entera 1L',
        images: [{ imageUrl: 'https://cdn/img.jpg', imageText: 'leche' }],
        sellers: [
          {
            sellerId: '1',
            commertialOffer: { Price: 850, ListPrice: 850, IsAvailable: true },
          },
        ],
      },
    ],
  },
];

describe('productSearch', () => {
  beforeEach(() => mockFetch.mockReset());

  it('normalizes a Jumbo response into Product[]', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(sampleVtexResponse), { status: 200 }));

    const products = await productSearch(STORES.jumbo, 'leche');

    expect(products).toEqual([
      {
        skuId: '1001',
        productId: '111',
        name: 'La Serenísima Leche Entera 1L',
        brand: 'La Serenísima',
        imageUrl: 'https://cdn/img.jpg',
        price: 850,
        available: true,
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.jumbo.com.ar/api/catalog_system/pub/products/search/?ft=leche&_from=0&_to=11',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Language': 'es-AR,es;q=0.9',
          'User-Agent': expect.any(String),
        }),
      }),
    );
  });

  it('returns [] when VTEX returns empty array', async () => {
    mockFetch.mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const products = await productSearch(STORES.jumbo, 'xyzzz');
    expect(products).toEqual([]);
  });

  it('throws when VTEX returns non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('blocked', { status: 403 }));
    await expect(productSearch(STORES.carrefour, 'leche')).rejects.toThrow(/403/);
  });

  it('skips products with no usable item/seller', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([{ productId: '1', productName: 'broken', items: [] }, ...sampleVtexResponse]), {
        status: 200,
      }),
    );
    const products = await productSearch(STORES.jumbo, 'leche');
    expect(products).toHaveLength(1);
  });
});
