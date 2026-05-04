/**
 * @jest-environment node
 */
jest.mock('../fetch', () => ({ fetchAndCleanHtml: jest.fn() }));
jest.mock('~/lib/llm/extract', () => ({ extractIngredients: jest.fn() }));
jest.mock('~/lib/llm/match', () => ({ pickSkus: jest.fn() }));
jest.mock('~/lib/vtex/search', () => ({ productSearch: jest.fn() }));

import { extractIngredients } from '~/lib/llm/extract';
import { pickSkus } from '~/lib/llm/match';
import { productSearch } from '~/lib/vtex/search';
import { STORES } from '~/lib/vtex/stores';
import { fetchAndCleanHtml } from '../fetch';
import { runRecipePipeline } from '../pipeline';

const mockedFetch = fetchAndCleanHtml as jest.MockedFunction<typeof fetchAndCleanHtml>;
const mockedExtract = extractIngredients as jest.MockedFunction<typeof extractIngredients>;
const mockedPick = pickSkus as jest.MockedFunction<typeof pickSkus>;
const mockedSearch = productSearch as jest.MockedFunction<typeof productSearch>;

beforeEach(() => {
  mockedFetch.mockReset();
  mockedExtract.mockReset();
  mockedPick.mockReset();
  mockedSearch.mockReset();
});

describe('runRecipePipeline', () => {
  it('returns CartItem[] for matched picks and unmatched names for null picks', async () => {
    mockedFetch.mockResolvedValueOnce('<html>ok</html>');
    mockedExtract.mockResolvedValueOnce([
      { name: 'manteca', qty: 200, unit: 'g' },
      { name: 'salvia', qty: null, unit: null },
    ]);
    mockedSearch
      .mockResolvedValueOnce([
        { skuId: 'sku-manteca', productId: 'p1', name: 'Manteca 200g', price: 1500, available: true },
      ])
      .mockResolvedValueOnce([]);
    mockedPick.mockResolvedValueOnce([
      { ingredientIndex: 0, pickedSkuId: 'sku-manteca', confidence: 'high', reason: 'name match' },
      { ingredientIndex: 1, pickedSkuId: null, confidence: 'low', reason: 'no candidates' },
    ]);

    const result = await runRecipePipeline({
      url: 'https://example.test/recipe',
      store: STORES.jumbo,
      preferences: '',
    });

    expect(result.items).toEqual([
      { skuId: 'sku-manteca', qty: 1, name: 'Manteca 200g', imageUrl: undefined, price: 1500 },
    ]);
    expect(result.unmatched).toEqual(['salvia']);
    expect(mockedFetch).toHaveBeenCalledWith('https://example.test/recipe');
    expect(mockedSearch).toHaveBeenCalledTimes(2);
    expect(mockedPick).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredients: [
          { name: 'manteca', qty: 200, unit: 'g' },
          { name: 'salvia', qty: null, unit: null },
        ],
        preferences: '',
      }),
    );
  });

  it('passes preferences through to pickSkus', async () => {
    mockedFetch.mockResolvedValueOnce('<html>ok</html>');
    mockedExtract.mockResolvedValueOnce([{ name: 'leche', qty: 1, unit: 'L' }]);
    mockedSearch.mockResolvedValueOnce([{ skuId: '1', productId: 'p1', name: 'Leche', price: 800, available: true }]);
    mockedPick.mockResolvedValueOnce([
      { ingredientIndex: 0, pickedSkuId: '1', confidence: 'high', reason: 'lactose-free' },
    ]);

    await runRecipePipeline({
      url: 'https://example.test/r',
      store: STORES.jumbo,
      preferences: 'prefer lactose-free dairy',
    });

    expect(mockedPick).toHaveBeenCalledWith(expect.objectContaining({ preferences: 'prefer lactose-free dairy' }));
  });

  it('returns all-unmatched when extract returns []', async () => {
    mockedFetch.mockResolvedValueOnce('<html>ok</html>');
    mockedExtract.mockResolvedValueOnce([]);

    const result = await runRecipePipeline({
      url: 'https://example.test/x',
      store: STORES.jumbo,
      preferences: '',
    });

    expect(result.items).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(mockedPick).not.toHaveBeenCalled();
  });

  it('skips picks pointing at SKUs not in their candidate list', async () => {
    mockedFetch.mockResolvedValueOnce('<html>ok</html>');
    mockedExtract.mockResolvedValueOnce([{ name: 'leche', qty: null, unit: null }]);
    mockedSearch.mockResolvedValueOnce([{ skuId: '1', productId: 'p', name: 'Leche', price: 800, available: true }]);
    mockedPick.mockResolvedValueOnce([
      { ingredientIndex: 0, pickedSkuId: 'made-up-sku', confidence: 'low', reason: 'hallucinated' },
    ]);

    const result = await runRecipePipeline({
      url: 'https://example.test/x',
      store: STORES.jumbo,
      preferences: '',
    });

    expect(result.items).toEqual([]);
    expect(result.unmatched).toEqual(['leche']);
  });
});
