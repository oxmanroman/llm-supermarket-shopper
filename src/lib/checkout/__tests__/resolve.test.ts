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
      { ingredientIndex: 0, pickedSkuId: 'm1', cartQty: 1, confidence: 'high', reason: 'best name match' },
      { ingredientIndex: 1, pickedSkuId: null, cartQty: null, confidence: 'low', reason: 'no candidates' },
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
    expect(out.matched[0].cartQty).toBe(1);
    expect(out.unmatched).toHaveLength(1);
    expect(out.unmatched[0].id).toBe('a-flour');
    expect(out.skipped).toHaveLength(1);
    expect(out.candidates['a-milk']).toEqual(milkCandidates);
    expect(out.candidates['a-flour']).toEqual([]);
    // Cart URL qty MUST be the matcher's cartQty (= 1 package), not the recipe qty (= 1 L of milk).
    expect(out.redirectUrl).toMatch(/jumbo\.com\.ar\/checkout\/cart\/add\?sku=m1&qty=1&seller=1/);
  });

  it('cart URL qty comes from matcher cartQty, NOT recipe ingredient.qty (regression: 500g flour ≠ 500 packages)', async () => {
    const ingFlourBig = {
      id: 'a-flour',
      name: 'harina',
      qty: 500,
      unit: 'g',
      sources: [{ recipeId: 'r1', recipeLabel: 'X', originalText: '500 g harina' }],
    };
    const flourCandidate1Kg = [
      { skuId: 'f1', productId: 'pf', name: 'Harina 0000 1 Kg Caserita', price: 1500, available: true },
    ];
    mockAggregate.mockResolvedValueOnce({ aggregated: [ingFlourBig], skipped: [] });
    mockSearch.mockResolvedValueOnce(flourCandidate1Kg);
    mockPick.mockResolvedValueOnce([
      { ingredientIndex: 0, pickedSkuId: 'f1', cartQty: 1, confidence: 'high', reason: '500g need ÷ 1000g pkg = 1' },
    ]);

    const out = await resolve({ store: STORES.jumbo, recipes: [], preferences: '' });

    expect(out.matched[0].cartQty).toBe(1);
    expect(out.matched[0].ingredient.qty).toBe(500); // recipe need preserved
    // The cart URL must NOT contain qty=500.
    expect(out.redirectUrl).not.toMatch(/qty=500/);
    expect(out.redirectUrl).toMatch(/sku=f1&qty=1/);
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
      { ingredientIndex: 0, pickedSkuId: 'made-up', cartQty: 1, confidence: 'low', reason: 'hallucinated' },
    ]);

    const out = await resolve({ store: STORES.jumbo, recipes: [], preferences: '' });
    expect(out.matched).toHaveLength(0);
    expect(out.unmatched).toHaveLength(1);
  });

  it('recomputeRedirectUrl rebuilds the URL from matched items + cartQty (not recipe qty)', () => {
    const url = recomputeRedirectUrl(
      [
        {
          aggregatedId: 'a',
          ingredient: { ...ingMilk, qty: 240, unit: 'ml' }, // recipe need: 240 ml of milk
          picked: milkCandidates[0],
          confidence: 'high',
          cartQty: 1, // 1 package of 1L milk covers it
        },
      ],
      STORES.jumbo,
    );
    expect(url).toMatch(/sku=m1&qty=1&seller=1/);
    expect(url).not.toMatch(/qty=240/);
  });
});
