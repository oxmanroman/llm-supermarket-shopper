/**
 * @jest-environment node
 */
jest.mock('ai', () => ({
  tool: jest.fn((def) => def),
  isStepCount: jest.fn((n: number) => ({ kind: 'isStepCount', n })),
}));
jest.mock('../client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));
jest.mock('~/lib/store', () => {
  const actual = jest.requireActual('~/lib/store');
  return { ...actual, productSearch: jest.fn(async () => []) };
});

import type { Product, Store } from '~/lib/store';
import { STORES, productSearch as storeProductSearch } from '~/lib/store';
import { buildMatchAgentTools } from '../match-agent';

const mockStoreSearch = storeProductSearch as jest.MockedFunction<typeof storeProductSearch>;

const milkProduct: Product = {
  skuId: 'm1',
  productId: 'p1',
  name: 'Leche entera 1L',
  price: 800,
  available: true,
};
const milkProduct2: Product = {
  skuId: 'm2',
  productId: 'p2',
  name: 'Leche descremada 1L',
  price: 850,
  available: true,
};

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

beforeEach(() => {
  mockStoreSearch.mockReset();
  mockStoreSearch.mockResolvedValue([]);
});

describe('buildMatchAgentTools', () => {
  it('searchProducts populates candidatesById per ingredientIndex and trims to top 15', async () => {
    const big = Array.from({ length: 30 }, (_, i) => ({
      skuId: `s${i}`,
      productId: `p${i}`,
      name: `Leche variant ${i}`,
      price: 100 + i,
      available: true,
    }));
    const search = jest.fn(async () => big);

    const ctx = makeCtx({ store: STORES.jumbo, aggregated: [ingMilk, ingFlour], productSearch: search });
    const tools = buildMatchAgentTools(ctx);

    const out = await tools.searchProducts.execute({ query: 'leche entera', ingredientIndex: 0 }, undefined as never);

    expect(search).toHaveBeenCalledWith(STORES.jumbo, 'leche entera');
    expect(out.results).toHaveLength(15);
    // Trimmed shape: just skuId/name/brand/price/available, NOT productId.
    expect(out.results[0]).toEqual(
      expect.objectContaining({ skuId: 's0', name: 'Leche variant 0', price: 100, available: true }),
    );
    expect(out.results[0]).not.toHaveProperty('productId');
    // candidatesById is populated for the ingredient (full Product shape, top 15).
    expect(ctx.candidatesById['a-milk']).toHaveLength(15);
    expect(ctx.candidatesById['a-milk'][0]).toEqual(big[0]);
  });

  it('searchProducts caches by query string across calls', async () => {
    const search = jest.fn(async () => [milkProduct]);
    const ctx = makeCtx({ store: STORES.jumbo, aggregated: [ingMilk], productSearch: search });
    const tools = buildMatchAgentTools(ctx);

    await tools.searchProducts.execute({ query: 'leche', ingredientIndex: 0 }, undefined as never);
    await tools.searchProducts.execute({ query: 'leche', ingredientIndex: 0 }, undefined as never);

    expect(search).toHaveBeenCalledTimes(1);
  });

  it('searchProducts merges results into candidatesById, deduping by skuId across queries', async () => {
    const search = jest.fn().mockResolvedValueOnce([milkProduct]).mockResolvedValueOnce([milkProduct, milkProduct2]);
    const ctx = makeCtx({ store: STORES.jumbo, aggregated: [ingMilk], productSearch: search });
    const tools = buildMatchAgentTools(ctx);

    await tools.searchProducts.execute({ query: 'leche', ingredientIndex: 0 }, undefined as never);
    await tools.searchProducts.execute({ query: 'leche entera', ingredientIndex: 0 }, undefined as never);

    expect(ctx.candidatesById['a-milk']).toHaveLength(2);
    expect(ctx.candidatesById['a-milk'].map((p) => p.skuId).sort()).toEqual(['m1', 'm2']);
  });

  it('submitPick records the pick in the context picks map', async () => {
    const ctx = makeCtx({ store: STORES.jumbo, aggregated: [ingMilk] });
    const tools = buildMatchAgentTools(ctx);

    const out = await tools.submitPick.execute(
      { ingredientIndex: 0, pickedSkuId: 'm1', cartQty: 1, confidence: 'high', reason: 'best' },
      undefined as never,
    );

    expect(out).toEqual({ ok: true });
    expect(ctx.picks.get(0)).toEqual({
      ingredientIndex: 0,
      pickedSkuId: 'm1',
      cartQty: 1,
      confidence: 'high',
      reason: 'best',
    });
  });

  it('skipIngredient records the skip reason', async () => {
    const ctx = makeCtx({ store: STORES.jumbo, aggregated: [ingMilk] });
    const tools = buildMatchAgentTools(ctx);

    await tools.skipIngredient.execute(
      { ingredientIndex: 0, reason: 'no candidates after 4 queries' },
      undefined as never,
    );

    expect(ctx.skipped.get(0)).toBe('no candidates after 4 queries');
  });
});

type MakeCtxArgs = {
  store: Store;
  aggregated: (typeof ingMilk)[];
  productSearch?: (store: Store, query: string) => Promise<Product[]>;
};

function makeCtx({ store, aggregated, productSearch }: MakeCtxArgs) {
  return {
    store,
    aggregated,
    productSearch: productSearch ?? (async () => []),
    searchCache: new Map<string, Product[]>(),
    candidatesById: {} as Record<string, Product[]>,
    picks: new Map<number, import('../types').Pick>(),
    skipped: new Map<number, string>(),
  };
}
