/**
 * @jest-environment node
 */
import { extract } from '../extract';
import { pickSkus } from '../match';

jest.setTimeout(60_000);

const live = process.env.LIVE_TESTS === '1' && Boolean(process.env.OPENROUTER_API_KEY);
const liveDescribe = live ? describe : describe.skip;

const SAMPLE_RECIPE_HTML = `
  <html><body>
    <h1>Pasta carbonara para 2 personas</h1>
    <h2>Ingredientes</h2>
    <ul>
      <li>200 g de spaghetti</li>
      <li>100 g de panceta</li>
      <li>2 huevos</li>
      <li>50 g de queso parmesano rallado</li>
      <li>Sal y pimienta a gusto</li>
    </ul>
  </body></html>
`;

liveDescribe('live LLM integration', () => {
  it('extracts ingredients from a small Spanish recipe', async () => {
    const result = await extract({ html: SAMPLE_RECIPE_HTML });
    expect(result.ingredients.length).toBeGreaterThanOrEqual(4);
    const names = result.ingredients.map((i) => i.name.toLowerCase());
    expect(names.some((n) => n.includes('spaghetti') || n.includes('fideo') || n.includes('pasta'))).toBe(true);
    expect(names.some((n) => n.includes('huevo'))).toBe(true);
  });

  it('picks SKUs and honors a non-empty preference', async () => {
    const ingredients = [{ name: 'leche', qty: 1, unit: 'L' as const }];
    const candidates = [
      [
        { skuId: 'sku-whole', productId: 'pw', name: 'Leche entera 1L', price: 900, available: true },
        { skuId: 'sku-skim', productId: 'ps', name: 'Leche descremada 1L', price: 900, available: true },
        { skuId: 'sku-lac', productId: 'pl', name: 'Leche deslactosada 1L', price: 950, available: true },
      ],
    ];

    const lactosePicks = await pickSkus({
      ingredients,
      candidates,
      preferences: 'I am lactose intolerant; prefer lactose-free dairy',
    });
    expect(lactosePicks).toHaveLength(1);
    expect(lactosePicks[0].pickedSkuId).toBe('sku-lac');

    const noPrefsPicks = await pickSkus({ ingredients, candidates, preferences: '' });
    expect(noPrefsPicks).toHaveLength(1);
    expect(['sku-whole', 'sku-skim', 'sku-lac']).toContain(noPrefsPicks[0].pickedSkuId);
  });
});
