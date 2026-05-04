/**
 * @jest-environment node
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('../client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));

import { generateObject } from 'ai';
import { extract } from '../extract';

const mockGenerate = generateObject as jest.MockedFunction<typeof generateObject>;

beforeEach(() => mockGenerate.mockReset());

describe('extract', () => {
  it('passes html to generateObject and returns the parsed result', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: {
        label: 'Pasta carbonara',
        ingredients: [
          { name: 'spaghetti', qty: 200, unit: 'g' },
          { name: 'huevo', qty: 2, unit: null },
        ],
        isLoose: false,
      },
    } as never);

    const result = await extract({ html: '<html>recipe</html>' });

    expect(result.label).toBe('Pasta carbonara');
    expect(result.ingredients).toHaveLength(2);
    expect(result.isLoose).toBe(false);
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('<html>recipe</html>');
    expect(args.prompt.toLowerCase()).toContain('es-ar');
  });

  it('passes plain text and may set isLoose: true on a short phrase', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: { label: 'yerba', ingredients: [{ name: 'yerba', qty: null, unit: null }], isLoose: true },
    } as never);

    const result = await extract({ text: 'yerba' });

    expect(result.isLoose).toBe(true);
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('yerba');
    expect(args.prompt).not.toContain('<html>');
  });

  it('rejects when neither html nor text is provided', async () => {
    await expect(extract({} as never)).rejects.toThrow(/requires/i);
  });

  it('wraps AI SDK failures as LLM_FAILED', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('rate limit'));
    await expect(extract({ text: 'foo' })).rejects.toThrow(/LLM_FAILED.*rate limit/);
  });
});
