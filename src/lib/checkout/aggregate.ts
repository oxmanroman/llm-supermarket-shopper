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
  sources: z.array(z.object({ recipeId: z.string(), recipeLabel: z.string(), originalText: z.string() })),
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
