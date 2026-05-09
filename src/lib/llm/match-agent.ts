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

// Implemented in Task 3. Imports above (generateText, isStepCount, createLlm,
// describeLlmError, defaultProductSearch) will be wired in there.
export async function matchAgent(input: MatchAgentInput): Promise<MatchAgentOutput> {
  void input;
  void generateText;
  void isStepCount;
  void createLlm;
  void describeLlmError;
  void defaultProductSearch;
  throw new Error('matchAgent not implemented yet');
}
