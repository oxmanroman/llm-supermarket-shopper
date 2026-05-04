import { generateObject } from 'ai';
import type { Product } from '~/lib/vtex/types';
import { createLlm } from './client';
import { describeLlmError } from './errors';
import { MatchSchema, type Ingredient, type Pick } from './types';

const SYSTEM_PROMPT = `You match recipe ingredients to supermarket products.

For each ingredient, choose the best candidate skuId from its candidate list, or return null if no candidate is a reasonable match. Use "high"/"medium"/"low" confidence based on how well the chosen SKU matches the ingredient (name, brand, package size, dietary attributes if listed in candidate names).

Return one pick per ingredient. The "ingredientIndex" must match the index in the input array.`;

type PickInput = {
  ingredients: Ingredient[];
  candidates: Product[][];
  preferences: string;
};

export async function pickSkus(input: PickInput): Promise<Pick[]> {
  const payload = input.ingredients.map((ingredient, i) => ({
    ingredient,
    candidates: input.candidates[i] ?? [],
  }));

  const prefsBlock = input.preferences.trim().length
    ? `\n\nUSER PREFERENCES (in their own words; honor when applicable):\n"""\n${input.preferences.trim()}\n"""`
    : '';

  const prompt = `${SYSTEM_PROMPT}${prefsBlock}\n\nINGREDIENTS AND CANDIDATES:\n${JSON.stringify(payload, null, 2)}`;

  try {
    const result = await generateObject({
      model: createLlm(),
      schema: MatchSchema,
      prompt,
    });
    return result.object;
  } catch (error) {
    const detail = describeLlmError(error);
    if (detail.startsWith('MISSING_API_KEY')) throw error;
    console.error('[llm/match] full error:', error);
    throw new Error(`LLM_FAILED: ${detail}`);
  }
}
