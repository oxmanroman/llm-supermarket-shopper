import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import type { Product, Store } from '~/lib/store';
import { productSearch as defaultProductSearch } from '~/lib/store';
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

Never call submitPick with pickedSkuId=null. If no candidate is acceptable after a few refined searches, call skipIngredient with a short reason and move on.

DO NOT loop forever. After 3–4 refined searches yield nothing reasonable for an ingredient, skipIngredient.`;

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
      stopWhen: [stepCountIs(maxSteps), () => ctx.picks.size + ctx.skipped.size >= input.aggregated.length],
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
