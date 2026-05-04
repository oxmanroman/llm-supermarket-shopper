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
