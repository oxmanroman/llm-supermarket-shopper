import { extractIngredients } from '~/lib/llm/extract';
import { pickSkus } from '~/lib/llm/match';
import type { Pick } from '~/lib/llm/types';
import { productSearch } from '~/lib/vtex/search';
import type { CartItem, Product, Store } from '~/lib/vtex/types';
import { fetchAndCleanHtml } from './fetch';

export type RecipePipelineInput = {
  url: string;
  store: Store;
  preferences: string;
};

export type RecipeResult = {
  items: CartItem[];
  unmatched: string[];
};

export async function runRecipePipeline(input: RecipePipelineInput): Promise<RecipeResult> {
  const html = await fetchAndCleanHtml(input.url);
  const ingredients = await extractIngredients(html);
  if (ingredients.length === 0) {
    return { items: [], unmatched: [] };
  }

  const candidates: Product[][] = await Promise.all(
    ingredients.map((ingredient) => productSearch(input.store, ingredient.name).catch(() => [])),
  );

  const picks = await pickSkus({ ingredients, candidates, preferences: input.preferences });

  const items: CartItem[] = [];
  const unmatched: string[] = [];
  const picksByIndex = new Map<number, Pick>(picks.map((p) => [p.ingredientIndex, p]));

  for (let idx = 0; idx < ingredients.length; idx++) {
    const ingredient = ingredients[idx];
    const pick = picksByIndex.get(idx);
    const product = pick?.pickedSkuId ? candidates[idx]?.find((c) => c.skuId === pick.pickedSkuId) : undefined;
    if (product) {
      items.push({
        skuId: product.skuId,
        qty: 1,
        name: product.name,
        imageUrl: product.imageUrl,
        price: product.price,
      });
    } else {
      unmatched.push(ingredient.name);
    }
  }

  return { items, unmatched };
}
