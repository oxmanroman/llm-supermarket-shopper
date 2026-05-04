import { z } from 'zod';

export const IngredientSchema = z.object({
  name: z.string(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  notes: z.string().optional(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const ExtractSchema = z.array(IngredientSchema);

export const PickSchema = z.object({
  ingredientIndex: z.number().int().nonnegative(),
  pickedSkuId: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
});
export type Pick = z.infer<typeof PickSchema>;

export const MatchSchema = z.array(PickSchema);
