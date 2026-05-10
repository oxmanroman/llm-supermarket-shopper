/**
 * @jest-environment node
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('~/lib/llm/client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));

import { generateObject } from 'ai';
import { aggregate } from '../aggregate';

const mockGenerate = generateObject as jest.MockedFunction<typeof generateObject>;

beforeEach(() => mockGenerate.mockReset());

const empanadas = {
  id: 'r1',
  label: 'Empanadas de pollo',
  source: { kind: 'url' as const, url: 'x', status: 'ready' as const },
  ingredients: [
    { id: 'i1', text: '1 cebolla', qty: 1, unit: null },
    { id: 'i2', text: '200 g pollo', qty: 200, unit: 'g' },
    { id: 'i3', text: 'sal a gusto', qty: null, unit: null },
  ],
  createdAt: 1,
};
const tarta = {
  id: 'r2',
  label: 'Tarta de espinaca',
  source: { kind: 'manual' as const },
  ingredients: [
    { id: 'i4', text: '1 cebolla', qty: 1, unit: null },
    { id: 'i5', text: '1 paquete de espinaca', qty: 1, unit: 'paquete' },
  ],
  createdAt: 2,
};

describe('aggregate', () => {
  it('passes recipes + preferences to the LLM and returns parsed output', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: {
        aggregated: [
          {
            id: 'a1',
            name: 'cebolla',
            qty: 2,
            unit: null,
            sources: [
              { recipeId: 'r1', recipeLabel: 'Empanadas de pollo', originalText: '1 cebolla' },
              { recipeId: 'r2', recipeLabel: 'Tarta de espinaca', originalText: '1 cebolla' },
            ],
          },
          {
            id: 'a2',
            name: 'pollo',
            qty: 200,
            unit: 'g',
            sources: [{ recipeId: 'r1', recipeLabel: 'Empanadas de pollo', originalText: '200 g pollo' }],
          },
          {
            id: 'a3',
            name: 'espinaca',
            qty: 1,
            unit: 'paquete',
            sources: [{ recipeId: 'r2', recipeLabel: 'Tarta de espinaca', originalText: '1 paquete de espinaca' }],
          },
        ],
        skipped: [{ name: 'sal', reason: 'pantry staple' }],
        recipeSummaries: [
          {
            recipeId: 'r1',
            dish: 'empanadas de pollo',
            cuisine: 'argentina',
            notes: 'tapas para empanadas obligatorias',
          },
          { recipeId: 'r2', dish: 'tarta de espinaca', cuisine: 'argentina', notes: '' },
        ],
      },
    } as never);

    const result = await aggregate({ recipes: [empanadas, tarta], preferences: '' });

    expect(result.aggregated).toHaveLength(3);
    expect(result.skipped).toHaveLength(1);
    expect(result.aggregated[0].sources).toHaveLength(2);
    expect(result.recipeSummaries).toHaveLength(2);
    expect(result.recipeSummaries[0]).toEqual({
      recipeId: 'r1',
      dish: 'empanadas de pollo',
      cuisine: 'argentina',
      notes: 'tapas para empanadas obligatorias',
    });
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('Empanadas de pollo');
    expect(args.prompt).toContain('Tarta de espinaca');
    expect(args.prompt.toLowerCase()).toContain('skipped');
    expect(args.prompt.toLowerCase()).toContain('cup');
    expect(args.prompt.toLowerCase()).toContain('unidad');
    // The prompt must instruct the LLM to also produce per-recipe summaries
    // for the matcher agent downstream.
    expect(args.prompt.toLowerCase()).toContain('recipesummaries');
    expect(args.prompt.toLowerCase()).toContain('dish');
    expect(args.prompt.toLowerCase()).toContain('cuisine');
  });

  it('includes preferences block in the prompt when non-empty', async () => {
    mockGenerate.mockResolvedValueOnce({ object: { aggregated: [], skipped: [], recipeSummaries: [] } } as never);
    await aggregate({ recipes: [empanadas], preferences: 'siempre comprar sal' });
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('USER PREFERENCES');
    expect(args.prompt).toContain('siempre comprar sal');
  });

  it('omits preferences block when empty', async () => {
    mockGenerate.mockResolvedValueOnce({ object: { aggregated: [], skipped: [], recipeSummaries: [] } } as never);
    await aggregate({ recipes: [empanadas], preferences: '' });
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt.toLowerCase()).not.toContain('user preferences');
  });

  it('wraps AI SDK failures as LLM_FAILED', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('boom'));
    await expect(aggregate({ recipes: [empanadas], preferences: '' })).rejects.toThrow(/LLM_FAILED.*boom/);
  });

  it('skips recipes with source.status !== "ready"', async () => {
    mockGenerate.mockResolvedValueOnce({ object: { aggregated: [], skipped: [], recipeSummaries: [] } } as never);
    const errored = {
      ...empanadas,
      id: 'r3',
      source: { kind: 'url' as const, url: 'x', status: 'error' as const, error: 'boom' },
    };
    await aggregate({ recipes: [empanadas, errored], preferences: '' });
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    // Errored recipe id MUST NOT appear in the prompt.
    expect(args.prompt).not.toContain(errored.id);
    expect(args.prompt).toContain(empanadas.id);
  });
});
