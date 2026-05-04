import { z } from 'zod';

export const IngredientSchema = z.object({
  name: z.string(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  notes: z.string().optional(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const ExtractSchema = z.array(IngredientSchema);

export const ExtractResultSchema = z.object({
  label: z.string(),
  ingredients: z.array(IngredientSchema),
  isLoose: z.boolean(),
});
export type ExtractResult = z.infer<typeof ExtractResultSchema>;

// NOTE: use `z.number()`, NOT `z.number().int()`/`z.int()`. Zod v4's int() emits
// safe-integer `minimum`/`maximum` bounds in its JSON Schema, and Anthropic's
// structured-output validator rejects min/max on `integer` types ("For 'integer'
// type, properties maximum, minimum are not supported"). The prompt instructs the
// model to return whole-number indices; the pipeline's Map<number, Pick> lookup
// works regardless.
export const PickSchema = z.object({
  ingredientIndex: z.number(),
  pickedSkuId: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
});
export type Pick = z.infer<typeof PickSchema>;

export const MatchSchema = z.array(PickSchema);
