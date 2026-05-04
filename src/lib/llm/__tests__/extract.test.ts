/**
 * @jest-environment node
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('../client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));

import { generateObject } from 'ai';
import { extractIngredients } from '../extract';

const mockGenerate = generateObject as jest.MockedFunction<typeof generateObject>;

beforeEach(() => mockGenerate.mockReset());

describe('extractIngredients', () => {
  it('passes the html to generateObject and returns the parsed ingredient list', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: [
        { name: 'manteca', qty: 200, unit: 'g' },
        { name: 'huevo', qty: 2, unit: null },
      ],
    } as never);

    const result = await extractIngredients('<html>recipe HTML</html>');

    expect(result).toEqual([
      { name: 'manteca', qty: 200, unit: 'g' },
      { name: 'huevo', qty: 2, unit: null },
    ]);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const args = mockGenerate.mock.calls[0][0] as { model: unknown; prompt: string; schema: unknown };
    expect(args.model).toBe('mocked-model');
    expect(args.prompt).toContain('<html>recipe HTML</html>');
    expect(args.prompt.toLowerCase()).toContain('es-ar');
  });

  it('rethrows AI SDK failures wrapped as LLM_FAILED', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('rate limit'));
    await expect(extractIngredients('<html></html>')).rejects.toThrow(/LLM_FAILED.*rate limit/);
  });
});
