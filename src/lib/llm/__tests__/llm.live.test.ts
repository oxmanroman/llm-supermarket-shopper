/**
 * @jest-environment node
 */
import { extract } from '../extract';

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
});
