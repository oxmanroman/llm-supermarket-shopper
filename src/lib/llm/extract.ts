import { generateObject } from 'ai';
import { createLlm } from './client';
import { describeLlmError } from './errors';
import { ExtractResultSchema, type ExtractResult } from './types';

const HTML_PROMPT_PREFIX = `You extract ingredient lists from recipe pages.

INPUT: HTML or cleaned text of a recipe page (any language; typically Spanish or English).

TASK: Return the recipe title (label) and a structured ingredient list in **Argentine Spanish (es-AR)**.

RULES:
- Include every ingredient the recipe lists.
- If the recipe is in another language, translate ingredient names to Argentine Spanish (e.g., "butter" -> "manteca", "avocado" -> "palta", "bell pepper" -> "morrón", "all-purpose flour" -> "harina 0000", "heavy cream" -> "crema de leche", "buttermilk" -> "leche cortada").
- Quantities: numeric when given. Use null when not specified or "to taste".
- Preserve the units as written in the recipe (cup/taza/tbsp/tsp/g/ml/etc.). The aggregation step will convert imperial volumes to supermarket-friendly units later.
- Do NOT invent or assume ingredients that aren't listed.
- Set isLoose to false for a real recipe page.`;

const TEXT_PROMPT_PREFIX = `You receive free text from a meal planner UI. It can be:
A) a recipe with a title and ingredient list (multi-line, has list structure), OR
B) a single short phrase (≤ 4 words, no list) representing one loose pantry item the user wants to buy.

TASK: Return label + ingredients in **Argentine Spanish (es-AR)**, and set isLoose accordingly.

RULES:
- Case A: label = recipe title (best guess from the text); ingredients = the listed ingredient lines; isLoose = false.
- Case B: label = the input itself (cleaned up); ingredients = a single line representing the item; isLoose = true.
- Translate to Argentine Spanish where appropriate. Quantities numeric when present, null otherwise.`;

export type ExtractInput = { html: string } | { text: string };

export async function extract(input: ExtractInput): Promise<ExtractResult> {
  if (!('html' in input) && !('text' in input)) {
    throw new Error('extract requires either html or text');
  }
  const prompt =
    'html' in input
      ? `${HTML_PROMPT_PREFIX}\n\nHTML:\n${input.html}`
      : `${TEXT_PROMPT_PREFIX}\n\nINPUT:\n${input.text}`;

  try {
    const result = await generateObject({
      model: createLlm(),
      schema: ExtractResultSchema,
      prompt,
    });
    return result.object;
  } catch (error) {
    const detail = describeLlmError(error);
    if (detail.startsWith('MISSING_API_KEY')) throw error;
    console.error('[llm/extract] full error:', error);
    throw new Error(`LLM_FAILED: ${detail}`);
  }
}
