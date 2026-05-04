import { generateObject } from 'ai';
import { createLlm } from './client';
import { ExtractSchema, type Ingredient } from './types';

const SYSTEM_PROMPT = `You extract ingredient lists from recipe pages.

INPUT: HTML of a recipe page (any language; typically Spanish or English).

TASK: Return a structured ingredient list in **Argentine Spanish (es-AR)**, since the user shops at an Argentine supermarket.

RULES:
- Include every ingredient the recipe lists.
- If the recipe is in another language, translate ingredient names to Argentine Spanish (e.g., "butter" -> "manteca", "avocado" -> "palta", "bell pepper" -> "morrón").
- Quantities: numeric when given (e.g., "2 cucharadas" -> qty: 2, unit: "cucharada"). Use null when not specified or "to taste".
- Do NOT invent or assume ingredients that aren't listed.`;

export async function extractIngredients(html: string): Promise<Ingredient[]> {
  try {
    const result = await generateObject({
      model: createLlm(),
      schema: ExtractSchema,
      prompt: `${SYSTEM_PROMPT}\n\nHTML:\n${html}`,
    });
    return result.object;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    if (detail.startsWith('MISSING_API_KEY')) throw error;
    throw new Error(`LLM_FAILED: ${detail}`);
  }
}
