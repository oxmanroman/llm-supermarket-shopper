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
  // How many PACKAGES of pickedSkuId to add to the cart so the user has enough
  // for the recipe — NOT the recipe quantity. Computed by the matcher LLM from
  // (recipe need) ÷ (package size parsed from the SKU name), rounded up.
  // Example: recipe needs "500 g harina", SKU is "Harina 0000 1 Kg Caserita",
  // cartQty=1. Recipe needs "12 tapas", SKU is "Tapas x 12 Un", cartQty=1.
  // null when pickedSkuId is null.
  cartQty: z.number().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
});
export type Pick = z.infer<typeof PickSchema>;

export const MatchSchema = z.array(PickSchema);
