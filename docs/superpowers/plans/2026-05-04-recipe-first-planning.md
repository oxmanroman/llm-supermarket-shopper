# Recipe-First Planning (v3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the home page into a plain-text recipe planner; defer all SKU resolution to a `/checkout` flow that aggregates ingredients across recipes via LLM, picks SKUs in the chosen supermarket, and hands off via `window.open` to a new tab.

**Architecture:** Single `Plan` object in `localStorage` (`plan:v3`) holding recipes (each with text-only ingredients), preferences, last store, last resolution. Home page = vertical recipe-card list + composite add-input + sticky checkout bar. `/checkout` = full-page route with a state machine: store-select → aggregate (LLM #1) → search (VTEX) → match (LLM #2) → review/swap → `window.open`. v2's search-and-add UI, cart drawer, store-select modal, and per-store carts are killed; backend primitives (`productSearch`, `buildAddToCartUrl`, AI SDK setup) are kept.

**Tech Stack:** Next.js 15, React 19, MUI v6, TypeScript, Jest, Playwright, pnpm. LLM via OpenRouter + Vercel AI SDK + `anthropic/claude-sonnet-4.6`.

**Spec:** `docs/superpowers/specs/2026-05-04-recipe-first-planning-design.md`

---

## File Map

**New:**
- `src/types/plan.ts` — `Plan`, `Recipe`, `IngredientLine`, `Resolution`, `AggregatedIngredient`, `MatchedItem`, `SkippedIngredient` types + Zod schemas
- `src/lib/storage/plan.ts` — `readPlan` / `writePlan` / `mutatePlan` + v2-key migration on first load
- `src/lib/storage/__tests__/plan.test.ts`
- `src/lib/checkout/aggregate.ts` — LLM #1 (aggregate)
- `src/lib/checkout/__tests__/aggregate.test.ts`
- `src/lib/checkout/resolve.ts` — orchestrator (aggregate + parallel search + match) + URL builder
- `src/lib/checkout/__tests__/resolve.test.ts`
- `src/app/api/recipe/extract/route.ts` — replaces `/api/recipe`
- `src/app/api/checkout/resolve/route.ts` — new
- `src/app/checkout/page.tsx` — full-page route with state machine
- `src/hooks/usePlan.ts` — wraps `lib/storage/plan.ts`
- `src/containers/AddRecipeBar.tsx`
- `src/containers/RecipeCard.tsx`
- `src/containers/IngredientRow.tsx`
- `src/containers/PlanFooter.tsx` — sticky bottom bar
- `src/containers/ProductSearch.tsx` — extracted from `SearchPage` for reuse on resolution screen
- `src/containers/CheckoutStoreSelect.tsx`
- `src/containers/CheckoutLoading.tsx`
- `src/containers/CheckoutResolution.tsx`
- `src/containers/CheckoutHandedOff.tsx`

**Modified:**
- `src/lib/llm/extract.ts` — generalize to accept `{ html?: string; text?: string }`; return `{ label, ingredients, isLoose }`
- `src/lib/llm/__tests__/extract.test.ts` — extend for new shape
- `src/lib/llm/types.ts` — add `ExtractResultSchema` `{ label, ingredients, isLoose }`
- `src/lib/recipe/pipeline.ts` — DELETED (logic moves into `lib/checkout/resolve.ts` with the aggregator)
- `src/containers/Navbar.tsx` — drop cart icon, drop store-switcher; keep gear (preferences) + theme
- `src/containers/index.ts` — replace v2 exports with v3 exports
- `src/hooks/index.ts` — drop `useCart`, `useStore`; add `usePlan`
- `src/app/page.tsx` — wholesale replace with planner
- `src/app/layout.tsx` — title `"Plan de compras"`
- `src/app/layout-content.tsx` — no change beyond removing dead imports if any
- `package.json` — no new deps (use built-in `crypto.randomUUID()`)
- `tests/poc.spec.ts` — drop v2-killed-surface specs; add v3 specs
- `README.md` — v3 section

**Deleted:**
- `src/app/api/recipe/route.ts`
- `src/app/api/checkout/route.ts`
- `src/lib/recipe/pipeline.ts` and its test
- `src/lib/recipe/fetch.ts` — KEEP. Used by `/api/recipe/extract` for the URL path.
- `src/lib/storage/cart.ts` and its tests
- `src/lib/storage/store.ts` and its tests
- `src/hooks/useCart.ts`
- `src/hooks/useStore.ts`
- `src/containers/CartDrawer.tsx`
- `src/containers/SearchPage.tsx`
- `src/containers/RecipeInput.tsx`
- `src/containers/StoreSelectModal.tsx`

The `src/lib/recipe/fetch.ts` file (Jina proxy) is preserved and reused by the new extract endpoint for the URL branch.

---

## Task 1: Plan types + Zod schemas

**Files:**
- Create: `src/types/plan.ts`

- [ ] **Step 1: Implement types**

Create `src/types/plan.ts`:

```ts
import { z } from 'zod';
import type { Product, StoreId } from '~/lib/vtex/types';

export const IngredientLineSchema = z.object({
  id: z.string(),
  text: z.string(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  notes: z.string().optional(),
});
export type IngredientLine = z.infer<typeof IngredientLineSchema>;

const RecipeSourceSchema = z.union([
  z.object({
    kind: z.literal('url'),
    url: z.string(),
    status: z.enum(['extracting', 'ready', 'error']),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('loose') }),
]);

export const RecipeSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: RecipeSourceSchema,
  ingredients: z.array(IngredientLineSchema),
  collapsed: z.boolean().optional(),
  createdAt: z.number(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export type AggregatedIngredient = {
  id: string;
  name: string;
  qty: number | null;
  unit: string | null;
  sources: { recipeId: string; recipeLabel: string; originalText: string }[];
};

export type SkippedIngredient = { name: string; reason: string };

export type MatchedItem = {
  aggregatedId: string;
  ingredient: AggregatedIngredient;
  picked: Product;
  confidence: 'high' | 'medium' | 'low';
};

export type Resolution =
  | { state: 'idle' }
  | { state: 'aggregating'; storeId: StoreId; startedAt: number }
  | { state: 'searching'; storeId: StoreId; aggregated: AggregatedIngredient[] }
  | {
      state: 'matching';
      storeId: StoreId;
      aggregated: AggregatedIngredient[];
      candidates: Record<string, Product[]>; // key: aggregated.id
    }
  | {
      state: 'ready';
      storeId: StoreId;
      matched: MatchedItem[];
      unmatched: AggregatedIngredient[];
      skipped: SkippedIngredient[];
      candidates: Record<string, Product[]>; // key: aggregated.id
      redirectUrl: string;
    }
  | {
      state: 'handed-off';
      storeId: StoreId;
      matched: MatchedItem[];
      redirectUrl: string;
      handedOffAt: number;
    }
  | {
      state: 'error';
      storeId: StoreId;
      failedAt: 'aggregate' | 'search' | 'match';
      message: string;
    };

const StoreIdSchema = z.enum(['jumbo', 'carrefour']);

export const PlanSchema = z.object({
  version: z.literal(3),
  recipes: z.array(RecipeSchema),
  preferences: z.string(),
  lastStoreId: StoreIdSchema.nullable(),
  // Resolution is intentionally not Zod-validated on read — it's complex and we
  // tolerate stale shapes by falling back to `{ state: 'idle' }` if invalid.
  lastResolution: z.unknown().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export function emptyPlan(preferences = ''): Plan {
  return { version: 3, recipes: [], preferences, lastStoreId: null };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm lint
```

Expected: clean. (No tests yet — types only.)

- [ ] **Step 3: Commit**

```bash
git add src/types/plan.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(plan): add Plan/Recipe/Resolution types and schemas"
```

---

## Task 2: Plan storage with v2 migration

**Files:**
- Create: `src/lib/storage/plan.ts`
- Create: `src/lib/storage/__tests__/plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/storage/__tests__/plan.test.ts`:

```ts
/** @jest-environment jsdom */
import { readPlan, writePlan, mutatePlan, KEY } from '../plan';

beforeEach(() => localStorage.clear());

describe('plan storage', () => {
  it('returns an empty plan when nothing is stored and no v2 keys exist', () => {
    const plan = readPlan();
    expect(plan.version).toBe(3);
    expect(plan.recipes).toEqual([]);
    expect(plan.preferences).toBe('');
    expect(plan.lastStoreId).toBeNull();
  });

  it('migrates v2 keys on first read: ports preferences, deletes carts/store', () => {
    localStorage.setItem('preferences', 'prefer lactose-free dairy');
    localStorage.setItem('cart:jumbo', '[{"skuId":"1"}]');
    localStorage.setItem('cart:carrefour', '[{"skuId":"2"}]');
    localStorage.setItem('store', 'jumbo');

    const plan = readPlan();

    expect(plan.preferences).toBe('prefer lactose-free dairy');
    expect(plan.recipes).toEqual([]);
    expect(localStorage.getItem('cart:jumbo')).toBeNull();
    expect(localStorage.getItem('cart:carrefour')).toBeNull();
    expect(localStorage.getItem('store')).toBeNull();
    expect(localStorage.getItem('preferences')).toBeNull();
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('does not re-run migration when plan:v3 already exists', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 3, recipes: [], preferences: 'kept', lastStoreId: 'carrefour' }));
    localStorage.setItem('preferences', 'should-be-ignored');

    const plan = readPlan();

    expect(plan.preferences).toBe('kept');
    expect(plan.lastStoreId).toBe('carrefour');
    expect(localStorage.getItem('preferences')).toBe('should-be-ignored');
  });

  it('round-trips a written plan', () => {
    const plan = {
      version: 3 as const,
      recipes: [
        {
          id: 'r1',
          label: 'Empanadas',
          source: { kind: 'url' as const, url: 'https://e.test', status: 'ready' as const },
          ingredients: [{ id: 'i1', text: 'pollo', qty: 200, unit: 'g' }],
          createdAt: 1,
        },
      ],
      preferences: '',
      lastStoreId: null,
    };
    writePlan(plan);
    expect(readPlan()).toEqual(plan);
  });

  it('mutatePlan applies the function and persists', () => {
    mutatePlan((p) => {
      p.preferences = 'updated';
      return p;
    });
    expect(readPlan().preferences).toBe('updated');
  });

  it('returns an empty plan on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not json');
    const plan = readPlan();
    expect(plan.recipes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test (FAIL — module missing)**

```bash
pnpm test:unit src/lib/storage/__tests__/plan.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/storage/plan.ts`:

```ts
import { emptyPlan, PlanSchema, type Plan } from '~/types/plan';

export const KEY = 'plan:v3';

const V2_KEYS = ['cart:jumbo', 'cart:carrefour', 'store', 'preferences'];

function migrate(): Plan {
  // Port v2 preferences if present, then wipe v2 keys.
  const portedPreferences = localStorage.getItem('preferences') ?? '';
  for (const k of V2_KEYS) localStorage.removeItem(k);
  const plan = emptyPlan(portedPreferences);
  localStorage.setItem(KEY, JSON.stringify(plan));
  return plan;
}

export function readPlan(): Plan {
  if (typeof localStorage === 'undefined') return emptyPlan();
  const raw = localStorage.getItem(KEY);
  if (!raw) return migrate();
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = PlanSchema.safeParse(parsed);
    if (!result.success) return emptyPlan();
    return result.data;
  } catch {
    return emptyPlan();
  }
}

export function writePlan(plan: Plan): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(plan));
}

export function mutatePlan(fn: (plan: Plan) => Plan): Plan {
  const next = fn(readPlan());
  writePlan(next);
  return next;
}
```

- [ ] **Step 4: Run test (PASS — 6 cases)**

```bash
pnpm test:unit src/lib/storage/__tests__/plan.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/plan.ts src/lib/storage/__tests__/plan.test.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(plan): add plan storage with v2 migration"
```

---

## Task 3: usePlan hook

**Files:**
- Create: `src/hooks/usePlan.ts`
- Modify: `src/hooks/index.ts`

- [ ] **Step 1: Implement the hook**

Create `src/hooks/usePlan.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { mutatePlan as mutateStorage, readPlan, writePlan } from '~/lib/storage/plan';
import { emptyPlan, type Plan } from '~/types/plan';

export function usePlan() {
  const [plan, setPlan] = useState<Plan>(emptyPlan());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPlan(readPlan());
    setHydrated(true);
  }, []);

  const update = useCallback((fn: (plan: Plan) => Plan) => {
    setPlan((current) => {
      const next = fn(current);
      writePlan(next);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    setPlan(readPlan());
  }, []);

  // Re-export mutateStorage so non-React code paths can use it too.
  return { plan, hydrated, update, refresh, mutateStorage };
}
```

- [ ] **Step 2: Replace `src/hooks/index.ts`**

Replace contents with:

```ts
export * from './useStateContext';
export * from './usePreferences';
export * from './usePlan';
```

(Drops `useStore`, `useCart` exports. Their files are deleted in Task 9.)

- [ ] **Step 3: Verify it compiles**

```bash
pnpm lint 2>&1 | tail -20
```

Expected: lint passes for the new files; the old `useStore`/`useCart` are still referenced by `page.tsx` and other v2 files until Task 9, so they may still resolve. If `lint` finds a missing-export error, that's expected — proceed; Task 9 fixes it.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePlan.ts src/hooks/index.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(plan): add usePlan hook"
```

---

## Task 4: Generalize extract LLM (URL OR text), update extract endpoint

**Files:**
- Modify: `src/lib/llm/types.ts` (add `ExtractResultSchema`)
- Modify: `src/lib/llm/extract.ts` (accept `{ html?, text? }`, return `{ label, ingredients, isLoose }`)
- Modify: `src/lib/llm/__tests__/extract.test.ts`
- Create: `src/app/api/recipe/extract/route.ts`
- Delete: `src/app/api/recipe/route.ts`

- [ ] **Step 1: Update llm types**

Replace the relevant block in `src/lib/llm/types.ts`. Read the file first to find the right spot. Add this AFTER `ExtractSchema`:

```ts
export const ExtractResultSchema = z.object({
  label: z.string(),
  ingredients: z.array(IngredientSchema),
  isLoose: z.boolean(),
});
export type ExtractResult = z.infer<typeof ExtractResultSchema>;
```

(Keep the existing `IngredientSchema`, `Ingredient`, `ExtractSchema`, `PickSchema`, `Pick`, `MatchSchema` exports.)

- [ ] **Step 2: Update extract test (write failing test)**

Replace `src/lib/llm/__tests__/extract.test.ts` with:

```ts
/**
 * @jest-environment node
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('../client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));

import { generateObject } from 'ai';
import { extract } from '../extract';

const mockGenerate = generateObject as jest.MockedFunction<typeof generateObject>;

beforeEach(() => mockGenerate.mockReset());

describe('extract', () => {
  it('passes html to generateObject and returns the parsed result', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: {
        label: 'Pasta carbonara',
        ingredients: [
          { name: 'spaghetti', qty: 200, unit: 'g' },
          { name: 'huevo', qty: 2, unit: null },
        ],
        isLoose: false,
      },
    } as never);

    const result = await extract({ html: '<html>recipe</html>' });

    expect(result.label).toBe('Pasta carbonara');
    expect(result.ingredients).toHaveLength(2);
    expect(result.isLoose).toBe(false);
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('<html>recipe</html>');
    expect(args.prompt.toLowerCase()).toContain('es-ar');
  });

  it('passes plain text and may set isLoose: true on a short phrase', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: { label: 'yerba', ingredients: [{ name: 'yerba', qty: null, unit: null }], isLoose: true },
    } as never);

    const result = await extract({ text: 'yerba' });

    expect(result.isLoose).toBe(true);
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('yerba');
    expect(args.prompt).not.toContain('<html>');
  });

  it('rejects when neither html nor text is provided', async () => {
    await expect(extract({} as never)).rejects.toThrow(/requires/i);
  });

  it('wraps AI SDK failures as LLM_FAILED', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('rate limit'));
    await expect(extract({ text: 'foo' })).rejects.toThrow(/LLM_FAILED.*rate limit/);
  });
});
```

- [ ] **Step 3: Run test (FAIL — wrong signature)**

```bash
pnpm test:unit src/lib/llm/__tests__/extract.test.ts
```

- [ ] **Step 4: Replace `src/lib/llm/extract.ts`**

Replace its contents with:

```ts
import { generateObject } from 'ai';
import { createLlm } from './client';
import { describeLlmError } from './errors';
import { ExtractResultSchema, type ExtractResult } from './types';

const HTML_PROMPT_PREFIX = `You extract ingredient lists from recipe pages.

INPUT: HTML or cleaned text of a recipe page (any language; typically Spanish or English).

TASK: Return the recipe title (label) and a structured ingredient list in **Argentine Spanish (es-AR)**.

RULES:
- Include every ingredient the recipe lists.
- If the recipe is in another language, translate ingredient names to Argentine Spanish (e.g., "butter" -> "manteca", "avocado" -> "palta", "bell pepper" -> "morrón").
- Quantities: numeric when given (e.g., "2 cucharadas" -> qty: 2, unit: "cucharada"). Use null when not specified or "to taste".
- Do NOT invent or assume ingredients that aren't listed.
- Set isLoose to false for a real recipe page.`;

const TEXT_PROMPT_PREFIX = `You receive free text from a meal planner UI. It can be:
A) a recipe with a title and ingredient list (multi-line, has list structure), OR
B) a single short phrase (≤ 4 words, no list) representing one loose pantry item the user wants to buy.

TASK: Return label + ingredients in **Argentine Spanish (es-AR)**, and set isLoose accordingly.

RULES:
- Case A: label = recipe title (best guess from the text); ingredients = the listed ingredient lines; isLoose = false.
- Case B: label = the input itself (cleaned up); ingredients = a single line representing the item; isLoose = true.
- Translate to Argentine Spanish where appropriate. Quantities numeric when present, null otherwise.`;

export type ExtractInput = { html: string } | { text: string };

export async function extract(input: ExtractInput): Promise<ExtractResult> {
  if (!('html' in input) && !('text' in input)) {
    throw new Error('extract requires either html or text');
  }
  const prompt = 'html' in input
    ? `${HTML_PROMPT_PREFIX}\n\nHTML:\n${input.html}`
    : `${TEXT_PROMPT_PREFIX}\n\nINPUT:\n${input.text}`;

  try {
    const result = await generateObject({
      model: createLlm(),
      schema: ExtractResultSchema,
      prompt,
    });
    return result.object;
  } catch (error) {
    const detail = describeLlmError(error);
    if (detail.startsWith('MISSING_API_KEY')) throw error;
    console.error('[llm/extract] full error:', error);
    throw new Error(`LLM_FAILED: ${detail}`);
  }
}
```

- [ ] **Step 5: Run test (PASS — 4 cases)**

```bash
pnpm test:unit src/lib/llm/__tests__/extract.test.ts
```

- [ ] **Step 6: Create the new endpoint**

Create `src/app/api/recipe/extract/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { extract } from '~/lib/llm/extract';
import { fetchAndCleanHtml } from '~/lib/recipe/fetch';

type Body = { url?: string; text?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!url && !text) {
    return NextResponse.json({ error: 'url or text is required' }, { status: 400 });
  }
  if (url && !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  try {
    if (url) {
      const html = await fetchAndCleanHtml(url);
      const out = await extract({ html });
      return NextResponse.json(out);
    }
    const out = await extract({ text });
    return NextResponse.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[api/recipe/extract]', message);
    if (message.startsWith('FETCH_FAILED')) {
      return NextResponse.json({ error: 'FETCH_FAILED', detail: message }, { status: 502 });
    }
    if (message.startsWith('EMPTY_RECIPE')) {
      return NextResponse.json({ error: 'EMPTY_RECIPE' }, { status: 422 });
    }
    if (message.startsWith('MISSING_API_KEY')) {
      return NextResponse.json({ error: 'MISSING_API_KEY' }, { status: 500 });
    }
    if (message.startsWith('LLM_FAILED')) {
      return NextResponse.json({ error: 'LLM_FAILED', detail: message }, { status: 502 });
    }
    return NextResponse.json({ error: 'UNKNOWN', detail: message }, { status: 500 });
  }
}
```

- [ ] **Step 7: Delete old endpoint and old pipeline**

```bash
rm src/app/api/recipe/route.ts
rm src/lib/recipe/pipeline.ts
rm src/lib/recipe/__tests__/pipeline.test.ts
```

(`pipeline.ts` is no longer used — `runRecipePipeline` was the v2 monolith. Its responsibilities split: URL-fetch+extract becomes `/api/recipe/extract`; aggregate+search+match becomes `/api/checkout/resolve` (Tasks 5–7).)

- [ ] **Step 8: Run all unit tests (some old tests may fail)**

```bash
pnpm test:unit 2>&1 | tail -20
```

Expected: extract tests pass; the old pipeline test is gone; storage/preferences/cart/etc. still pass. If any other test in the repo references `runRecipePipeline` or `/api/recipe`, that test must also be updated/deleted in this commit. Search:

```bash
grep -rn 'runRecipePipeline\|/api/recipe[^/]\|extractIngredients' src tests
```

If matches turn up in tests, fix them so the test suite stays green. (Common path: `tests/poc.spec.ts` mocks `/api/recipe`; that's fine if matched as a path-prefix `**/api/**`. Verify.)

- [ ] **Step 9: Commit**

```bash
git add -A
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(extract): generalize LLM extract to URL or text; add /api/recipe/extract; drop /api/recipe + pipeline"
```

---

## Task 5: Aggregate LLM (LLM #1)

**Files:**
- Create: `src/lib/checkout/aggregate.ts`
- Create: `src/lib/checkout/__tests__/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/checkout/__tests__/aggregate.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('~/lib/llm/client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));

import { generateObject } from 'ai';
import { aggregate } from '../aggregate';

const mockGenerate = generateObject as jest.MockedFunction<typeof generateObject>;

beforeEach(() => mockGenerate.mockReset());

const empanadas = {
  id: 'r1',
  label: 'Empanadas de pollo',
  source: { kind: 'url' as const, url: 'x', status: 'ready' as const },
  ingredients: [
    { id: 'i1', text: '1 cebolla', qty: 1, unit: null },
    { id: 'i2', text: '200 g pollo', qty: 200, unit: 'g' },
    { id: 'i3', text: 'sal a gusto', qty: null, unit: null },
  ],
  createdAt: 1,
};
const tarta = {
  id: 'r2',
  label: 'Tarta de espinaca',
  source: { kind: 'manual' as const },
  ingredients: [
    { id: 'i4', text: '1 cebolla', qty: 1, unit: null },
    { id: 'i5', text: '1 paquete de espinaca', qty: 1, unit: 'paquete' },
  ],
  createdAt: 2,
};

describe('aggregate', () => {
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
      },
    } as never);

    const result = await aggregate({ recipes: [empanadas, tarta], preferences: '' });

    expect(result.aggregated).toHaveLength(3);
    expect(result.skipped).toHaveLength(1);
    expect(result.aggregated[0].sources).toHaveLength(2);
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('Empanadas de pollo');
    expect(args.prompt).toContain('Tarta de espinaca');
    expect(args.prompt.toLowerCase()).toContain('skipped');
  });

  it('includes preferences block in the prompt when non-empty', async () => {
    mockGenerate.mockResolvedValueOnce({ object: { aggregated: [], skipped: [] } } as never);
    await aggregate({ recipes: [empanadas], preferences: 'siempre comprar sal' });
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('USER PREFERENCES');
    expect(args.prompt).toContain('siempre comprar sal');
  });

  it('omits preferences block when empty', async () => {
    mockGenerate.mockResolvedValueOnce({ object: { aggregated: [], skipped: [] } } as never);
    await aggregate({ recipes: [empanadas], preferences: '' });
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt.toLowerCase()).not.toContain('user preferences');
  });

  it('wraps AI SDK failures as LLM_FAILED', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('boom'));
    await expect(aggregate({ recipes: [empanadas], preferences: '' })).rejects.toThrow(/LLM_FAILED.*boom/);
  });

  it('skips recipes with source.status !== "ready"', async () => {
    mockGenerate.mockResolvedValueOnce({ object: { aggregated: [], skipped: [] } } as never);
    const errored = {
      ...empanadas,
      id: 'r3',
      source: { kind: 'url' as const, url: 'x', status: 'error' as const, error: 'boom' },
    };
    await aggregate({ recipes: [empanadas, errored], preferences: '' });
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    // Errored recipe label MUST NOT appear in the prompt.
    expect(args.prompt).not.toContain(errored.id);
    expect(args.prompt).toContain(empanadas.id);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
pnpm test:unit src/lib/checkout/__tests__/aggregate.test.ts
```

- [ ] **Step 3: Implement aggregate**

Create `src/lib/checkout/aggregate.ts`:

```ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { createLlm } from '~/lib/llm/client';
import { describeLlmError } from '~/lib/llm/errors';
import type { AggregatedIngredient, Recipe, SkippedIngredient } from '~/types/plan';

const AggregatedSchema = z.object({
  id: z.string(),
  name: z.string(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  sources: z.array(
    z.object({ recipeId: z.string(), recipeLabel: z.string(), originalText: z.string() }),
  ),
});
const SkippedSchema = z.object({ name: z.string(), reason: z.string() });
const AggregateOutputSchema = z.object({
  aggregated: z.array(AggregatedSchema),
  skipped: z.array(SkippedSchema),
});

const SYSTEM_PROMPT = `You are aggregating a weekly shopping list from multiple recipes.

INPUT: a list of recipes, each with an id, label, and ingredient lines (text + parsed qty/unit).

TASK:
1. Combine duplicate ingredients across recipes. Sum quantities when units match. When units differ, pick a sensible total quantity in a single common unit; record both originals in the sources[] entries.
2. Drop common pantry staples (sal, pimienta, agua, aceite común, azúcar) into a "skipped" list with reason "pantry staple" — UNLESS the user's preferences say otherwise.
3. Return aggregated names and reasons in Argentine Spanish (es-AR).
4. Each aggregated ingredient must include its sources: the recipeId, recipeLabel, and the original text from each contributing recipe.

The "id" on aggregated entries is a stable identifier you generate (any short string).`;

type AggregateInput = { recipes: Recipe[]; preferences: string };

type AggregateOutput = {
  aggregated: AggregatedIngredient[];
  skipped: SkippedIngredient[];
};

export async function aggregate(input: AggregateInput): Promise<AggregateOutput> {
  const ready = input.recipes.filter((r) => r.source.kind !== 'url' || r.source.status === 'ready');
  const payload = ready.map((r) => ({
    id: r.id,
    label: r.label,
    ingredients: r.ingredients.map(({ id, text, qty, unit, notes }) => ({ id, text, qty, unit, notes })),
  }));

  const prefsBlock = input.preferences.trim().length
    ? `\n\nUSER PREFERENCES (in their own words; honor when applicable):\n"""\n${input.preferences.trim()}\n"""`
    : '';

  const prompt = `${SYSTEM_PROMPT}${prefsBlock}\n\nRECIPES:\n${JSON.stringify(payload, null, 2)}`;

  try {
    const result = await generateObject({
      model: createLlm(),
      schema: AggregateOutputSchema,
      prompt,
    });
    return result.object;
  } catch (error) {
    const detail = describeLlmError(error);
    if (detail.startsWith('MISSING_API_KEY')) throw error;
    console.error('[checkout/aggregate] full error:', error);
    throw new Error(`LLM_FAILED: ${detail}`);
  }
}
```

- [ ] **Step 4: Run test (PASS — 5 cases)**

```bash
pnpm test:unit src/lib/checkout/__tests__/aggregate.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/checkout/aggregate.ts src/lib/checkout/__tests__/aggregate.test.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(checkout): add aggregate LLM step"
```

---

## Task 6: Resolve orchestrator

**Files:**
- Create: `src/lib/checkout/resolve.ts`
- Create: `src/lib/checkout/__tests__/resolve.test.ts`

The resolve function returns a `ready` Resolution payload directly (no streaming progress). The orchestrator is `aggregate → parallel productSearch per aggregated → pickSkus (existing) → build redirect URL`. We also expose a small helper `recomputeRedirectUrl(matched, store)` that the resolution screen calls after each mutation.

- [ ] **Step 1: Write failing test**

Create `src/lib/checkout/__tests__/resolve.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('../aggregate', () => ({ aggregate: jest.fn() }));
jest.mock('~/lib/llm/match', () => ({ pickSkus: jest.fn() }));
jest.mock('~/lib/vtex/search', () => ({ productSearch: jest.fn() }));

import { aggregate } from '../aggregate';
import { pickSkus } from '~/lib/llm/match';
import { productSearch } from '~/lib/vtex/search';
import { recomputeRedirectUrl, resolve } from '../resolve';
import { STORES } from '~/lib/vtex/stores';

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
    expect(mockAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ preferences: 'lactose-free' }),
    );
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
```

- [ ] **Step 2: Run test (FAIL)**

```bash
pnpm test:unit src/lib/checkout/__tests__/resolve.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/checkout/resolve.ts`:

```ts
import { buildAddToCartUrl } from '~/lib/vtex/cart';
import { pickSkus } from '~/lib/llm/match';
import { productSearch } from '~/lib/vtex/search';
import type { Product, Store } from '~/lib/vtex/types';
import type {
  AggregatedIngredient,
  MatchedItem,
  Recipe,
  SkippedIngredient,
} from '~/types/plan';
import { aggregate } from './aggregate';

export type ResolveInput = { store: Store; recipes: Recipe[]; preferences: string };

export type ResolveOutput = {
  matched: MatchedItem[];
  unmatched: AggregatedIngredient[];
  skipped: SkippedIngredient[];
  candidates: Record<string, Product[]>; // key: aggregated.id
  redirectUrl: string;
};

export async function resolve(input: ResolveInput): Promise<ResolveOutput> {
  const { aggregated, skipped } = await aggregate({
    recipes: input.recipes,
    preferences: input.preferences,
  });

  const candidatesArr: Product[][] = await Promise.all(
    aggregated.map((agg) => productSearch(input.store, agg.name).catch(() => [])),
  );
  const candidates: Record<string, Product[]> = Object.fromEntries(
    aggregated.map((agg, i) => [agg.id, candidatesArr[i]]),
  );

  const picks = aggregated.length === 0
    ? []
    : await pickSkus({
        ingredients: aggregated.map((a) => ({ name: a.name, qty: a.qty, unit: a.unit })),
        candidates: candidatesArr,
        preferences: input.preferences,
      });

  const matched: MatchedItem[] = [];
  const unmatched: AggregatedIngredient[] = [];

  for (let idx = 0; idx < aggregated.length; idx++) {
    const ingredient = aggregated[idx];
    const pick = picks.find((p) => p.ingredientIndex === idx);
    const product = pick?.pickedSkuId
      ? candidatesArr[idx]?.find((c) => c.skuId === pick.pickedSkuId)
      : undefined;
    if (product && pick) {
      matched.push({
        aggregatedId: ingredient.id,
        ingredient,
        picked: product,
        confidence: pick.confidence,
      });
    } else {
      unmatched.push(ingredient);
    }
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
      qty: Math.max(1, Math.round(m.ingredient.qty ?? 1)),
    })),
  );
}
```

- [ ] **Step 4: Run test (PASS — 4 cases)**

```bash
pnpm test:unit src/lib/checkout/__tests__/resolve.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/checkout/resolve.ts src/lib/checkout/__tests__/resolve.test.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(checkout): add resolve orchestrator (aggregate + search + match + URL build)"
```

---

## Task 7: POST /api/checkout/resolve route

**Files:**
- Create: `src/app/api/checkout/resolve/route.ts`
- Delete: `src/app/api/checkout/route.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/checkout/resolve/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { resolve } from '~/lib/checkout/resolve';
import { STORES, isStoreId } from '~/lib/vtex/stores';
import { RecipeSchema } from '~/types/plan';
import { z } from 'zod';

const BodySchema = z.object({
  store: z.string(),
  recipes: z.array(RecipeSchema),
  preferences: z.string(),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', detail: parsed.error.issues }, { status: 400 });
  }
  if (!isStoreId(parsed.data.store)) {
    return NextResponse.json({ error: 'invalid store' }, { status: 400 });
  }

  try {
    const result = await resolve({
      store: STORES[parsed.data.store],
      recipes: parsed.data.recipes,
      preferences: parsed.data.preferences,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[api/checkout/resolve]', message);
    if (message.startsWith('MISSING_API_KEY')) {
      return NextResponse.json({ error: 'MISSING_API_KEY' }, { status: 500 });
    }
    if (message.startsWith('LLM_FAILED')) {
      return NextResponse.json({ error: 'LLM_FAILED', detail: message }, { status: 502 });
    }
    return NextResponse.json({ error: 'UNKNOWN', detail: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Delete the old `/api/checkout` route**

```bash
rm src/app/api/checkout/route.ts
```

- [ ] **Step 3: Smoke-test validation paths**

```bash
pnpm dev > /tmp/devsrv.log 2>&1 &
DEV_PID=$!
sleep 8

curl -s -w '\nstatus=%{http_code}\n' -X POST -H 'Content-Type: application/json' -d 'not json' \
  http://localhost:3000/api/checkout/resolve
# expect: status=400 {"error":"invalid json"}

curl -s -w '\nstatus=%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"store":"foo","recipes":[],"preferences":""}' \
  http://localhost:3000/api/checkout/resolve
# expect: status=400 {"error":"invalid store"}

# /api/checkout (the old route) should now 404:
curl -s -w '\nstatus=%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{}' http://localhost:3000/api/checkout
# expect: status=404

kill $DEV_PID 2>/dev/null
wait 2>/dev/null
```

- [ ] **Step 4: Commit**

```bash
git add -A
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(api): add POST /api/checkout/resolve; drop /api/checkout"
```

---

## Task 8: ProductSearch component (extracted reusable)

**Files:**
- Create: `src/containers/ProductSearch.tsx`

The current `SearchPage.tsx` mixes "search input + results grid" with "add-to-cart" callbacks. We extract the search-and-pick logic into a smaller, prop-driven `ProductSearch` and let `CheckoutResolution.tsx` (Task 12) use it. `SearchPage` itself is deleted in Task 9.

- [ ] **Step 1: Implement**

Create `src/containers/ProductSearch.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import type { Product, StoreId } from '~/lib/vtex/types';

type Props = {
  storeId: StoreId;
  initialQuery?: string;
  pickLabel?: string;
  onPick: (product: Product) => void;
};

export const ProductSearch = ({ storeId, initialQuery = '', pickLabel = 'Usar este', onPick }: Props) => {
  const [query, setQuery] = useState(initialQuery);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?store=${storeId}&q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { products: Product[] };
      setProducts(body.products);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box component='form' onSubmit={search} sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <TextField
          size='small'
          fullWidth
          placeholder='Buscar producto…'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputProps={{ 'data-testid': 'product-search-input' }}
        />
        <Button type='submit' size='small' variant='outlined' disabled={!query.trim() || loading}>
          {loading ? <CircularProgress size={16} /> : 'Buscar'}
        </Button>
      </Box>
      {error && <Alert severity='error' sx={{ mb: 1 }}>{error}</Alert>}
      {products.length === 0 && !loading && !error && (
        <Typography variant='caption' color='text.secondary'>
          Escribí algo y presioná Buscar.
        </Typography>
      )}
      <List dense>
        {products.map((p) => (
          <ListItem
            key={p.skuId}
            secondaryAction={
              <Button
                size='small'
                variant='contained'
                onClick={() => onPick(p)}
                data-testid={`pick-${p.skuId}`}
              >
                {pickLabel}
              </Button>
            }
          >
            <ListItemButton sx={{ pr: 12 }}>
              <ListItemText
                primary={p.name}
                secondary={`$${p.price.toLocaleString('es-AR')}`}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};
```

- [ ] **Step 2: Verify it lints**

```bash
pnpm lint 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/containers/ProductSearch.tsx
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(ui): add reusable ProductSearch component"
```

---

## Task 9: Planner UI (AddRecipeBar, RecipeCard, IngredientRow, PlanFooter) + replace home page + kill v2 surfaces

**Files:**
- Create: `src/containers/AddRecipeBar.tsx`
- Create: `src/containers/RecipeCard.tsx`
- Create: `src/containers/IngredientRow.tsx`
- Create: `src/containers/PlanFooter.tsx`
- Modify: `src/app/page.tsx` (replace wholesale)
- Modify: `src/app/layout.tsx` (title change)
- Modify: `src/containers/Navbar.tsx` (drop cart icon + store-switcher; keep gear + theme)
- Modify: `src/containers/index.ts` (replace exports)
- Delete: `src/containers/CartDrawer.tsx`, `SearchPage.tsx`, `RecipeInput.tsx`, `StoreSelectModal.tsx`
- Delete: `src/hooks/useCart.ts`, `src/hooks/useStore.ts`
- Delete: `src/lib/storage/cart.ts`, `src/lib/storage/__tests__/storage.test.ts` (the cart+store tests; preferences test stays)
- Delete: `src/lib/storage/store.ts`

This is a large, atomic task — the codebase doesn't compile in between, so it MUST land as one commit.

- [ ] **Step 1: Create AddRecipeBar**

Create `src/containers/AddRecipeBar.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Box, Button, CircularProgress, TextField } from '@mui/material';

type Props = {
  onSubmit: (input: { url: string } | { text: string }) => Promise<void>;
};

const URL_RE = /^https?:\/\/\S+$/i;

export const AddRecipeBar = ({ onSubmit }: Props) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const handle = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const input = URL_RE.test(trimmed) ? { url: trimmed } : { text: trimmed };
      await onSubmit(input);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component='form' onSubmit={handle} sx={{ display: 'flex', gap: 1, mb: 3 }}>
      <TextField
        fullWidth
        multiline
        maxRows={6}
        placeholder='Pegá una URL de receta o escribí lo que querés cocinar'
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputProps={{ 'data-testid': 'add-input' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !value.includes('\n')) {
            void handle(e);
          }
        }}
      />
      <Button
        type='submit'
        variant='contained'
        disabled={!value.trim() || busy}
        startIcon={busy ? <CircularProgress size={16} color='inherit' /> : undefined}
        data-testid='add-submit'
      >
        Agregar
      </Button>
    </Box>
  );
};
```

- [ ] **Step 2: Create IngredientRow**

Create `src/containers/IngredientRow.tsx`:

```tsx
'use client';

import { useState } from 'react';
import DeleteIcon from '@mui/icons-material/Delete';
import { Box, Chip, IconButton, TextField, Typography } from '@mui/material';
import type { IngredientLine } from '~/types/plan';

type Props = {
  line: IngredientLine;
  onChange: (next: IngredientLine) => void;
  onRemove: () => void;
};

export const IngredientRow = ({ line, onChange, onRemove }: Props) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text);
  const qtyLabel = line.qty != null ? `${line.qty}${line.unit ? ' ' + line.unit : ''}` : line.unit ?? '';

  const commit = () => {
    const next = draft.trim();
    if (next && next !== line.text) onChange({ ...line, text: next });
    setEditing(false);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }} data-testid={`ingredient-${line.id}`}>
      {editing ? (
        <TextField
          size='small'
          fullWidth
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(line.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <Typography
          variant='body2'
          sx={{ flexGrow: 1, cursor: 'text' }}
          onClick={() => setEditing(true)}
        >
          {line.text}
        </Typography>
      )}
      {qtyLabel && <Chip size='small' label={qtyLabel} />}
      <IconButton size='small' onClick={onRemove} aria-label='Quitar ingrediente'>
        <DeleteIcon fontSize='small' />
      </IconButton>
    </Box>
  );
};
```

- [ ] **Step 3: Create RecipeCard**

Create `src/containers/RecipeCard.tsx`:

```tsx
'use client';

import { useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LinkIcon from '@mui/icons-material/Link';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { IngredientLine, Recipe } from '~/types/plan';
import { IngredientRow } from './IngredientRow';

type Props = {
  recipe: Recipe;
  onRename: (label: string) => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  onAddIngredient: (text: string) => void;
  onChangeIngredient: (line: IngredientLine) => void;
  onRemoveIngredient: (id: string) => void;
  onRetryUrl?: () => void;
};

export const RecipeCard = ({
  recipe,
  onRename,
  onRemove,
  onToggleCollapse,
  onAddIngredient,
  onChangeIngredient,
  onRemoveIngredient,
  onRetryUrl,
}: Props) => {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(recipe.label);
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const [newIngredient, setNewIngredient] = useState('');

  const isLoose = recipe.source.kind === 'loose';
  const isError = recipe.source.kind === 'url' && recipe.source.status === 'error';
  const isExtracting = recipe.source.kind === 'url' && recipe.source.status === 'extracting';

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== recipe.label) onRename(next);
    setEditingTitle(false);
  };

  const addIngredient = (event: React.FormEvent) => {
    event.preventDefault();
    const text = newIngredient.trim();
    if (!text) return;
    onAddIngredient(text);
    setNewIngredient('');
  };

  return (
    <Card variant='outlined' sx={{ mb: 2 }} data-testid={`recipe-${recipe.id}`}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          {editingTitle ? (
            <TextField
              size='small'
              fullWidth
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                if (e.key === 'Escape') {
                  setTitleDraft(recipe.label);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <Typography
              variant='subtitle1'
              sx={{ flexGrow: 1, cursor: isLoose ? 'default' : 'text', fontWeight: 500 }}
              onClick={() => !isLoose && setEditingTitle(true)}
            >
              {isExtracting ? 'Cargando…' : recipe.label}
            </Typography>
          )}
          {recipe.source.kind === 'url' && !isExtracting && (
            <IconButton
              size='small'
              component='a'
              href={recipe.source.url}
              target='_blank'
              rel='noopener'
              aria-label='Abrir receta'
            >
              <LinkIcon fontSize='small' />
            </IconButton>
          )}
          <IconButton
            size='small'
            onClick={onToggleCollapse}
            aria-label={recipe.collapsed ? 'Expandir' : 'Colapsar'}
          >
            {recipe.collapsed ? <ExpandMoreIcon fontSize='small' /> : <ExpandLessIcon fontSize='small' />}
          </IconButton>
          {!isLoose && (
            <>
              <IconButton size='small' onClick={(e) => setMenuEl(e.currentTarget)} aria-label='Más acciones'>
                <MoreVertIcon fontSize='small' />
              </IconButton>
              <Menu open={Boolean(menuEl)} anchorEl={menuEl} onClose={() => setMenuEl(null)}>
                <MenuItem onClick={() => { setMenuEl(null); setEditingTitle(true); }}>Renombrar</MenuItem>
                <MenuItem onClick={() => { setMenuEl(null); onRemove(); }}>Quitar</MenuItem>
              </Menu>
            </>
          )}
        </Box>

        {isExtracting && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <CircularProgress size={16} />
            <Typography variant='caption' color='text.secondary'>
              Extrayendo ingredientes…
            </Typography>
          </Box>
        )}

        {isError && (
          <Alert severity='error' sx={{ mb: 1 }}>
            {recipe.source.kind === 'url' && recipe.source.error ? recipe.source.error : 'Falló la extracción'}
            {onRetryUrl && (
              <IconButton size='small' onClick={onRetryUrl} sx={{ ml: 1 }}>
                Reintentar
              </IconButton>
            )}
          </Alert>
        )}

        {!recipe.collapsed && (
          <Stack>
            {recipe.ingredients.map((line) => (
              <IngredientRow
                key={line.id}
                line={line}
                onChange={onChangeIngredient}
                onRemove={() => onRemoveIngredient(line.id)}
              />
            ))}
            <Box component='form' onSubmit={addIngredient} sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <TextField
                size='small'
                fullWidth
                placeholder='+ Agregar ingrediente'
                value={newIngredient}
                onChange={(e) => setNewIngredient(e.target.value)}
                inputProps={{ 'data-testid': `add-ingredient-${recipe.id}` }}
              />
              <IconButton type='submit' size='small' disabled={!newIngredient.trim()}>
                <AddIcon fontSize='small' />
              </IconButton>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 4: Create PlanFooter**

Create `src/containers/PlanFooter.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { Box, Button, Typography } from '@mui/material';

type Props = {
  ingredientCount: number;
  recipeCount: number;
};

export const PlanFooter = ({ ingredientCount, recipeCount }: Props) => {
  const router = useRouter();
  const disabled = ingredientCount === 0;

  return (
    <Box
      sx={{
        position: 'sticky',
        bottom: 0,
        backgroundColor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        py: 1.5,
        px: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
      }}
    >
      <Typography variant='body2' color='text.secondary'>
        {ingredientCount} ingredientes · {recipeCount} recetas
      </Typography>
      <Button
        variant='contained'
        onClick={() => router.push('/checkout')}
        disabled={disabled}
        data-testid='checkout-button'
      >
        Checkout
      </Button>
    </Box>
  );
};
```

- [ ] **Step 5: Replace `src/containers/Navbar.tsx`**

```tsx
'use client';

import { useState } from 'react';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsIcon from '@mui/icons-material/Settings';
import { AppBar, Badge, IconButton, Toolbar, Typography } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { PreferencesDialog } from '~/containers/PreferencesDialog';
import { usePreferences } from '~/hooks/usePreferences';

export const Navbar = () => {
  const { mode, setMode } = useColorScheme();
  const { prefs, setPrefs } = usePreferences();
  const [prefsOpen, setPrefsOpen] = useState(false);

  const toggleTheme = () => setMode(mode === 'dark' ? 'light' : 'dark');

  return (
    <>
      <AppBar position='static' color='default' elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <Typography variant='h6' sx={{ flexGrow: 1 }}>
            Plan de compras
          </Typography>
          <IconButton
            onClick={() => setPrefsOpen(true)}
            data-testid='open-preferences-button'
            aria-label='Open preferences'
          >
            <Badge color='primary' variant='dot' invisible={prefs.length === 0}>
              <SettingsIcon />
            </Badge>
          </IconButton>
          <IconButton onClick={toggleTheme} aria-label='Toggle theme'>
            {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        </Toolbar>
      </AppBar>
      <PreferencesDialog
        open={prefsOpen}
        initialValue={prefs}
        onSave={setPrefs}
        onClose={() => setPrefsOpen(false)}
      />
    </>
  );
};
```

- [ ] **Step 6: Replace `src/containers/index.ts`**

```ts
export * from './AddRecipeBar';
export * from './CheckoutHandedOff';
export * from './CheckoutLoading';
export * from './CheckoutResolution';
export * from './CheckoutStoreSelect';
export * from './Footer';
export * from './IngredientRow';
export * from './Navbar';
export * from './PlanFooter';
export * from './PreferencesDialog';
export * from './ProductSearch';
export * from './RecipeCard';
```

(The four `Checkout*.tsx` files are created in Tasks 10–13 — they don't exist yet, so this index will fail to compile until the checkout tasks land. Acceptable: this whole block of v2-killing changes lands as one big commit at the end of this Task.)

To make the build pass at the end of THIS task without the Checkout files yet existing, write *placeholder* exports right now: create stub Checkout files that just export named no-op components. Each is a single file with the right export name and a placeholder body. You will overwrite them in Tasks 10–13.

Create the four placeholder files:

```tsx
// src/containers/CheckoutStoreSelect.tsx
'use client';
export const CheckoutStoreSelect = () => null;
```

```tsx
// src/containers/CheckoutLoading.tsx
'use client';
export const CheckoutLoading = () => null;
```

```tsx
// src/containers/CheckoutResolution.tsx
'use client';
export const CheckoutResolution = () => null;
```

```tsx
// src/containers/CheckoutHandedOff.tsx
'use client';
export const CheckoutHandedOff = () => null;
```

- [ ] **Step 7: Replace `src/app/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Alert, Box, Container, Snackbar, Typography } from '@mui/material';
import { AddRecipeBar, Navbar, PlanFooter, RecipeCard } from '~/containers';
import { usePlan } from '~/hooks';
import type { IngredientLine, Recipe } from '~/types/plan';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

type SnackState = { severity: 'success' | 'error' | 'info'; message: string; undo?: () => void } | null;

export default function Home() {
  const { plan, hydrated, update } = usePlan();
  const [snack, setSnack] = useState<SnackState>(null);

  if (!hydrated) return null;

  const handleAdd = async (input: { url: string } | { text: string }) => {
    const id = newId();
    if ('url' in input) {
      // Duplicate detection.
      if (plan.recipes.some((r) => r.source.kind === 'url' && r.source.url === input.url)) {
        setSnack({ severity: 'info', message: 'Ya agregada' });
        return;
      }
      const placeholder: Recipe = {
        id, label: 'Cargando…',
        source: { kind: 'url', url: input.url, status: 'extracting' },
        ingredients: [], createdAt: now(),
      };
      update((p) => ({ ...p, recipes: [...p.recipes, placeholder] }));
      try {
        const res = await fetch('/api/recipe/extract', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: input.url }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        update((p) => ({
          ...p,
          recipes: p.recipes.map((r) => r.id === id ? {
            ...r, label: body.label,
            source: { kind: 'url', url: input.url, status: 'ready' },
            ingredients: (body.ingredients as { name: string; qty: number | null; unit: string | null; notes?: string }[])
              .map((i) => ({ id: newId(), text: i.name, qty: i.qty, unit: i.unit, notes: i.notes })),
          } : r),
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'extract failed';
        update((p) => ({
          ...p,
          recipes: p.recipes.map((r) => r.id === id ? {
            ...r, source: { kind: 'url', url: input.url, status: 'error', error: msg },
          } : r),
        }));
      }
      return;
    }

    // Text path.
    const placeholderId = newId();
    const placeholder: Recipe = {
      id: placeholderId, label: 'Procesando…', source: { kind: 'manual' },
      ingredients: [], createdAt: now(),
    };
    update((p) => ({ ...p, recipes: [...p.recipes, placeholder] }));
    try {
      const res = await fetch('/api/recipe/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const ingredients: IngredientLine[] = (body.ingredients as { name: string; qty: number | null; unit: string | null; notes?: string }[])
        .map((i) => ({ id: newId(), text: i.name, qty: i.qty, unit: i.unit, notes: i.notes }));
      if (body.isLoose) {
        update((p) => {
          const recipes = p.recipes.filter((r) => r.id !== placeholderId);
          const looseIdx = recipes.findIndex((r) => r.source.kind === 'loose');
          if (looseIdx === -1) {
            recipes.push({
              id: newId(), label: 'Otros', source: { kind: 'loose' },
              ingredients, createdAt: now(),
            });
          } else {
            recipes[looseIdx] = { ...recipes[looseIdx], ingredients: [...recipes[looseIdx].ingredients, ...ingredients] };
          }
          return { ...p, recipes };
        });
      } else {
        update((p) => ({
          ...p,
          recipes: p.recipes.map((r) => r.id === placeholderId ? { ...r, label: body.label, ingredients } : r),
        }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'extract failed';
      setSnack({ severity: 'error', message: msg });
      update((p) => ({ ...p, recipes: p.recipes.filter((r) => r.id !== placeholderId) }));
    }
  };

  const removeRecipe = (id: string) => {
    const idx = plan.recipes.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const recipe = plan.recipes[idx];
    update((p) => ({ ...p, recipes: p.recipes.filter((r) => r.id !== id) }));
    setSnack({
      severity: 'info', message: `"${recipe.label}" eliminada`,
      undo: () => {
        update((p) => {
          if (p.recipes.some((r) => r.id === recipe.id)) return p;
          const recipes = [...p.recipes];
          const insertIdx = Math.min(idx, recipes.length);
          recipes.splice(insertIdx, 0, recipe);
          return { ...p, recipes };
        });
        setSnack(null);
      },
    });
  };

  // Render: 'loose' recipe always at bottom.
  const sorted = [...plan.recipes].sort((a, b) => Number(a.source.kind === 'loose') - Number(b.source.kind === 'loose'));
  const ingredientCount = plan.recipes.reduce((n, r) => n + r.ingredients.length, 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <Container maxWidth='md' sx={{ py: 4, flexGrow: 1, width: '100%' }}>
        <AddRecipeBar onSubmit={handleAdd} />
        {sorted.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography variant='body2' color='text.secondary'>
              Pegá una URL de receta o escribí lo que querés cocinar.
            </Typography>
          </Box>
        ) : (
          sorted.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onRename={(label) => update((p) => ({ ...p, recipes: p.recipes.map((r) => r.id === recipe.id ? { ...r, label } : r) }))}
              onRemove={() => removeRecipe(recipe.id)}
              onToggleCollapse={() => update((p) => ({ ...p, recipes: p.recipes.map((r) => r.id === recipe.id ? { ...r, collapsed: !r.collapsed } : r) }))}
              onAddIngredient={(text) => update((p) => ({
                ...p,
                recipes: p.recipes.map((r) => r.id === recipe.id ? {
                  ...r, ingredients: [...r.ingredients, { id: newId(), text, qty: null, unit: null }],
                } : r),
              }))}
              onChangeIngredient={(line) => update((p) => ({
                ...p,
                recipes: p.recipes.map((r) => r.id === recipe.id ? {
                  ...r, ingredients: r.ingredients.map((i) => i.id === line.id ? line : i),
                } : r),
              }))}
              onRemoveIngredient={(lineId) => update((p) => ({
                ...p,
                recipes: p.recipes.map((r) => r.id === recipe.id ? {
                  ...r, ingredients: r.ingredients.filter((i) => i.id !== lineId),
                } : r),
              }))}
            />
          ))
        )}
      </Container>
      <PlanFooter ingredientCount={ingredientCount} recipeCount={plan.recipes.length} />
      <Snackbar
        open={snack !== null}
        autoHideDuration={6000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        action={
          snack?.undo ? (
            <Box component='button' onClick={() => snack.undo?.()} sx={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
              Deshacer
            </Box>
          ) : undefined
        }
      >
        {snack ? (
          <Alert severity={snack.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }} data-testid='plan-snackbar'>
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
```

- [ ] **Step 8: Update `src/app/layout.tsx` metadata**

Find the `metadata` object and replace with:

```ts
export const metadata: Metadata = {
  title: 'Plan de compras',
  description: 'Recetas semanales y cart-fill para supermercados argentinos.',
  robots: 'noindex',
  icons: { icon: '/favicon.ico' },
};
```

- [ ] **Step 9: Delete v2 surfaces**

```bash
rm src/containers/CartDrawer.tsx \
   src/containers/SearchPage.tsx \
   src/containers/RecipeInput.tsx \
   src/containers/StoreSelectModal.tsx \
   src/hooks/useCart.ts \
   src/hooks/useStore.ts \
   src/lib/storage/cart.ts \
   src/lib/storage/store.ts \
   src/lib/storage/__tests__/storage.test.ts
```

(`src/lib/storage/__tests__/preferences.test.ts` STAYS — preferences storage helpers are still used by the migration path.)

- [ ] **Step 10: Build + test**

```bash
pnpm build 2>&1 | tail -20
```

Expected: clean build. Common failures here are stale imports of deleted modules — fix any by deleting the offending import lines.

```bash
pnpm test:unit 2>&1 | tail -10
```

Expected: previously passing tests still pass. The `storage.test.ts` cart+store tests are gone (correct); `preferences.test.ts` still passes; pipeline test was already deleted in Task 4; the new `plan.test.ts` and `aggregate.test.ts` and `resolve.test.ts` and the updated `extract.test.ts` all pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(ui): replace home page with planner; kill v2 surfaces (cart drawer, search-and-add, store-select modal)"
```

---

## Task 10: Checkout — store-select step

**Files:**
- Modify: `src/containers/CheckoutStoreSelect.tsx` (replace placeholder)
- Create: `src/app/checkout/page.tsx`

- [ ] **Step 1: Replace `src/containers/CheckoutStoreSelect.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Box, Button, Card, CardActionArea, Stack, Typography } from '@mui/material';
import { STORES, STORE_IDS } from '~/lib/vtex/stores';
import type { StoreId } from '~/lib/vtex/types';

type Props = {
  initialStoreId: StoreId | null;
  onContinue: (storeId: StoreId) => void;
};

export const CheckoutStoreSelect = ({ initialStoreId, onContinue }: Props) => {
  const [chosen, setChosen] = useState<StoreId | null>(initialStoreId);
  return (
    <Box>
      <Typography variant='h6' sx={{ mb: 2 }}>¿Dónde comprás?</Typography>
      <Stack direction='row' spacing={2} sx={{ mb: 3 }}>
        {STORE_IDS.map((id) => (
          <Card key={id} variant={chosen === id ? 'elevation' : 'outlined'} sx={{ flex: 1, borderColor: chosen === id ? 'primary.main' : undefined, borderWidth: chosen === id ? 2 : 1 }}>
            <CardActionArea onClick={() => setChosen(id)} data-testid={`store-tile-${id}`}>
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant='h6'>{STORES[id].name}</Typography>
              </Box>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
      <Button
        variant='contained'
        disabled={!chosen}
        onClick={() => chosen && onContinue(chosen)}
        data-testid='store-continue'
      >
        Continuar
      </Button>
    </Box>
  );
};
```

- [ ] **Step 2: Create `src/app/checkout/page.tsx` (initial skeleton with just store-select)**

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Container, IconButton, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { CheckoutHandedOff, CheckoutLoading, CheckoutResolution, CheckoutStoreSelect, Navbar } from '~/containers';
import { usePlan } from '~/hooks';
import type { StoreId } from '~/lib/vtex/types';

export default function CheckoutPage() {
  const router = useRouter();
  const { plan, hydrated, update } = usePlan();

  useEffect(() => {
    if (hydrated && plan.recipes.every((r) => r.ingredients.length === 0)) {
      router.replace('/');
    }
  }, [hydrated, plan.recipes, router]);

  if (!hydrated) return null;

  const startResolution = (storeId: StoreId) => {
    update((p) => ({
      ...p,
      lastStoreId: storeId,
      lastResolution: { state: 'aggregating', storeId, startedAt: Date.now() },
    }));
  };

  const back = () => {
    update((p) => ({ ...p, lastResolution: { state: 'idle' } }));
  };

  const resolution = (plan.lastResolution as ReturnType<typeof Object> | undefined) as
    | undefined
    | { state: string; storeId?: StoreId; [k: string]: unknown };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <Container maxWidth='md' sx={{ py: 4, flexGrow: 1, width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <IconButton onClick={() => router.push('/')} aria-label='Volver al plan'>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant='subtitle2' color='text.secondary' sx={{ ml: 1 }}>
            Volver al plan
          </Typography>
        </Box>

        {(!resolution || resolution.state === 'idle') && (
          <CheckoutStoreSelect initialStoreId={plan.lastStoreId} onContinue={startResolution} />
        )}
        {resolution && ['aggregating', 'searching', 'matching'].includes(resolution.state) && (
          <CheckoutLoading />
        )}
        {resolution && resolution.state === 'ready' && (
          <CheckoutResolution onBack={back} />
        )}
        {resolution && resolution.state === 'handed-off' && (
          <CheckoutHandedOff />
        )}
      </Container>
    </Box>
  );
}
```

(The page only sets up state to start resolution; the actual `aggregating → ready` transition is wired in Task 11.)

- [ ] **Step 3: Smoke**

```bash
pnpm build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/app/checkout/page.tsx src/containers/CheckoutStoreSelect.tsx
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(checkout): add /checkout route skeleton + store-select step"
```

---

## Task 11: Checkout — loading state + resolution call

**Files:**
- Modify: `src/containers/CheckoutLoading.tsx` (replace placeholder)
- Modify: `src/app/checkout/page.tsx` (wire the call)

- [ ] **Step 1: Replace `src/containers/CheckoutLoading.tsx`**

```tsx
'use client';

import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';

const labelFor = (state: string): string => {
  if (state === 'aggregating') return 'Unificando ingredientes…';
  if (state === 'searching') return 'Buscando productos…';
  if (state === 'matching') return 'Eligiendo productos…';
  return 'Procesando…';
};

type Props = {
  state?: string;
  error?: { message: string; onRetry: () => void };
};

export const CheckoutLoading = ({ state = 'aggregating', error }: Props) => {
  if (error) {
    return (
      <Box sx={{ py: 6 }}>
        <Alert severity='error' action={<Button color='inherit' size='small' onClick={error.onRetry}>Reintentar</Button>}>
          {error.message}
        </Alert>
      </Box>
    );
  }
  return (
    <Stack alignItems='center' spacing={2} sx={{ py: 6 }}>
      <CircularProgress />
      <Typography variant='body2' color='text.secondary'>
        {labelFor(state)}
      </Typography>
    </Stack>
  );
};
```

- [ ] **Step 2: Wire the resolve call into `src/app/checkout/page.tsx`**

Replace the page contents (read it first, then write the version below):

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Container, IconButton, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  CheckoutHandedOff,
  CheckoutLoading,
  CheckoutResolution,
  CheckoutStoreSelect,
  Navbar,
} from '~/containers';
import { usePlan } from '~/hooks';
import type { Resolution } from '~/types/plan';
import type { StoreId } from '~/lib/vtex/types';

export default function CheckoutPage() {
  const router = useRouter();
  const { plan, hydrated, update } = usePlan();
  const inFlight = useRef(false);

  useEffect(() => {
    if (hydrated && plan.recipes.every((r) => r.ingredients.length === 0)) {
      router.replace('/');
    }
  }, [hydrated, plan.recipes, router]);

  // Fire the resolve call when state is 'aggregating'.
  useEffect(() => {
    const r = plan.lastResolution as Resolution | undefined;
    if (!hydrated || !r || r.state !== 'aggregating') return;
    if (inFlight.current) return;
    inFlight.current = true;

    const storeId = r.storeId;
    fetch('/api/checkout/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: storeId,
        recipes: plan.recipes,
        preferences: plan.preferences,
      }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        update((p) => ({
          ...p,
          lastResolution: {
            state: 'ready',
            storeId,
            matched: body.matched,
            unmatched: body.unmatched,
            skipped: body.skipped,
            candidates: body.candidates,
            redirectUrl: body.redirectUrl,
          },
        }));
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : 'unknown error';
        update((p) => ({
          ...p,
          lastResolution: { state: 'error', storeId, failedAt: 'aggregate', message },
        }));
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [hydrated, plan, update]);

  if (!hydrated) return null;

  const startResolution = (storeId: StoreId) => {
    update((p) => ({
      ...p,
      lastStoreId: storeId,
      lastResolution: { state: 'aggregating', storeId, startedAt: Date.now() },
    }));
  };

  const back = () => {
    update((p) => ({ ...p, lastResolution: { state: 'idle' } }));
  };

  const retry = () => {
    const r = plan.lastResolution as Resolution | undefined;
    if (!r || r.state !== 'error') return;
    update((p) => ({
      ...p,
      lastResolution: { state: 'aggregating', storeId: r.storeId, startedAt: Date.now() },
    }));
  };

  const resolution = plan.lastResolution as Resolution | undefined;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <Container maxWidth='md' sx={{ py: 4, flexGrow: 1, width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <IconButton onClick={() => router.push('/')} aria-label='Volver al plan'>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant='subtitle2' color='text.secondary' sx={{ ml: 1 }}>
            Volver al plan
          </Typography>
        </Box>

        {(!resolution || resolution.state === 'idle') && (
          <CheckoutStoreSelect initialStoreId={plan.lastStoreId} onContinue={startResolution} />
        )}
        {resolution && (resolution.state === 'aggregating' || resolution.state === 'searching' || resolution.state === 'matching') && (
          <CheckoutLoading state={resolution.state} />
        )}
        {resolution && resolution.state === 'error' && (
          <CheckoutLoading error={{ message: resolution.message, onRetry: retry }} />
        )}
        {resolution && resolution.state === 'ready' && (
          <CheckoutResolution onBack={back} />
        )}
        {resolution && resolution.state === 'handed-off' && (
          <CheckoutHandedOff />
        )}
      </Container>
    </Box>
  );
}
```

- [ ] **Step 3: Build**

```bash
pnpm build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/app/checkout/page.tsx src/containers/CheckoutLoading.tsx
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(checkout): wire /api/checkout/resolve into checkout page; loading + error states"
```

---

## Task 12: Checkout — resolution screen with swap, manual replace, qty edit, send

**Files:**
- Modify: `src/containers/CheckoutResolution.tsx` (replace placeholder)

This is the largest UI component in v3. Read carefully.

- [ ] **Step 1: Replace `src/containers/CheckoutResolution.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import DeleteIcon from '@mui/icons-material/Delete';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ProductSearch } from './ProductSearch';
import { usePlan } from '~/hooks';
import { recomputeRedirectUrl } from '~/lib/checkout/resolve';
import { STORES } from '~/lib/vtex/stores';
import type { Product } from '~/lib/vtex/types';
import type { AggregatedIngredient, MatchedItem, Resolution, SkippedIngredient } from '~/types/plan';

type Props = { onBack: () => void };

type ReadyResolution = Extract<Resolution, { state: 'ready' }>;

export const CheckoutResolution = ({ onBack }: Props) => {
  const { plan, update } = usePlan();
  const r = plan.lastResolution as ReadyResolution | undefined;
  const [swapOpenFor, setSwapOpenFor] = useState<string | null>(null);

  const total = useMemo(() => {
    if (!r) return 0;
    return r.matched.reduce((sum, m) => sum + m.picked.price * Math.max(1, Math.round(m.ingredient.qty ?? 1)), 0);
  }, [r]);

  if (!r || r.state !== 'ready') return null;
  const store = STORES[r.storeId];

  const apply = (fn: (curr: ReadyResolution) => ReadyResolution) => {
    update((p) => {
      const curr = p.lastResolution as ReadyResolution | undefined;
      if (!curr || curr.state !== 'ready') return p;
      const next = fn(curr);
      const redirectUrl = recomputeRedirectUrl(next.matched, store);
      return { ...p, lastResolution: { ...next, redirectUrl } };
    });
  };

  const swapMatched = (aggId: string, candidate: Product) => {
    apply((curr) => ({
      ...curr,
      matched: curr.matched.map((m) => m.aggregatedId === aggId ? { ...m, picked: candidate } : m),
    }));
    setSwapOpenFor(null);
  };

  const removeMatched = (aggId: string) => {
    apply((curr) => ({ ...curr, matched: curr.matched.filter((m) => m.aggregatedId !== aggId) }));
  };

  const setMatchedQty = (aggId: string, qty: number) => {
    if (!Number.isFinite(qty) || qty < 1) return;
    apply((curr) => ({
      ...curr,
      matched: curr.matched.map((m) => m.aggregatedId === aggId ? { ...m, ingredient: { ...m.ingredient, qty } } : m),
    }));
  };

  const promoteUnmatched = (aggId: string, picked: Product, ing: AggregatedIngredient) => {
    apply((curr) => ({
      ...curr,
      unmatched: curr.unmatched.filter((u) => u.id !== aggId),
      matched: [...curr.matched, { aggregatedId: aggId, ingredient: ing, picked, confidence: 'medium' }],
    }));
  };

  const dropUnmatched = (aggId: string) => {
    apply((curr) => ({ ...curr, unmatched: curr.unmatched.filter((u) => u.id !== aggId) }));
  };

  const promoteSkipped = (item: SkippedIngredient) => {
    apply((curr) => ({
      ...curr,
      skipped: curr.skipped.filter((s) => s.name !== item.name),
      unmatched: [
        ...curr.unmatched,
        { id: crypto.randomUUID(), name: item.name, qty: null, unit: null, sources: [] },
      ],
    }));
  };

  const sendToStore = () => {
    window.open(r.redirectUrl, '_blank', 'noopener');
    update((p) => ({
      ...p,
      lastResolution: {
        state: 'handed-off',
        storeId: r.storeId,
        matched: r.matched,
        redirectUrl: r.redirectUrl,
        handedOffAt: Date.now(),
      },
    }));
  };

  return (
    <Box>
      <Stack direction='row' justifyContent='space-between' alignItems='center' sx={{ mb: 2 }}>
        <Typography variant='h6'>
          ${total.toLocaleString('es-AR')} · {r.matched.length} productos
        </Typography>
        <Stack direction='row' spacing={1}>
          <Button onClick={onBack}>Volver</Button>
          <Button variant='contained' onClick={sendToStore} disabled={r.matched.length === 0} data-testid='send-to-store'>
            Enviar a {store.name}
          </Button>
        </Stack>
      </Stack>

      <Typography variant='subtitle1' sx={{ mb: 1 }}>Listo para enviar</Typography>
      <Stack spacing={1} sx={{ mb: 3 }}>
        {r.matched.length === 0 && <Typography variant='body2' color='text.secondary'>(vacío)</Typography>}
        {r.matched.map((m) => {
          const candidates = r.candidates[m.aggregatedId] ?? [];
          const others = candidates.filter((c) => c.skuId !== m.picked.skuId);
          const open = swapOpenFor === m.aggregatedId;
          return (
            <Card key={m.aggregatedId} variant='outlined' data-testid={`matched-${m.aggregatedId}`}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5 }}>
                {m.picked.imageUrl && <Box component='img' src={m.picked.imageUrl} alt='' sx={{ width: 48, height: 48, objectFit: 'contain' }} />}
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant='body2' sx={{ fontWeight: 500 }}>{m.picked.name}</Typography>
                  <Typography variant='caption' color='text.secondary'>
                    {m.ingredient.name} · de {m.ingredient.sources.map((s) => s.recipeLabel).join(', ') || '—'}
                  </Typography>
                </Box>
                <TextField
                  type='number'
                  size='small'
                  value={Math.max(1, Math.round(m.ingredient.qty ?? 1))}
                  onChange={(e) => setMatchedQty(m.aggregatedId, Number.parseInt(e.target.value, 10) || 1)}
                  inputProps={{ min: 1, style: { width: 56 }, 'data-testid': `qty-${m.aggregatedId}` }}
                />
                <Typography variant='body2' sx={{ minWidth: 80, textAlign: 'right' }}>
                  ${m.picked.price.toLocaleString('es-AR')}
                </Typography>
                <IconButton
                  size='small'
                  onClick={() => setSwapOpenFor(open ? null : m.aggregatedId)}
                  disabled={others.length === 0}
                  aria-label='Cambiar producto'
                  data-testid={`swap-${m.aggregatedId}`}
                >
                  <SwapHorizIcon fontSize='small' />
                </IconButton>
                <IconButton size='small' onClick={() => removeMatched(m.aggregatedId)} aria-label='Quitar'>
                  <DeleteIcon fontSize='small' />
                </IconButton>
              </CardContent>
              <Collapse in={open}>
                <Box sx={{ px: 2, pb: 2 }}>
                  <List dense>
                    {others.slice(0, 6).map((cand) => (
                      <ListItem key={cand.skuId} secondaryAction={
                        <Button size='small' variant='outlined' onClick={() => swapMatched(m.aggregatedId, cand)} data-testid={`swap-pick-${cand.skuId}`}>
                          Usar este
                        </Button>
                      }>
                        <ListItemText primary={cand.name} secondary={`$${cand.price.toLocaleString('es-AR')}`} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              </Collapse>
            </Card>
          );
        })}
      </Stack>

      {r.unmatched.length > 0 && (
        <>
          <Typography variant='subtitle1' sx={{ mb: 1 }}>No encontramos</Typography>
          <Stack spacing={1} sx={{ mb: 3 }}>
            {r.unmatched.map((u) => (
              <Card key={u.id} variant='outlined' data-testid={`unmatched-${u.id}`}>
                <CardContent>
                  <Stack direction='row' alignItems='center' spacing={1} sx={{ mb: 1 }}>
                    <Typography variant='body2' sx={{ flexGrow: 1, fontWeight: 500 }}>{u.name}</Typography>
                    <Button size='small' onClick={() => dropUnmatched(u.id)}>Ignorar</Button>
                  </Stack>
                  <ProductSearch
                    storeId={r.storeId}
                    initialQuery={u.name}
                    pickLabel='Usar este'
                    onPick={(p) => promoteUnmatched(u.id, p, u)}
                  />
                </CardContent>
              </Card>
            ))}
          </Stack>
        </>
      )}

      {r.skipped.length > 0 && (
        <Accordion variant='outlined'>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid='skipped-section'>
            <Typography variant='subtitle1'>Saltadas ({r.skipped.length})</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              {r.skipped.map((s) => (
                <Stack key={s.name} direction='row' alignItems='center' spacing={1}>
                  <Typography variant='body2' sx={{ flexGrow: 1 }}>{s.name}</Typography>
                  <Typography variant='caption' color='text.secondary'>{s.reason}</Typography>
                  <Button size='small' onClick={() => promoteSkipped(s)}>Buscar igual</Button>
                </Stack>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      {r.matched.length === 0 && r.unmatched.length === 0 && (
        <Alert severity='info'>No hay productos para enviar.</Alert>
      )}
    </Box>
  );
};
```

- [ ] **Step 2: Build**

```bash
pnpm build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/containers/CheckoutResolution.tsx
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(checkout): add resolution screen with swap, manual replace, qty edit, send-to-store"
```

---

## Task 13: Checkout — handed-off state + Vaciar plan

**Files:**
- Modify: `src/containers/CheckoutHandedOff.tsx` (replace placeholder)

- [ ] **Step 1: Replace `src/containers/CheckoutHandedOff.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { Box, Button, Stack, Typography } from '@mui/material';
import { usePlan } from '~/hooks';
import { STORES } from '~/lib/vtex/stores';
import type { Resolution } from '~/types/plan';

export const CheckoutHandedOff = () => {
  const router = useRouter();
  const { plan, update } = usePlan();
  const r = plan.lastResolution as Resolution | undefined;
  if (!r || r.state !== 'handed-off') return null;
  const store = STORES[r.storeId];

  const clearPlan = () => {
    update((p) => ({ ...p, recipes: [], lastResolution: { state: 'idle' } }));
    router.push('/');
  };

  return (
    <Stack spacing={3} sx={{ py: 4 }} alignItems='center'>
      <Typography variant='h6'>Lista enviada a {store.name}.</Typography>
      <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'center', maxWidth: 480 }}>
        El supermercado se abrió en una nueva pestaña con todos los productos en tu carrito.
        Cuando termines la compra, podés vaciar el plan para empezar otra semana.
      </Typography>
      <Box>
        <Button variant='contained' onClick={clearPlan} data-testid='clear-plan'>
          Vaciar plan
        </Button>
      </Box>
    </Stack>
  );
};
```

- [ ] **Step 2: Build + smoke unit tests**

```bash
pnpm build 2>&1 | tail -10
pnpm test:unit 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/containers/CheckoutHandedOff.tsx
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(checkout): add handed-off banner + Vaciar plan button"
```

---

## Task 14: Replace Playwright E2E for v3

**Files:**
- Modify: `tests/poc.spec.ts` (replace contents)

- [ ] **Step 1: Replace `tests/poc.spec.ts`**

```ts
import { expect, Route, test } from '@playwright/test';

const sampleExtractURL = {
  label: 'Empanadas de pollo',
  ingredients: [
    { name: 'pollo', qty: 200, unit: 'g' },
    { name: 'cebolla', qty: 1, unit: null },
  ],
  isLoose: false,
};
const sampleExtractText = {
  label: 'Tarta de espinaca',
  ingredients: [
    { name: 'espinaca', qty: 1, unit: 'paquete' },
    { name: 'cebolla', qty: 1, unit: null },
  ],
  isLoose: false,
};
const sampleExtractLoose = {
  label: 'yerba',
  ingredients: [{ name: 'yerba', qty: null, unit: null }],
  isLoose: true,
};
const sampleResolve = {
  matched: [
    {
      aggregatedId: 'a-onion',
      ingredient: {
        id: 'a-onion',
        name: 'cebolla',
        qty: 2,
        unit: null,
        sources: [{ recipeId: 'r1', recipeLabel: 'Empanadas de pollo', originalText: '1 cebolla' }],
      },
      picked: { skuId: 'sku-onion', productId: 'p', name: 'Cebolla por kg', price: 1500, available: true },
      confidence: 'high',
    },
  ],
  unmatched: [
    {
      id: 'a-flour',
      name: 'harina',
      qty: 500,
      unit: 'g',
      sources: [{ recipeId: 'r1', recipeLabel: 'Empanadas de pollo', originalText: '500 g harina' }],
    },
  ],
  skipped: [{ name: 'sal', reason: 'pantry staple' }],
  candidates: {
    'a-onion': [{ skuId: 'sku-onion', productId: 'p', name: 'Cebolla por kg', price: 1500, available: true }],
    'a-flour': [],
  },
  redirectUrl: 'https://www.jumbo.com.ar/checkout/cart/add?sku=sku-onion&qty=2&seller=1&sc=32&redirect=true',
};

const mockApi = async (route: Route) => {
  const url = route.request().url();
  if (url.includes('/api/recipe/extract')) {
    const body = JSON.parse(route.request().postData() ?? '{}') as { url?: string; text?: string };
    if (body.url) {
      await route.fulfill({ status: 200, body: JSON.stringify(sampleExtractURL) });
    } else if (body.text === 'yerba') {
      await route.fulfill({ status: 200, body: JSON.stringify(sampleExtractLoose) });
    } else {
      await route.fulfill({ status: 200, body: JSON.stringify(sampleExtractText) });
    }
  } else if (url.includes('/api/checkout/resolve')) {
    await route.fulfill({ status: 200, body: JSON.stringify(sampleResolve) });
  } else if (url.includes('/api/search')) {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        products: [{ skuId: 'sku-flour', productId: 'pf', name: 'Harina 000 1kg', price: 2200, available: true }],
      }),
    });
  } else {
    await route.continue();
  }
};

test.beforeEach(async ({ context }) => {
  await context.route('**/api/**', mockApi);
});

test('paste URL → recipe card with label and ingredients', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-input').fill('https://example.test/empanadas');
  await page.getByTestId('add-submit').click();
  await expect(page.getByText('Empanadas de pollo')).toBeVisible();
  await expect(page.getByText('pollo')).toBeVisible();
  await expect(page.getByText('cebolla')).toBeVisible();
});

test('paste text → manual recipe card', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-input').fill('Tarta de espinaca\n- espinaca\n- cebolla');
  await page.getByTestId('add-submit').click();
  await expect(page.getByText('Tarta de espinaca')).toBeVisible();
});

test('single short phrase → Otros card', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-input').fill('yerba');
  await page.getByTestId('add-submit').click();
  await expect(page.getByText('Otros')).toBeVisible();
  await expect(page.getByText('yerba')).toBeVisible();
});

test('checkout → resolution screen → send opens new tab', async ({ page, context }) => {
  await page.goto('/');
  await page.getByTestId('add-input').fill('https://example.test/empanadas');
  await page.getByTestId('add-submit').click();
  await expect(page.getByText('Empanadas de pollo')).toBeVisible();

  await page.getByTestId('checkout-button').click();
  await expect(page).toHaveURL(/\/checkout$/);
  await page.getByTestId('store-tile-jumbo').click();
  await page.getByTestId('store-continue').click();

  // Resolution screen
  await expect(page.getByTestId('matched-a-onion')).toBeVisible();
  await expect(page.getByTestId('unmatched-a-flour')).toBeVisible();

  const popupPromise = context.waitForEvent('page');
  await page.getByTestId('send-to-store').click();
  const popup = await popupPromise;
  expect(popup.url()).toMatch(/jumbo\.com\.ar\/checkout\/cart\/add/);
  await popup.close();
});

test('preferences dialog persists value across reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-preferences-button').click();
  await page.getByTestId('preferences-input').fill('prefer lactose-free dairy');
  await page.getByTestId('preferences-save').click();
  await page.getByTestId('open-preferences-button').click();
  await expect(page.getByTestId('preferences-input')).toHaveValue('prefer lactose-free dairy');
});
```

- [ ] **Step 2: Run E2E**

```bash
pnpm playwright:test --project=chromium 2>&1 | tail -20
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/poc.spec.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "test(e2e): rewrite Playwright suite for v3 (planner + delayed-resolution checkout)"
```

---

## Task 15: README + tag v3

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read existing README, then replace**

Read first via the Read tool, then write the new content:

```markdown
# Supermarket — Recipe-First Planner

Personal-use weekly meal planner that ends in a populated supermarket cart. The user adds recipes (URL, pasted text, or single loose ingredient) into a plain-text shopping list grouped by recipe; at checkout, an LLM aggregates duplicates across recipes, searches each in the chosen supermarket, picks the best SKU, and opens the supermarket's cart in a new tab with everything pre-filled.

Currently supports: Jumbo, Carrefour. Both run on VTEX; integration is anonymous.

## Stack

Next.js 15 (App Router), React 19, MUI v6, TypeScript, Jest, Playwright, pnpm. LLM via OpenRouter + Vercel AI SDK + `anthropic/claude-sonnet-4.6` (1M context, native).

## Setup

```bash
pnpm install
cp .env.example .env
# add OPENROUTER_API_KEY=... to .env
```

## Scripts

| Script | What |
|---|---|
| `pnpm dev` | Dev server on http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build & serve |
| `pnpm test:unit` | Jest unit tests |
| `pnpm test:live` | Live integration tests against real Jumbo/Carrefour and OpenRouter (skipped from `test:unit`) |
| `pnpm test:e2e` | Playwright E2E |
| `pnpm format` | Prettier + ESLint |

## Flow

1. **Plan** (`/`). Paste a recipe URL, paste pasted recipe text, or type a single ingredient. Each becomes a card in the recipe-grouped list (loose ingredients pool into an "Otros" card). Edit, rename, remove (with undo), collapse.
2. **Preferences** (gear icon). Free-text shopping preferences saved to localStorage, sent to the LLM at checkout.
3. **Checkout** (`/checkout`). Pick supermarket → LLM aggregates ingredients → VTEX search per ingredient → LLM picks SKUs. Resolution screen shows matched / unmatched (with inline manual search) / skipped (pantry staples). Swap candidates inline. Edit qty inline.
4. **Send**. Opens the supermarket's `/checkout/cart/add?sku=...` URL in a new tab; planner stays open. Click "Vaciar plan" when ready to start a new week.

## Manual smoke

After any non-trivial change:
1. `pnpm dev` → http://localhost:3000.
2. Paste a real Argentine recipe URL → recipe card appears with ingredients.
3. Paste another recipe (or text). Type a loose item ("yerba") → goes to Otros.
4. Click Checkout → pick Jumbo → wait ~10–30s → resolution screen.
5. Swap one matched product. Manually search for one unmatched. Edit a qty.
6. Click "Send to Jumbo" → new tab opens on jumbo.com.ar with the cart populated. Log in there to pay.
7. Repeat with Carrefour.

## Specs & plans

- v1 (PoC): `docs/superpowers/specs/2026-05-04-supermarket-poc-design.md`, `docs/superpowers/plans/2026-05-04-supermarket-poc.md`
- v2 (recipe URL → cart, immediate): `docs/superpowers/specs/2026-05-04-recipe-url-to-cart-design.md`, `docs/superpowers/plans/2026-05-04-recipe-url-to-cart.md`
- v3 (recipe-first planning, delayed resolution): `docs/superpowers/specs/2026-05-04-recipe-first-planning-design.md`, `docs/superpowers/plans/2026-05-04-recipe-first-planning.md`
- VTEX endpoint research: `docs/superpowers/research/2026-05-04-vtex-samples.md`
```

- [ ] **Step 2: Final test run**

```bash
pnpm test:unit && pnpm test:e2e --project=chromium
```

Expected: green.

- [ ] **Step 3: Commit + tag**

```bash
git add README.md
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "docs: update README for v3 (recipe-first planning)"
git tag -a v3 -m "v3: recipe-first planner with delayed-resolution checkout"
git tag -l
```

---

## Acceptance verification

The v3 milestone is complete when:

1. ✅ First load with v2 keys present cleanly migrates `preferences` and clears `cart:*` and `store`.
2. ✅ Pasting a recipe URL produces a `RecipeCard` with LLM-extracted label + ingredients.
3. ✅ Pasting recipe text produces a `RecipeCard` with manual source.
4. ✅ Typing a single short phrase pools into an `Otros` card.
5. ✅ Removing a recipe shows undo snackbar; clicking restores it.
6. ✅ Checkout → store-select → resolution screen renders matched/unmatched/skipped sections.
7. ✅ Swap UI works without re-fetching candidates.
8. ✅ Manual search via `/api/search` resolves an unmatched ingredient.
9. ✅ Qty edit recomputes the redirect URL.
10. ✅ "Send to {store}" opens a new tab with `/checkout/cart/add?sku=...`; planner stays.
11. ✅ "Vaciar plan" clears recipes and resolution; preferences and lastStoreId stay.
12. ✅ `pnpm test:unit` passes (≥ existing 30+ plus new ~20 tests).
13. ✅ `pnpm test:e2e --project=chromium` passes (5 v3 specs).
14. ✅ `pnpm test:live` passes when env is configured.
