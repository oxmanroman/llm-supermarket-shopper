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

type AggregateInput = { recipes: Recipe[]; preferences: string };

type AggregateOutput = {
  aggregated: AggregatedIngredient[];
  skipped: SkippedIngredient[];
  recipeSummaries: RecipeSummary[];
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
