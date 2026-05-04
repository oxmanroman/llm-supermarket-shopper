/**
 * @jest-environment node
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('../client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));

import { generateObject } from 'ai';
import { pickSkus } from '../match';

const mockGenerate = generateObject as jest.MockedFunction<typeof generateObject>;

beforeEach(() => mockGenerate.mockReset());

const ingredient = { name: 'leche', qty: 1, unit: 'L' };
const candidates = [
  { skuId: '1', productId: 'p1', name: 'Leche entera 1L', price: 800, available: true },
  { skuId: '2', productId: 'p2', name: 'Leche descremada 1L', price: 850, available: true },
];

describe('pickSkus', () => {
  it('builds the prompt without a preferences block when prefs is empty and returns picks', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: [{ ingredientIndex: 0, pickedSkuId: '1', confidence: 'high', reason: 'whole milk match' }],
    } as never);

    const result = await pickSkus({ ingredients: [ingredient], candidates: [candidates], preferences: '' });

    expect(result).toEqual([{ ingredientIndex: 0, pickedSkuId: '1', confidence: 'high', reason: 'whole milk match' }]);
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('"name": "leche"');
    expect(args.prompt).toContain('"skuId": "1"');
    expect(args.prompt.toLowerCase()).not.toContain('user preferences');
  });

  it('includes preferences block in the prompt when prefs is non-empty', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: [{ ingredientIndex: 0, pickedSkuId: '2', confidence: 'high', reason: 'lactose-free pref' }],
    } as never);

    await pickSkus({
      ingredients: [ingredient],
      candidates: [candidates],
      preferences: 'prefer lactose-free dairy',
    });

    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('USER PREFERENCES');
    expect(args.prompt).toContain('prefer lactose-free dairy');
  });

  it('rethrows AI SDK failures wrapped as LLM_FAILED', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('boom'));
    await expect(pickSkus({ ingredients: [ingredient], candidates: [candidates], preferences: '' })).rejects.toThrow(
      /LLM_FAILED.*boom/,
    );
  });
});
