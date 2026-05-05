import { pickSkus } from '~/lib/llm/match';
import { buildAddToCartUrl } from '~/lib/vtex/cart';
import { productSearch } from '~/lib/vtex/search';
import type { Product, Store } from '~/lib/vtex/types';
import type { AggregatedIngredient, MatchedItem, Recipe, SkippedIngredient } from '~/types/plan';
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

  const picks =
    aggregated.length === 0
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
    const product = pick?.pickedSkuId ? candidatesArr[idx]?.find((c) => c.skuId === pick.pickedSkuId) : undefined;
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
    })),
  );
}
