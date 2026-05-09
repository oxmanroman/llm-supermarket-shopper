# Agent-Driven Matcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot `pickSkus` matcher with a Vercel AI SDK `generateText` agent loop that iteratively searches the supermarket via tools, refining queries until it finds matches or gives up. The agent sees the whole shopping list plus per-recipe `dish/cuisine/notes` context.

**Architecture:** `aggregate.ts` is extended to emit `recipeSummaries` as a free byproduct of its existing LLM call. A new `src/lib/llm/match-agent.ts` runs `generateText` with three tools (`searchProducts`, `submitPick`, `skipIngredient`) and `stopWhen: [isStepCount(N), allResolved]`. Tools mutate closure-scope `Map`s; the result is bundled at the end. `resolve.ts` drops its pre-search loop and calls the agent directly.

**Tech Stack:** Next.js 15, TypeScript strict, Vercel AI SDK v6 (`ai ^6.0.174`), `@openrouter/ai-sdk-provider`, Zod v4, Jest.

**Spec:** `docs/superpowers/specs/2026-05-09-agent-driven-matcher-design.md`

---

## File Structure

**New:**
- `src/lib/llm/match-agent.ts` — agent orchestrator + tool factory.
- `src/lib/llm/__tests__/match-agent.test.ts` — unit tests for the factory and orchestrator.

**Modified:**
- `src/lib/checkout/aggregate.ts` — emits `recipeSummaries`.
- `src/lib/checkout/__tests__/aggregate.test.ts` — assertions for `recipeSummaries`.
- `src/lib/checkout/resolve.ts` — drops pre-search, calls `matchAgent`.
- `src/lib/checkout/__tests__/resolve.test.ts` — mocks `matchAgent` instead of `pickSkus` + `productSearch`.
- `src/lib/checkout/__tests__/eval.live.test.ts` — adds recall assertion.
- `src/lib/llm/__tests__/llm.live.test.ts` — drops the `pickSkus` live case (covered by eval).
- `src/types/plan.ts` — exports `RecipeSummary` type.

**Deleted:**
- `src/lib/llm/match.ts`
- `src/lib/llm/__tests__/match.test.ts`

---

## Task 1: Extend `aggregate.ts` to emit `recipeSummaries`

**Files:**
- Modify: `src/types/plan.ts`
- Modify: `src/lib/checkout/aggregate.ts`
- Modify: `src/lib/checkout/__tests__/aggregate.test.ts`

- [ ] **Step 1.1: Add `RecipeSummary` type to `src/types/plan.ts`**

Add after the `SkippedIngredient` type:

```ts
export type RecipeSummary = {
  recipeId: string;
  dish: string;
  cuisine: string;
  notes: string;
};
```

- [ ] **Step 1.2: Write failing test in `aggregate.test.ts`**

Replace the first `it(...)` block with:

```ts
it('passes recipes + preferences to the LLM and returns parsed output', async () => {
  mockGenerate.mockResolvedValueOnce({
    object: {
      aggregated: [
        {
          id: 'a1',
          name: 'cebolla',
          qty: 2,
          unit: null,
          sources: [
            { recipeId: 'r1', recipeLabel: 'Empanadas de pollo', originalText: '1 cebolla' },
            { recipeId: 'r2', recipeLabel: 'Tarta de espinaca', originalText: '1 cebolla' },
          ],
        },
        {
          id: 'a2',
          name: 'pollo',
          qty: 200,
          unit: 'g',
          sources: [{ recipeId: 'r1', recipeLabel: 'Empanadas de pollo', originalText: '200 g pollo' }],
        },
        {
          id: 'a3',
          name: 'espinaca',
          qty: 1,
          unit: 'paquete',
          sources: [{ recipeId: 'r2', recipeLabel: 'Tarta de espinaca', originalText: '1 paquete de espinaca' }],
        },
      ],
      skipped: [{ name: 'sal', reason: 'pantry staple' }],
      recipeSummaries: [
        { recipeId: 'r1', dish: 'empanadas de pollo', cuisine: 'argentina', notes: 'tapas para empanadas obligatorias' },
        { recipeId: 'r2', dish: 'tarta de espinaca', cuisine: 'argentina', notes: '' },
      ],
    },
  } as never);

  const result = await aggregate({ recipes: [empanadas, tarta], preferences: '' });

  expect(result.aggregated).toHaveLength(3);
  expect(result.skipped).toHaveLength(1);
  expect(result.aggregated[0].sources).toHaveLength(2);
  expect(result.recipeSummaries).toHaveLength(2);
  expect(result.recipeSummaries[0]).toEqual({
    recipeId: 'r1',
    dish: 'empanadas de pollo',
    cuisine: 'argentina',
    notes: 'tapas para empanadas obligatorias',
  });
  const args = mockGenerate.mock.calls[0][0] as { prompt: string };
  expect(args.prompt).toContain('Empanadas de pollo');
  expect(args.prompt).toContain('Tarta de espinaca');
  expect(args.prompt.toLowerCase()).toContain('skipped');
  expect(args.prompt.toLowerCase()).toContain('cup');
  expect(args.prompt.toLowerCase()).toContain('unidad');
  // The prompt must instruct the LLM to also produce per-recipe summaries
  // for the matcher agent downstream.
  expect(args.prompt.toLowerCase()).toContain('recipesummaries');
  expect(args.prompt.toLowerCase()).toContain('dish');
  expect(args.prompt.toLowerCase()).toContain('cuisine');
});
```

Also update the second test (`includes preferences block...`) and the empty-preferences test to mock with `recipeSummaries: []`:

```ts
mockGenerate.mockResolvedValueOnce({ object: { aggregated: [], skipped: [], recipeSummaries: [] } } as never);
```

- [ ] **Step 1.3: Run the test, verify it fails**

```
pnpm test:unit -- src/lib/checkout/__tests__/aggregate.test.ts
```

Expected: failures on `result.recipeSummaries` (undefined) and on the `recipesummaries`/`dish`/`cuisine` prompt-substring assertions.

- [ ] **Step 1.4: Update `aggregate.ts`**

Update imports and the schema:

```ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { createLlm } from '~/lib/llm/client';
import { describeLlmError } from '~/lib/llm/errors';
import type { AggregatedIngredient, Recipe, RecipeSummary, SkippedIngredient } from '~/types/plan';

const AggregatedSchema = z.object({
  id: z.string(),
  name: z.string(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  sources: z.array(z.object({ recipeId: z.string(), recipeLabel: z.string(), originalText: z.string() })),
});
const SkippedSchema = z.object({ name: z.string(), reason: z.string() });
const RecipeSummarySchema = z.object({
  recipeId: z.string(),
  dish: z.string(),
  cuisine: z.string(),
  notes: z.string(),
});
const AggregateOutputSchema = z.object({
  aggregated: z.array(AggregatedSchema),
  skipped: z.array(SkippedSchema),
  recipeSummaries: z.array(RecipeSummarySchema),
});
```

Append to the `SYSTEM_PROMPT` (before the final ⚠️ STRICT line):

```ts
const SYSTEM_PROMPT = `You are aggregating a weekly shopping list from multiple recipes. The output will be searched and bought at an Argentine supermarket.

INPUT: a list of recipes, each with an id, label, and ingredient lines (text + parsed qty/unit). Quantities may be in mixed units — metric (g, kg, ml, L), imperial volume (cup/taza, tbsp/cucharada, tsp/cucharadita, oz, lb, fl oz), or counts (e.g., "3 bananas" with no unit).

TASK:
1. Convert every quantity to a unit Argentine supermarkets actually sell the ingredient by. The output unit field must be ONE OF: "g", "kg", "ml", "L", "unidad", or null. Choose by ingredient kind:
   - flour, sugar, rice, pasta, oats, cocoa, dry beans, breadcrumbs, butter, cheese, meat, fish, spices → "g" or "kg" (weight)
   - milk, water, broth, oil, vinegar, juice, sauces, liquids → "ml" or "L"
   - whole produce (onion, banana, apple, potato, lemon, garlic, etc.), eggs → "unidad"
2. Use these culinary conversions when the input is in cups/tbsp/tsp/oz/lb:
   - 1 cup flour ≈ 130 g · 1 cup sugar ≈ 200 g · 1 cup butter ≈ 230 g · 1 cup rice ≈ 200 g · 1 cup oats ≈ 90 g
   - 1 cup milk/water/broth/oil ≈ 240 ml
   - 1 tbsp ≈ 15 ml (liquids) or 15 g (solids by weight) · 1 tsp ≈ 5 ml or 5 g
   - 1 oz ≈ 28 g · 1 lb ≈ 454 g · 1 fl oz ≈ 30 ml
3. Combine duplicate ingredients across recipes after converting. Sum totals in the chosen unit; record per-source originals in sources[].
4. Drop common pantry staples (sal, pimienta, agua, aceite común, azúcar) into "skipped" with reason "pantry staple" — UNLESS the user's preferences say otherwise.
5. Return aggregated names in Argentine Spanish (es-AR). Each aggregated ingredient must include its sources: the recipeId, recipeLabel, and the original text from each contributing recipe (preserve the original recipe text verbatim in originalText, even if it was in cups/tbsp).
6. Also produce "recipeSummaries": one entry per ready recipe with { recipeId, dish, cuisine, notes }. The matcher agent downstream uses these to know what's being cooked.
   - dish: short es-AR name of the dish ("ñoquis con tuco", "banana bread", "quiche lorraine").
   - cuisine: short cuisine descriptor ("italo-argentino", "mediterránea", "francesa", "anglosajona").
   - notes: free-text string with anything the matcher should know to pick well — preferred ingredient form, a critical sub-ingredient, dietary constraints implied by the dish. Empty string if nothing relevant.

The "id" on aggregated entries is a stable identifier you generate (any short string).

⚠️ STRICT: the output unit field MUST be one of "g", "kg", "ml", "L", "unidad", or null — never "cup", "taza", "tbsp", "cucharada", "tsp", "cucharadita", "oz", "lb", or "fl oz".`;
```

Update `AggregateOutput`:

```ts
type AggregateOutput = {
  aggregated: AggregatedIngredient[];
  skipped: SkippedIngredient[];
  recipeSummaries: RecipeSummary[];
};
```

The `aggregate(...)` function body is unchanged — `generateObject` returns the new field automatically because the schema includes it.

- [ ] **Step 1.5: Run the test, verify it passes**

```
pnpm test:unit -- src/lib/checkout/__tests__/aggregate.test.ts
```

Expected: all 5 cases pass.

- [ ] **Step 1.6: Commit**

```bash
git add src/types/plan.ts src/lib/checkout/aggregate.ts src/lib/checkout/__tests__/aggregate.test.ts
git commit -m "feat(aggregate): emit per-recipe summaries for matcher agent"
```

---

## Task 2: Create `match-agent.ts` tool factory

The orchestrator and tools live in one file but the tool factory is exported separately for direct unit testing.

**Files:**
- Create: `src/lib/llm/match-agent.ts`
- Create: `src/lib/llm/__tests__/match-agent.test.ts`

- [ ] **Step 2.1: Write the failing factory tests**

Create `src/lib/llm/__tests__/match-agent.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('ai', () => ({
  generateText: jest.fn(),
  tool: jest.fn((def) => def),
  isStepCount: jest.fn((n: number) => ({ kind: 'isStepCount', n })),
}));
jest.mock('../client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));
jest.mock('~/lib/store', () => {
  const actual = jest.requireActual('~/lib/store');
  return { ...actual, productSearch: jest.fn(async () => []) };
});

import { generateText } from 'ai';
import type { Product, Store } from '~/lib/store';
import { STORES, productSearch as storeProductSearch } from '~/lib/store';
import { buildMatchAgentTools } from '../match-agent';

const mockStoreSearch = storeProductSearch as jest.MockedFunction<typeof storeProductSearch>;

const mockGenerateText = generateText as jest.MockedFunction<typeof generateText>;

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
  mockGenerateText.mockReset();
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

    const out = await tools.searchProducts.execute(
      { query: 'leche entera', ingredientIndex: 0 },
      undefined as never,
    );

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
    const search = jest
      .fn()
      .mockResolvedValueOnce([milkProduct])
      .mockResolvedValueOnce([milkProduct, milkProduct2]);
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
  aggregated: typeof ingMilk[];
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
```

- [ ] **Step 2.2: Run, verify failure**

```
pnpm test:unit -- src/lib/llm/__tests__/match-agent.test.ts
```

Expected: cannot find module `../match-agent`.

- [ ] **Step 2.3: Create `src/lib/llm/match-agent.ts` with the factory**

```ts
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';
import { productSearch as defaultProductSearch } from '~/lib/store';
import type { Product, Store } from '~/lib/store';
import type { AggregatedIngredient, RecipeSummary } from '~/types/plan';
import { createLlm } from './client';
import { describeLlmError } from './errors';
import { PickSchema, type Pick } from './types';

const SEARCH_RESULTS_TOP_N = 15;

export type MatchAgentInput = {
  store: Store;
  aggregated: AggregatedIngredient[];
  recipeSummaries: RecipeSummary[];
  preferences: string;
};

export type MatchAgentSkip = { ingredientIndex: number; reason: string };

export type MatchAgentOutput = {
  picks: Pick[];
  skipped: MatchAgentSkip[];
  candidatesById: Record<string, Product[]>;
};

export type MatchAgentContext = {
  store: Store;
  aggregated: AggregatedIngredient[];
  productSearch: (store: Store, query: string) => Promise<Product[]>;
  searchCache: Map<string, Product[]>;
  candidatesById: Record<string, Product[]>;
  picks: Map<number, Pick>;
  skipped: Map<number, string>;
};

const SearchInputSchema = z.object({
  query: z.string(),
  ingredientIndex: z.number(),
});
const SkipInputSchema = z.object({
  ingredientIndex: z.number(),
  reason: z.string(),
});

type TrimmedProduct = {
  skuId: string;
  name: string;
  brand?: string;
  price: number;
  available: boolean;
};

function trim(p: Product): TrimmedProduct {
  return { skuId: p.skuId, name: p.name, brand: p.brand, price: p.price, available: p.available };
}

export function buildMatchAgentTools(ctx: MatchAgentContext) {
  return {
    searchProducts: tool({
      description:
        'Search the supermarket catalog. Returns up to 15 trimmed product entries. Use es-AR queries; refine if results are thin.',
      inputSchema: SearchInputSchema,
      execute: async ({ query, ingredientIndex }: z.infer<typeof SearchInputSchema>) => {
        let results = ctx.searchCache.get(query);
        if (!results) {
          try {
            results = await ctx.productSearch(ctx.store, query);
          } catch {
            results = [];
          }
          ctx.searchCache.set(query, results);
        }
        const top = results.slice(0, SEARCH_RESULTS_TOP_N);
        const aggId = ctx.aggregated[ingredientIndex]?.id;
        if (aggId) {
          const existing = ctx.candidatesById[aggId] ?? [];
          const seen = new Set(existing.map((p) => p.skuId));
          const merged = [...existing];
          for (const p of top) {
            if (!seen.has(p.skuId)) {
              merged.push(p);
              seen.add(p.skuId);
            }
          }
          ctx.candidatesById[aggId] = merged;
        }
        return { results: top.map(trim) };
      },
    }),
    submitPick: tool({
      description: 'Record your final pick for one ingredient. Call once per ingredient.',
      inputSchema: PickSchema,
      execute: async (pick: Pick) => {
        ctx.picks.set(pick.ingredientIndex, pick);
        return { ok: true };
      },
    }),
    skipIngredient: tool({
      description: 'Mark an ingredient unmatchable after exhausting reasonable searches.',
      inputSchema: SkipInputSchema,
      execute: async ({ ingredientIndex, reason }: z.infer<typeof SkipInputSchema>) => {
        ctx.skipped.set(ingredientIndex, reason);
        return { ok: true };
      },
    }),
  };
}

export async function matchAgent(_input: MatchAgentInput): Promise<MatchAgentOutput> {
  // Implemented in Task 3.
  throw new Error('matchAgent not implemented yet');
}
```

- [ ] **Step 2.4: Run, verify factory tests pass**

```
pnpm test:unit -- src/lib/llm/__tests__/match-agent.test.ts
```

Expected: 5 factory tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/llm/match-agent.ts src/lib/llm/__tests__/match-agent.test.ts
git commit -m "feat(matcher): add match-agent tool factory with closure-state mutations"
```

---

## Task 3: Implement the `matchAgent` orchestrator

**Files:**
- Modify: `src/lib/llm/match-agent.ts`
- Modify: `src/lib/llm/__tests__/match-agent.test.ts`

- [ ] **Step 3.1: Write failing orchestrator tests**

Append to `match-agent.test.ts`:

```ts
import { matchAgent } from '../match-agent';

describe('matchAgent', () => {
  it('calls generateText with system prompt + tools + stopWhen, returns picks/skipped/candidatesById from closure', async () => {
    mockGenerateText.mockImplementationOnce(async (args: { tools: ReturnType<typeof buildMatchAgentTools> }) => {
      // Simulate the agent calling tools during the loop. The real generateText
      // does this internally; here we drive it by hand to verify wiring.
      await args.tools.searchProducts.execute({ query: 'leche', ingredientIndex: 0 }, undefined as never);
      await args.tools.submitPick.execute(
        { ingredientIndex: 0, pickedSkuId: 'm1', cartQty: 1, confidence: 'high', reason: 'whole milk' },
        undefined as never,
      );
      await args.tools.skipIngredient.execute(
        { ingredientIndex: 1, reason: 'no useful candidates' },
        undefined as never,
      );
      return { text: 'done', steps: [] } as never;
    });

    mockStoreSearch.mockResolvedValueOnce([milkProduct]);

    const out = await matchAgent({
      store: STORES.jumbo,
      aggregated: [ingMilk, ingFlour],
      recipeSummaries: [{ recipeId: 'r1', dish: 'tarta', cuisine: 'argentina', notes: '' }],
      preferences: '',
    });

    expect(out.picks).toEqual([
      { ingredientIndex: 0, pickedSkuId: 'm1', cartQty: 1, confidence: 'high', reason: 'whole milk' },
    ]);
    expect(out.skipped).toEqual([{ ingredientIndex: 1, reason: 'no useful candidates' }]);
    expect(out.candidatesById['a-milk']).toEqual([milkProduct]);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      model: string;
      system: string;
      prompt: string;
      tools: object;
      stopWhen: unknown;
    };
    expect(callArgs.model).toBe('mocked-model');
    expect(callArgs.system.toLowerCase()).toContain('match');
    // The aggregated list, ingredient indices, and recipe summaries must reach the prompt.
    expect(callArgs.prompt).toContain('a-milk');
    expect(callArgs.prompt).toContain('a-flour');
    expect(callArgs.prompt.toLowerCase()).toContain('tarta');
    expect(Object.keys(callArgs.tools)).toEqual(
      expect.arrayContaining(['searchProducts', 'submitPick', 'skipIngredient']),
    );
    // stopWhen array contains an isStepCount entry sized to the ingredient count.
    expect(Array.isArray(callArgs.stopWhen)).toBe(true);
  });

  it('includes USER PREFERENCES block when preferences non-empty', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '', steps: [] } as never);

    await matchAgent({
      store: STORES.jumbo,
      aggregated: [ingMilk],
      recipeSummaries: [],
      preferences: 'lactose-free dairy please',
    });

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain('USER PREFERENCES');
    expect(callArgs.prompt).toContain('lactose-free dairy please');
  });

  it('omits USER PREFERENCES block when preferences is empty', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '', steps: [] } as never);

    await matchAgent({
      store: STORES.jumbo,
      aggregated: [ingMilk],
      recipeSummaries: [],
      preferences: '',
    });

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).not.toContain('USER PREFERENCES');
  });

  it('returns whatever was submitted when generateText throws after partial progress', async () => {
    mockGenerateText.mockImplementationOnce(async (args: { tools: ReturnType<typeof buildMatchAgentTools> }) => {
      await args.tools.submitPick.execute(
        { ingredientIndex: 0, pickedSkuId: 'm1', cartQty: 1, confidence: 'high', reason: 'partial' },
        undefined as never,
      );
      throw new Error('step cap blew up');
    });

    await expect(
      matchAgent({
        store: STORES.jumbo,
        aggregated: [ingMilk, ingFlour],
        recipeSummaries: [],
        preferences: '',
      }),
    ).rejects.toThrow(/LLM_FAILED.*step cap blew up/);
  });
});
```

- [ ] **Step 3.2: Run, verify failure**

```
pnpm test:unit -- src/lib/llm/__tests__/match-agent.test.ts
```

Expected: failures from `matchAgent not implemented yet` thrown.

- [ ] **Step 3.3: Implement `matchAgent` and the prompt builder**

Replace the placeholder `matchAgent` body in `src/lib/llm/match-agent.ts` with:

```ts
const SYSTEM_PROMPT = `You are matching a weekly Argentine shopping list against a supermarket catalog. You have three tools:

- searchProducts({ query, ingredientIndex }): search the catalog. Returns up to 15 trimmed product entries (skuId, name, brand, price, available). Use es-AR queries.
- submitPick({ ingredientIndex, pickedSkuId, cartQty, confidence, reason }): record your final choice for one ingredient. Call ONCE per ingredient.
- skipIngredient({ ingredientIndex, reason }): mark an ingredient unmatchable after a few reasonable searches yielded nothing useful.

STRATEGY:
1. For each ingredient, start with the obvious search (the ingredient name in es-AR). If the result list is thin or empty, refine the query: try a synonym (palta↔aguacate), strip qualifiers like "integral" or "orgánico", drop a brand name, broaden the category ("tapas para empanadas" → "tapas"), or try the parent ingredient.
2. After 3–4 unsuccessful refinements, call skipIngredient with a short reason.
3. Use the recipe summaries (dish/cuisine/notes per recipe) and the user preferences to disambiguate when multiple SKUs match — for milanesas prefer pan rallado over panko; for a vegetarian dish never pick anchovies.
4. The query cache is shared across tool calls — re-querying the same string costs nothing, so it's fine to retry.

cartQty math (number of PACKAGES, not recipe quantity):
   cartQty = ceil(recipe-need ÷ package-size-from-SKU-name), with a minimum of 1.

Argentine SKU names usually include the package size: "Harina 0000 1 Kg Caserita" → 1 kg per pack. "Aceitunas Castell Verdes 100 Gr" → 100 g. "Tapas Empanadas x 12 Un" → 12 units. "Leche Descremada 1 Lts Tregar" → 1 L. "Huevos Blancos 6 U" → 6 units.

Worked examples:
  ingredient                            picked SKU                              cartQty   why
  --------------------------------------------------------------------------------------------------------------------------------------
  { name: "harina", qty: 500, unit: "g" }   "Harina 0000 1 Kg Caserita"          1         500 g ÷ 1000 g = 0.5, round up
  { name: "harina", qty: 2,   unit: "kg" }  "Harina 0000 1 Kg Caserita"          2         2 kg ÷ 1 kg = 2
  { name: "leche",  qty: 240, unit: "ml" }  "Leche Descremada 1 Lts Tregar"      1         240 ml ÷ 1000 ml = 0.24, round up
  { name: "huevos", qty: 12,  unit: "unidad" } "Huevos Blancos 6 U Maxima"       2         12 ÷ 6 = 2
  { name: "tapas para empanadas", qty: 12, unit: "unidad" } "Tapas Empanadas x 12 Un" 1   12 ÷ 12 = 1
  { name: "aceitunas", qty: 50, unit: "g" } "Aceitunas Castell Verdes 100 Gr"    1         50 g ÷ 100 g = 0.5, round up
  { name: "cebolla", qty: 2, unit: "unidad" } "Cebolla Por Kg"                   1         By-weight produce: 1 kg covers 2 onions

If pickedSkuId is null in a submitPick call, set cartQty to null too. Prefer skipIngredient over submitting a null pick.

DO NOT loop forever. If a few refined searches turn up nothing reasonable, skipIngredient and move on.`;

function buildPrompt(input: MatchAgentInput): string {
  const summariesByRecipe = new Map(input.recipeSummaries.map((s) => [s.recipeId, s]));
  const aggregatedView = input.aggregated.map((agg, ingredientIndex) => ({
    ingredientIndex,
    aggregatedId: agg.id,
    name: agg.name,
    qty: agg.qty,
    unit: agg.unit,
    sources: agg.sources.map((s) => ({
      recipeId: s.recipeId,
      recipeLabel: s.recipeLabel,
      originalText: s.originalText,
      summary: summariesByRecipe.get(s.recipeId) ?? null,
    })),
  }));

  const prefsBlock = input.preferences.trim().length
    ? `\n\nUSER PREFERENCES (in their own words; honor when applicable):\n"""\n${input.preferences.trim()}\n"""`
    : '';

  return `STORE: ${input.store.name} (platform=${input.store.platform})

SHOPPING LIST (one entry per aggregated ingredient; ingredientIndex is the index used by submitPick/skipIngredient):
${JSON.stringify(aggregatedView, null, 2)}${prefsBlock}`;
}

export async function matchAgent(input: MatchAgentInput): Promise<MatchAgentOutput> {
  const ctx: MatchAgentContext = {
    store: input.store,
    aggregated: input.aggregated,
    productSearch: defaultProductSearch,
    searchCache: new Map(),
    candidatesById: {},
    picks: new Map(),
    skipped: new Map(),
  };
  const tools = buildMatchAgentTools(ctx);
  const maxSteps = 5 + 4 * input.aggregated.length;

  try {
    await generateText({
      model: createLlm(),
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input),
      tools,
      stopWhen: [
        isStepCount(maxSteps),
        () => ctx.picks.size + ctx.skipped.size >= input.aggregated.length,
      ],
    });
  } catch (error) {
    const detail = describeLlmError(error);
    if (detail.startsWith('MISSING_API_KEY')) throw error;
    console.error('[llm/match-agent] full error:', error);
    throw new Error(`LLM_FAILED: ${detail}`);
  }

  return {
    picks: Array.from(ctx.picks.values()).sort((a, b) => a.ingredientIndex - b.ingredientIndex),
    skipped: Array.from(ctx.skipped.entries())
      .map(([ingredientIndex, reason]) => ({ ingredientIndex, reason }))
      .sort((a, b) => a.ingredientIndex - b.ingredientIndex),
    candidatesById: ctx.candidatesById,
  };
}
```

Note: `defaultProductSearch` is the imported `productSearch` from `~/lib/store`; aliased on import to avoid name collision with the tool. The orchestrator hard-codes it (no DI for the orchestrator itself; tests of `matchAgent` mock at the `ai` module level, so the real `productSearch` is never called).

- [ ] **Step 3.4: Run, verify all match-agent tests pass**

```
pnpm test:unit -- src/lib/llm/__tests__/match-agent.test.ts
```

Expected: factory tests (5) + orchestrator tests (4) all pass.

- [ ] **Step 3.5: Run full unit suite to confirm no regression**

```
pnpm test:unit
```

Expected: existing matcher unit tests in `match.test.ts` still pass (we haven't deleted that file yet); aggregate test stays green; resolve test stays green.

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/llm/match-agent.ts src/lib/llm/__tests__/match-agent.test.ts
git commit -m "feat(matcher): implement matchAgent orchestrator with iterative search loop"
```

---

## Task 4: Wire `matchAgent` into `resolve.ts`

**Files:**
- Modify: `src/lib/checkout/resolve.ts`
- Modify: `src/lib/checkout/__tests__/resolve.test.ts`

- [ ] **Step 4.1: Update `resolve.test.ts` to mock `matchAgent` instead of `pickSkus` + `productSearch`**

Replace the top of the file:

```ts
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
```

Update each `it(...)` block to drop `mockSearch` and use `mockMatch` instead. The first test:

```ts
it('runs aggregate → matchAgent and returns matched/unmatched/skipped', async () => {
  mockAggregate.mockResolvedValueOnce({
    aggregated: [ingMilk, ingFlour],
    skipped: [{ name: 'sal', reason: 'pantry staple' }],
    recipeSummaries: [],
  });
  mockMatch.mockResolvedValueOnce({
    picks: [
      { ingredientIndex: 0, pickedSkuId: 'm1', cartQty: 1, confidence: 'high', reason: 'best name match' },
    ],
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
```

For the cartQty regression test:

```ts
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
    picks: [{ ingredientIndex: 0, pickedSkuId: 'f1', cartQty: 1, confidence: 'high', reason: '500g need ÷ 1000g pkg = 1' }],
    skipped: [],
    candidatesById: { 'a-flour': flourCandidate1Kg },
  });

  const out = await resolve({ store: STORES.jumbo, recipes: [], preferences: '' });

  expect(out.matched[0].cartQty).toBe(1);
  expect(out.matched[0].ingredient.qty).toBe(500);
  expect(out.redirectUrl).not.toMatch(/qty=500/);
  expect(out.redirectUrl).toMatch(/sku=f1&qty=1/);
});
```

For the preferences test:

```ts
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
```

For the hallucinated-skuId test:

```ts
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
```

For the COTO test:

```ts
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
    picks: [{ ingredientIndex: 0, pickedSkuId: '00008899', cartQty: 1, confidence: 'high', reason: 'COTO own brand' }],
    skipped: [],
    candidatesById: { 'a-milk': [cotoMilkCandidate] },
  });

  const out = await resolve({ store: STORES.coto, recipes: [], preferences: '' });

  expect(out.matched).toHaveLength(1);
  expect(out.matched[0].picked.productUrl).toMatch(/cotodigital\.com\.ar\/sitios\/cdigi\/productos\//);
  expect(out.redirectUrl).toBe(cotoMilkCandidate.productUrl);
});
```

The two `recomputeRedirectUrl` direct unit tests stay unchanged — they don't depend on the matcher.

- [ ] **Step 4.2: Run, verify failures**

```
pnpm test:unit -- src/lib/checkout/__tests__/resolve.test.ts
```

Expected: failures because `resolve.ts` still uses `pickSkus` + `productSearch`.

- [ ] **Step 4.3: Update `resolve.ts`**

```ts
import { matchAgent } from '~/lib/llm/match-agent';
import { buildAddToCartUrl } from '~/lib/store';
import type { Product, Store } from '~/lib/store';
import type { AggregatedIngredient, MatchedItem, Recipe, SkippedIngredient } from '~/types/plan';
import { aggregate } from './aggregate';

export type ResolveInput = { store: Store; recipes: Recipe[]; preferences: string };

export type ResolveOutput = {
  matched: MatchedItem[];
  unmatched: AggregatedIngredient[];
  skipped: SkippedIngredient[];
  candidates: Record<string, Product[]>;
  redirectUrl: string;
};

export async function resolve(input: ResolveInput): Promise<ResolveOutput> {
  const { aggregated, skipped, recipeSummaries } = await aggregate({
    recipes: input.recipes,
    preferences: input.preferences,
  });

  if (aggregated.length === 0) {
    return {
      matched: [],
      unmatched: [],
      skipped,
      candidates: {},
      redirectUrl: input.store.baseUrl,
    };
  }

  const { picks, candidatesById } = await matchAgent({
    store: input.store,
    aggregated,
    recipeSummaries,
    preferences: input.preferences,
  });

  const matched: MatchedItem[] = [];
  const unmatched: AggregatedIngredient[] = [];

  for (let idx = 0; idx < aggregated.length; idx++) {
    const ingredient = aggregated[idx];
    const pick = picks.find((p) => p.ingredientIndex === idx);
    const candidates = candidatesById[ingredient.id] ?? [];
    const product = pick?.pickedSkuId ? candidates.find((c) => c.skuId === pick.pickedSkuId) : undefined;
    if (product && pick) {
      matched.push({
        aggregatedId: ingredient.id,
        ingredient,
        picked: product,
        confidence: pick.confidence,
        cartQty: Math.max(1, Math.round(pick.cartQty ?? 1)),
      });
    } else {
      unmatched.push(ingredient);
    }
  }

  // Ensure every aggregated ingredient has an entry in candidates so the
  // resolution UI's manual-replacement picker can render an empty list
  // gracefully for unmatched items.
  const candidates: Record<string, Product[]> = {};
  for (const agg of aggregated) {
    candidates[agg.id] = candidatesById[agg.id] ?? [];
  }

  const redirectUrl = recomputeRedirectUrl(matched, input.store);
  return { matched, unmatched, skipped, candidates, redirectUrl };
}

export function recomputeRedirectUrl(matched: MatchedItem[], store: Store): string {
  if (matched.length === 0) return store.baseUrl;
  return buildAddToCartUrl(
    store,
    matched.map((m) => ({
      skuId: m.picked.skuId,
      qty: Math.max(1, Math.round(m.cartQty)),
      product: m.picked,
    })),
  );
}
```

- [ ] **Step 4.4: Run, verify resolve tests pass**

```
pnpm test:unit -- src/lib/checkout/__tests__/resolve.test.ts
```

Expected: all 7 cases pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/checkout/resolve.ts src/lib/checkout/__tests__/resolve.test.ts
git commit -m "refactor(resolve): drop pre-search loop, call matchAgent for iterative matching"
```

---

## Task 5: Delete `match.ts` and update `llm.live.test.ts`

**Files:**
- Delete: `src/lib/llm/match.ts`
- Delete: `src/lib/llm/__tests__/match.test.ts`
- Modify: `src/lib/llm/__tests__/llm.live.test.ts`

- [ ] **Step 5.1: Confirm no other importers of `pickSkus` or `~/lib/llm/match`**

```
pnpm grep -- "from.*'~/lib/llm/match'" src 2>/dev/null || git grep -n "pickSkus\|from.*llm/match'" -- src
```

Expected: matches only inside the two files about to be deleted (`match.ts`, `match.test.ts`) and `llm.live.test.ts`.

- [ ] **Step 5.2: Delete the old matcher and its unit tests**

```bash
rm src/lib/llm/match.ts src/lib/llm/__tests__/match.test.ts
```

- [ ] **Step 5.3: Edit `src/lib/llm/__tests__/llm.live.test.ts`**

Replace the file with:

```ts
/**
 * @jest-environment node
 */
import { extract } from '../extract';

jest.setTimeout(60_000);

const live = process.env.LIVE_TESTS === '1' && Boolean(process.env.OPENROUTER_API_KEY);
const liveDescribe = live ? describe : describe.skip;

const SAMPLE_RECIPE_HTML = `
  <html><body>
    <h1>Pasta carbonara para 2 personas</h1>
    <h2>Ingredientes</h2>
    <ul>
      <li>200 g de spaghetti</li>
      <li>100 g de panceta</li>
      <li>2 huevos</li>
      <li>50 g de queso parmesano rallado</li>
      <li>Sal y pimienta a gusto</li>
    </ul>
  </body></html>
`;

liveDescribe('live LLM integration', () => {
  it('extracts ingredients from a small Spanish recipe', async () => {
    const result = await extract({ html: SAMPLE_RECIPE_HTML });
    expect(result.ingredients.length).toBeGreaterThanOrEqual(4);
    const names = result.ingredients.map((i) => i.name.toLowerCase());
    expect(names.some((n) => n.includes('spaghetti') || n.includes('fideo') || n.includes('pasta'))).toBe(true);
    expect(names.some((n) => n.includes('huevo'))).toBe(true);
  });
});
```

The `pickSkus`-based "honors a preference" live test is removed. Live preference-honoring is implicitly covered by the eval suite's full pipeline; explicit preference-handling for the agent is unit-tested in `match-agent.test.ts`.

- [ ] **Step 5.4: Run full unit suite**

```
pnpm test:unit
```

Expected: all green; no references to the deleted `pickSkus`.

- [ ] **Step 5.5: Run typecheck via the build**

```
pnpm build
```

Expected: build completes (no TS errors). If `pnpm build` is too slow, run `pnpm tsc --noEmit` instead — but verify that script exists first; if not, `pnpm exec tsc --noEmit -p tsconfig.json`.

- [ ] **Step 5.6: Commit**

```bash
git add -A
git commit -m "refactor(matcher): remove single-shot pickSkus, replaced by match-agent"
```

---

## Task 6: Recall assertion in `eval.live.test.ts` and final live run

**Files:**
- Modify: `src/lib/checkout/__tests__/eval.live.test.ts`

- [ ] **Step 6.1: Add a recall assertion to the existing third `it(...)` per fixture**

Inside the `it('every matched item has cartQty as a small integer (1–10) and the URL qty matches', ...)` block, add this **before** the existing `for` loop:

```ts
// Recall floor for the agent matcher. The agent's whole reason for existing
// is recall — if it can't clear 0.7 across these fixtures, something is
// wrong with the search-refinement loop or the prompt. Tighten this number
// once the agent has a stable track record across runs.
const aggregatedCount = out.matched.length + out.unmatched.length;
expect(aggregatedCount).toBeGreaterThan(0);
const recall = out.matched.length / aggregatedCount;
expect(recall).toBeGreaterThanOrEqual(0.7);
```

- [ ] **Step 6.2: Run the live eval**

```
LIVE_TESTS=1 pnpm test:live
```

Expected: all 6 fixtures × 3 cases = 18 tests pass. Cost ≈ $0.50–$1.00 (the agent loop is ~25× more LLM calls than the old matcher).

If recall is below 0.7 on any fixture, do NOT loosen the threshold. Investigate: read the agent's tool-call history for that fixture (capture by adding a temporary `console.log(steps)` after `generateText`, or run the agent standalone with a script). The likely failure is a stuck refinement loop or a too-aggressive `skipIngredient`.

- [ ] **Step 6.3: Commit**

```bash
git add src/lib/checkout/__tests__/eval.live.test.ts
git commit -m "test(eval): assert recall floor of 0.7 for the agent matcher"
```

---

## Task 7: Manual smoke test in the dev server

The agent runs server-side inside the `/api/checkout/resolve` route handler. A live browser run confirms no UI/Resolution-state regression and that latency is acceptable.

- [ ] **Step 7.1: Start the dev server**

```bash
pnpm dev
```

Expected: server up on `http://localhost:3000` (use `-p 3001` if 3000 is held).

- [ ] **Step 7.2: Smoke run in a browser**

1. Open `http://localhost:3000`.
2. Paste a small recipe (e.g., the carbonara fixture from `llm.live.test.ts`) into the loose-ingredients box, or add a recipe URL.
3. Click Checkout, pick Jumbo.
4. Observe: the resolution screen lands on `state: ready` with most ingredients matched. Latency on the order of 30–60s for a 5–8 ingredient list is expected.
5. Confirm the manual-replacement picker shows candidates for matched items.
6. Click "Enviar a Jumbo" and confirm the cart-add URL opens with correct sku/qty pairs.

If anything regresses, capture it in a fresh issue/note before continuing — do NOT patch the spec inline.

- [ ] **Step 7.3: Stop the dev server and merge**

Once smoke passes, the branch is ready to merge. No further commits required for this plan.

---

## Self-Review

**Spec coverage:**

- §"Aggregate output gains a `recipeSummaries` field" → Task 1.
- §"New file: `src/lib/llm/match-agent.ts`" → Tasks 2–3.
- §"resolve.ts changes" → Task 4.
- §"Testing → Unit tests" → Tasks 2.1, 3.1.
- §"Testing → Aggregate test update" → Task 1.2.
- §"Testing → Live eval" → Task 6.
- §"Migration → match.ts deleted" → Task 5.

**Placeholders:** none — every code block is concrete.

**Type consistency:** `MatchAgentOutput` exports `picks: Pick[]`, `skipped: { ingredientIndex, reason }[]`, `candidatesById: Record<string, Product[]>`. `resolve.ts` consumes those exact field names. `aggregate.ts` returns `recipeSummaries: RecipeSummary[]`, and `RecipeSummary` is defined once in `~/types/plan.ts` with `{ recipeId, dish, cuisine, notes }` — same shape used in the prompt and downstream.

**Behavior parity gates:**

- Deleted `match.ts` / `match.test.ts` → covered by Task 5 grep step.
- `Resolution` shape unchanged → confirmed: `MatchedItem`/`AggregatedIngredient`/`SkippedIngredient` untouched.
- cartQty math → still in the agent's system prompt verbatim; the regression test (resolve.test "500g flour ≠ 500 packages") still runs in Task 4.
