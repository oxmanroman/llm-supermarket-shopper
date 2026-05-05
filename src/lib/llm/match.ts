import { generateObject } from 'ai';
import type { Product } from '~/lib/vtex/types';
import { createLlm } from './client';
import { describeLlmError } from './errors';
import { MatchSchema, type Ingredient, type Pick } from './types';

const SYSTEM_PROMPT = `You match recipe ingredients to supermarket products.

For each ingredient, choose the best candidate skuId from its candidate list, or return null if no candidate is a reasonable match. Use "high"/"medium"/"low" confidence based on how well the chosen SKU matches the ingredient (name, brand, package size, dietary attributes if listed in candidate names).

Also compute "cartQty" — the number of PACKAGES of the chosen SKU the user must add to their cart so they have enough of the ingredient for the recipe. This is NOT the recipe's quantity. It is (recipe need) ÷ (package size parsed from the SKU name), ROUNDED UP, with a minimum of 1.

Parse the package size from the SKU name. Argentine supermarket SKU names usually include the package size: "Harina 0000 1 Kg Caserita" → 1 kg per package. "Aceitunas Castell Verdes 100 Gr" → 100 g per package. "Tapas Empanadas Criollas x 12 Un La Italiana" → 12 units per package. "Leche Descremada 1 Lts Tregar" → 1 L per package. "Huevos Blancos 6 U Maxima" → 6 units per package.

Worked examples (apply the same logic to every ingredient):

  ingredient                            picked SKU                              cartQty   why
  --------------------------------------------------------------------------------------------------------------------------------------
  { name: "harina", qty: 500, unit: "g" }   "Harina 0000 1 Kg Caserita"          1         500 g need ÷ 1000 g/pkg = 0.5, round up = 1
  { name: "harina", qty: 2,   unit: "kg" }  "Harina 0000 1 Kg Caserita"          2         2 kg need ÷ 1 kg/pkg = 2
  { name: "leche",  qty: 240, unit: "ml" }  "Leche Descremada 1 Lts Tregar"      1         240 ml ÷ 1000 ml/pkg = 0.24, round up
  { name: "leche",  qty: 2,   unit: "L" }   "Leche Entera 1 Lt La Serenísima"    2         2 L ÷ 1 L/pkg = 2
  { name: "huevos", qty: 12,  unit: "unidad" } "Huevos Blancos 6 U Maxima"       2         12 ÷ 6 = 2 packs
  { name: "huevos", qty: 2,   unit: "unidad" } "Huevos Blancos 6 U Maxima"       1         2 ÷ 6 = 0.33, round up = 1 pack
  { name: "tapas para empanadas", qty: 12, unit: "unidad" } "Tapas Empanadas x 12 Un"  1   12 ÷ 12 = 1 pack
  { name: "tapas para empanadas", qty: 24, unit: "unidad" } "Tapas Empanadas x 12 Un"  2   24 ÷ 12 = 2 packs
  { name: "aceitunas", qty: 50, unit: "g" } "Aceitunas Castell Verdes 100 Gr"    1         50 g ÷ 100 g/pkg = 0.5, round up = 1
  { name: "pimentón", qty: 5, unit: "g" }   "Pimentón Dulce 25 Grs Alicante"     1         5 g ÷ 25 g/pkg = 0.2, round up = 1
  { name: "cebolla", qty: 2, unit: "unidad" } "Cebolla Por Kg"                   1         By-weight produce: 1 kg gives ~5 onions, plenty for 2
  { name: "pimiento rojo", qty: 0.5, unit: "unidad" } "Pimiento Rojo Por Kg"     1         Half a pepper: 1 kg is the minimum reasonable purchase

ROUND UP: if 0.5 < (need ÷ pkg) ≤ 1, return 1. If 1 < (need ÷ pkg) ≤ 2, return 2. Etc.

If pickedSkuId is null, set cartQty to null too.

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
