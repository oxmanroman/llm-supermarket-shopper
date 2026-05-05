/**
 * @jest-environment node
 *
 * Live recipe-pipeline eval. Runs real LLM calls (aggregate → search → match)
 * against a battery of fixtures in Spanish, English, and French. Asserts on the
 * properties that have caused real bugs: cart-qty as package count (not recipe
 * qty), imperial-unit conversion at aggregate, pantry-staple skipping, output
 * units restricted to {g, kg, ml, L, unidad}.
 *
 * Costs real OpenRouter tokens (~$0.10/run for the full suite). Gated:
 *
 *     LIVE_TESTS=1 pnpm test:live
 *
 * Fixtures use pasted text (not URLs) so we don't tie test stability to
 * external recipe sites or the Jina proxy. The extract→aggregate→match path is
 * what we want to evaluate; URL fetch is covered separately.
 */
import { extract } from '~/lib/llm/extract';
import { STORES } from '~/lib/store';
import type { Recipe } from '~/types/plan';
import { resolve } from '../resolve';

jest.setTimeout(120_000);

const live = process.env.LIVE_TESTS === '1' && Boolean(process.env.OPENROUTER_API_KEY);
const liveDescribe = live ? describe : describe.skip;

type Fixture = {
  language: 'es' | 'en' | 'fr';
  name: string;
  text: string;
  /** Lower bound on number of extracted ingredients (sanity check). */
  expectMinIngredients: number;
};

const FIXTURES: Fixture[] = [
  {
    language: 'es',
    name: 'Empanadas de pollo (es)',
    text: `Empanadas de pollo

Ingredientes:
- 12 tapas para empanadas
- 500 g de pechuga de pollo
- 4 cucharadas de aceite
- 2 cebollas
- 1 pimiento rojo
- 2 huevos duros
- 50 g de aceitunas verdes
- 1 cucharadita de pimentón dulce
- 1 cucharadita de orégano
- sal y pimienta a gusto`,
    expectMinIngredients: 8,
  },
  {
    language: 'es',
    name: 'Tarta de espinaca (es)',
    text: `Tarta de espinaca

Ingredientes:
- 2 tapas de tarta
- 1 paquete de espinaca congelada
- 1 cebolla grande
- 3 huevos
- 200 g de queso cremoso
- 50 g de queso rallado
- sal, pimienta, nuez moscada`,
    expectMinIngredients: 6,
  },
  {
    language: 'en',
    name: 'Banana bread (en) — heavy on cups/tbsp',
    text: `Banana bread

Ingredients:
- 2 cups all-purpose flour
- 1 cup sugar
- 1/2 cup butter, softened
- 3 ripe bananas
- 2 eggs
- 1 tsp baking soda
- 1 tsp vanilla extract
- 1/4 cup milk
- 1/2 tsp salt`,
    expectMinIngredients: 7,
  },
  {
    language: 'en',
    name: 'Chocolate chip cookies (en) — cups + oz',
    text: `Chocolate chip cookies

Ingredients:
- 2 1/4 cups all-purpose flour
- 1 cup butter, softened
- 3/4 cup brown sugar
- 1/2 cup white sugar
- 2 large eggs
- 1 tsp vanilla extract
- 1 tsp baking soda
- 1/2 tsp salt
- 12 oz chocolate chips`,
    expectMinIngredients: 7,
  },
  {
    language: 'fr',
    name: 'Quiche lorraine (fr)',
    text: `Quiche lorraine

Ingrédients:
- 1 pâte brisée
- 200 g de lardons
- 3 œufs
- 200 ml de crème fraîche
- 100 ml de lait
- 100 g de gruyère râpé
- sel, poivre, muscade`,
    expectMinIngredients: 5,
  },
  {
    language: 'fr',
    name: 'Crêpes (fr) — mixed metric and counts',
    text: `Crêpes

Ingrédients:
- 250 g de farine
- 4 œufs
- 500 ml de lait
- 1 pincée de sel
- 50 g de beurre fondu`,
    expectMinIngredients: 4,
  },
];

const ALLOWED_UNITS = new Set(['g', 'kg', 'ml', 'l', 'unidad', null, undefined]);

const PANTRY_STAPLE_PATTERNS = [/\bsal\b/i, /\bpimienta\b/i, /\bagua\b/i, /\bpepper\b/i, /\bsel\b/i];

liveDescribe.each(FIXTURES)('eval: %s', (fixture: Fixture) => {
  let extractedIngredients: { name: string; qty: number | null; unit: string | null }[] = [];

  it(`extracts ≥ ${fixture.expectMinIngredients} ingredients with es-AR names`, async () => {
    const out = await extract({ text: fixture.text });
    extractedIngredients = out.ingredients;
    expect(out.label).toBeTruthy();
    expect(out.ingredients.length).toBeGreaterThanOrEqual(fixture.expectMinIngredients);
    // es-AR sanity: at least one ingredient name should be lowercase Spanish-friendly
    // (we don't assert specific words because translation latitude is wide; we just
    // check we're not getting English back through the pipeline).
    const names = out.ingredients.map((i) => i.name.toLowerCase()).join(' ');
    // Negative assertion: should NOT be entirely English when input was Spanish/French.
    if (fixture.language !== 'en') {
      expect(names).not.toMatch(/\b(flour|butter|milk|onion|chicken|egg)s?\b/);
    }
  });

  it('aggregator returns supermarket-friendly units only (g | kg | ml | L | unidad | null)', async () => {
    const recipe: Recipe = {
      id: `r-${fixture.language}`,
      label: fixture.name,
      source: { kind: 'manual' },
      ingredients: extractedIngredients.map((i, idx) => ({
        id: `i-${idx}`,
        text: `${i.qty ?? ''} ${i.unit ?? ''} ${i.name}`.trim(),
        qty: i.qty,
        unit: i.unit,
      })),
      createdAt: 1,
    };

    const out = await resolve({ store: STORES.jumbo, recipes: [recipe], preferences: '' });

    // Aggregator output (= matched + unmatched ingredient lists) must use only
    // the allowed units. This catches "tazas", "cucharadas", "cdita", "cup",
    // "tbsp" leaking through from extract.
    const allIngredients = [...out.matched.map((m) => m.ingredient), ...out.unmatched];
    for (const ing of allIngredients) {
      const u = ing.unit?.toLowerCase() ?? null;
      expect(ALLOWED_UNITS).toContain(u);
    }

    // Pantry staples should land in skipped[] when present in the recipe.
    const inputHasStaple = PANTRY_STAPLE_PATTERNS.some((re) => extractedIngredients.some((i) => re.test(i.name)));
    if (inputHasStaple) {
      expect(out.skipped.length).toBeGreaterThan(0);
    }

    // Save resolved output for the next test in the chain.
    (fixture as Fixture & { __resolveOutput: typeof out }).__resolveOutput = out;
  });

  it('every matched item has cartQty as a small integer (1–10) and the URL qty matches', async () => {
    const out = (fixture as Fixture & { __resolveOutput: Awaited<ReturnType<typeof resolve>> }).__resolveOutput;
    expect(out).toBeDefined();
    expect(out.matched.length).toBeGreaterThan(0);

    for (const m of out.matched) {
      expect(Number.isInteger(m.cartQty)).toBe(true);
      expect(m.cartQty).toBeGreaterThanOrEqual(1);
      // Hard upper bound: a single recipe should never need more than 10
      // packages of anything. This is the regression guard: pre-fix, "500 g
      // harina" produced cartQty=500. If this fires we've regressed.
      expect(m.cartQty).toBeLessThanOrEqual(10);
    }

    // URL qtys must mirror cartQty.
    const url = new URL(out.redirectUrl);
    const skus = url.searchParams.getAll('sku');
    const qtys = url.searchParams.getAll('qty');
    expect(skus).toHaveLength(out.matched.length);
    for (let i = 0; i < skus.length; i++) {
      const matchedItem = out.matched.find((m) => m.picked.skuId === skus[i]);
      expect(matchedItem).toBeDefined();
      expect(Number.parseInt(qtys[i] ?? '0', 10)).toBe(matchedItem!.cartQty);
    }
  });
});
