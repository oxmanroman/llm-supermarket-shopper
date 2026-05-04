/**
 * @jest-environment node
 */
jest.mock('../aggregate', () => ({ aggregate: jest.fn() }));
jest.mock('~/lib/llm/match', () => ({ pickSkus: jest.fn() }));
jest.mock('~/lib/vtex/search', () => ({ productSearch: jest.fn() }));

import { pickSkus } from '~/lib/llm/match';
import { productSearch } from '~/lib/vtex/search';
import { STORES } from '~/lib/vtex/stores';
import { aggregate } from '../aggregate';
import { recomputeRedirectUrl, resolve } from '../resolve';

const mockAggregate = aggregate as jest.MockedFunction<typeof aggregate>;
const mockPick = pickSkus as jest.MockedFunction<typeof pickSkus>;
const mockSearch = productSearch as jest.MockedFunction<typeof productSearch>;

beforeEach(() => {
  mockAggregate.mockReset();
  mockPick.mockReset();
  mockSearch.mockReset();
});

const ingMilk = {
  id: 'a-milk',
  name: 'leche',
  qty: 1,
  unit: 'L',
  sources: [{ recipeId: 'r1', recipeLabel: 'Tarta', originalText: '1 L leche' }],
};
const ingFlour = {
  id: 'a-flour',
  name: 'harina',
  qty: 500,
  unit: 'g',
  sources: [{ recipeId: 'r1', recipeLabel: 'Tarta', originalText: '500 g harina' }],
};
const milkCandidates = [
  { skuId: 'm1', productId: 'p1', name: 'Leche entera 1L', price: 800, available: true },
  { skuId: 'm2', productId: 'p2', name: 'Leche descremada 1L', price: 850, available: true },
];
const flourCandidates: never[] = [];

describe('resolve', () => {
  it('runs aggregate → search → match and returns matched/unmatched/skipped', async () => {
    mockAggregate.mockResolvedValueOnce({
      aggregated: [ingMilk, ingFlour],
      skipped: [{ name: 'sal', reason: 'pantry staple' }],
    });
    mockSearch.mockResolvedValueOnce(milkCandidates).mockResolvedValueOnce(flourCandidates);
    mockPick.mockResolvedValueOnce([
      { ingredientIndex: 0, pickedSkuId: 'm1', confidence: 'high', reason: 'best name match' },
      { ingredientIndex: 1, pickedSkuId: null, confidence: 'low', reason: 'no candidates' },
    ]);

    const out = await resolve({
      store: STORES.jumbo,
      recipes: [
        {
          id: 'r1',
          label: 'Tarta',
          source: { kind: 'manual' },
          ingredients: [
            { id: 'i1', text: '1 L leche', qty: 1, unit: 'L' },
            { id: 'i2', text: '500 g harina', qty: 500, unit: 'g' },
          ],
          createdAt: 1,
        },
      ],
      preferences: '',
    });

    expect(out.matched).toHaveLength(1);
    expect(out.matched[0].picked.skuId).toBe('m1');
    expect(out.matched[0].ingredient.id).toBe('a-milk');
    expect(out.unmatched).toHaveLength(1);
    expect(out.unmatched[0].id).toBe('a-flour');
    expect(out.skipped).toHaveLength(1);
    expect(out.candidates['a-milk']).toEqual(milkCandidates);
    expect(out.candidates['a-flour']).toEqual([]);
    expect(out.redirectUrl).toMatch(/jumbo\.com\.ar\/checkout\/cart\/add\?sku=m1/);
  });

  it('passes preferences to aggregate and pickSkus', async () => {
    mockAggregate.mockResolvedValueOnce({ aggregated: [], skipped: [] });
    await resolve({
      store: STORES.jumbo,
      recipes: [],
      preferences: 'lactose-free',
    });
    expect(mockAggregate).toHaveBeenCalledWith(expect.objectContaining({ preferences: 'lactose-free' }));
  });

  it('skips picks whose pickedSkuId is not in candidates (treated as unmatched)', async () => {
    mockAggregate.mockResolvedValueOnce({ aggregated: [ingMilk], skipped: [] });
    mockSearch.mockResolvedValueOnce(milkCandidates);
    mockPick.mockResolvedValueOnce([
      { ingredientIndex: 0, pickedSkuId: 'made-up', confidence: 'low', reason: 'hallucinated' },
    ]);

    const out = await resolve({ store: STORES.jumbo, recipes: [], preferences: '' });
    expect(out.matched).toHaveLength(0);
    expect(out.unmatched).toHaveLength(1);
  });

  it('recomputeRedirectUrl rebuilds the URL from matched items + qty', () => {
    const url = recomputeRedirectUrl(
      [
        {
          aggregatedId: 'a',
          ingredient: { ...ingMilk, qty: 2 },
          picked: milkCandidates[0],
          confidence: 'high',
        },
      ],
      STORES.jumbo,
    );
    expect(url).toMatch(/sku=m1&qty=2&seller=1/);
  });
});
