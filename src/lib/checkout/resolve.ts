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
