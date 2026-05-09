/**
 * @jest-environment node
 */
jest.mock('../aggregate', () => ({ aggregate: jest.fn() }));
jest.mock('~/lib/llm/match-agent', () => ({ matchAgent: jest.fn() }));

import { matchAgent } from '~/lib/llm/match-agent';
import { STORES } from '~/lib/store';
import { aggregate } from '../aggregate';
import { recomputeRedirectUrl, resolve } from '../resolve';

const mockAggregate = aggregate as jest.MockedFunction<typeof aggregate>;
const mockMatch = matchAgent as jest.MockedFunction<typeof matchAgent>;

beforeEach(() => {
  mockAggregate.mockReset();
  mockMatch.mockReset();
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

describe('resolve', () => {
  it('runs aggregate → matchAgent and returns matched/unmatched/skipped', async () => {
    mockAggregate.mockResolvedValueOnce({
      aggregated: [ingMilk, ingFlour],
      skipped: [{ name: 'sal', reason: 'pantry staple' }],
      recipeSummaries: [],
    });
    mockMatch.mockResolvedValueOnce({
      picks: [{ ingredientIndex: 0, pickedSkuId: 'm1', cartQty: 1, confidence: 'high', reason: 'best name match' }],
      skipped: [{ ingredientIndex: 1, reason: 'no candidates' }],
      candidatesById: { 'a-milk': milkCandidates, 'a-flour': [] },
    });

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
    mockAggregate.mockResolvedValueOnce({ aggregated: [ingFlourBig], skipped: [], recipeSummaries: [] });
    mockMatch.mockResolvedValueOnce({
      picks: [
        { ingredientIndex: 0, pickedSkuId: 'f1', cartQty: 1, confidence: 'high', reason: '500g need ÷ 1000g pkg = 1' },
      ],
      skipped: [],
      candidatesById: { 'a-flour': flourCandidate1Kg },
    });

    const out = await resolve({ store: STORES.jumbo, recipes: [], preferences: '' });

    expect(out.matched[0].cartQty).toBe(1);
    expect(out.matched[0].ingredient.qty).toBe(500);
    expect(out.redirectUrl).not.toMatch(/qty=500/);
    expect(out.redirectUrl).toMatch(/sku=f1&qty=1/);
  });

  it('passes preferences and recipeSummaries to matchAgent', async () => {
    mockAggregate.mockResolvedValueOnce({
      aggregated: [ingMilk],
      skipped: [],
      recipeSummaries: [{ recipeId: 'r1', dish: 'tarta', cuisine: 'argentina', notes: '' }],
    });
    mockMatch.mockResolvedValueOnce({ picks: [], skipped: [], candidatesById: {} });

    await resolve({ store: STORES.jumbo, recipes: [], preferences: 'lactose-free' });

    expect(mockAggregate).toHaveBeenCalledWith(expect.objectContaining({ preferences: 'lactose-free' }));
    expect(mockMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: 'lactose-free',
        recipeSummaries: [{ recipeId: 'r1', dish: 'tarta', cuisine: 'argentina', notes: '' }],
        aggregated: [ingMilk],
        store: STORES.jumbo,
      }),
    );
  });

  it('skips picks whose pickedSkuId is not in candidatesById (treated as unmatched)', async () => {
    mockAggregate.mockResolvedValueOnce({ aggregated: [ingMilk], skipped: [], recipeSummaries: [] });
    mockMatch.mockResolvedValueOnce({
      picks: [{ ingredientIndex: 0, pickedSkuId: 'made-up', cartQty: 1, confidence: 'low', reason: 'hallucinated' }],
      skipped: [],
      candidatesById: { 'a-milk': milkCandidates },
    });

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

  it('recomputeRedirectUrl for COTO returns the first matched product PDP URL', () => {
    const url = recomputeRedirectUrl(
      [
        {
          aggregatedId: 'a',
          ingredient: ingMilk,
          picked: {
            ...milkCandidates[0],
            productUrl: 'https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-1-1-200',
          },
          confidence: 'high',
          cartQty: 1,
        },
      ],
      STORES.coto,
    );
    expect(url).toBe('https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-1-1-200');
  });

  it('resolve dispatches to the COTO adapter when storeId is coto', async () => {
    mockAggregate.mockResolvedValueOnce({ aggregated: [ingMilk], skipped: [], recipeSummaries: [] });
    const cotoMilkCandidate = {
      skuId: '00008899',
      productId: 'prod00008899',
      name: 'Leche Larga Vida Entera COTO Ttb 1 L',
      price: 2199,
      available: true,
      productUrl: 'https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-00008899-00008899-200',
    };
    mockMatch.mockResolvedValueOnce({
      picks: [
        { ingredientIndex: 0, pickedSkuId: '00008899', cartQty: 1, confidence: 'high', reason: 'COTO own brand' },
      ],
      skipped: [],
      candidatesById: { 'a-milk': [cotoMilkCandidate] },
    });

    const out = await resolve({ store: STORES.coto, recipes: [], preferences: '' });

    expect(out.matched).toHaveLength(1);
    expect(out.matched[0].picked.productUrl).toMatch(/cotodigital\.com\.ar\/sitios\/cdigi\/productos\//);
    expect(out.redirectUrl).toBe(cotoMilkCandidate.productUrl);
  });
});
