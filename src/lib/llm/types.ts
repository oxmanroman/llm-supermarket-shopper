import { z } from 'zod';

export const IngredientSchema = z.object({
  name: z.string(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  notes: z.string().optional(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const ExtractSchema = z.array(IngredientSchema);

// NOTE: do NOT add `.min()`/`.max()`/`.nonnegative()` etc. on numeric fields.
// Anthropic's structured-output validator rejects JSON Schemas that include
// `minimum`/`maximum` on `integer` types (error: "For 'integer' type, properties
// maximum, minimum are not supported"). Validate ranges in code instead.
export const PickSchema = z.object({
  ingredientIndex: z.number().int(),
  pickedSkuId: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
});
export type Pick = z.infer<typeof PickSchema>;

export const MatchSchema = z.array(PickSchema);
