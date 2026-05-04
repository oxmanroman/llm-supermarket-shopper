/** @jest-environment jsdom */
import { readPlan, writePlan, mutatePlan, KEY } from '../plan';

beforeEach(() => localStorage.clear());

describe('plan storage', () => {
  it('returns an empty plan when nothing is stored and no v2 keys exist', () => {
    const plan = readPlan();
    expect(plan.version).toBe(3);
    expect(plan.recipes).toEqual([]);
    expect(plan.preferences).toBe('');
    expect(plan.lastStoreId).toBeNull();
  });

  it('migrates v2 keys on first read: ports preferences, deletes carts/store', () => {
    localStorage.setItem('preferences', 'prefer lactose-free dairy');
    localStorage.setItem('cart:jumbo', '[{"skuId":"1"}]');
    localStorage.setItem('cart:carrefour', '[{"skuId":"2"}]');
    localStorage.setItem('store', 'jumbo');

    const plan = readPlan();

    expect(plan.preferences).toBe('prefer lactose-free dairy');
    expect(plan.recipes).toEqual([]);
    expect(localStorage.getItem('cart:jumbo')).toBeNull();
    expect(localStorage.getItem('cart:carrefour')).toBeNull();
    expect(localStorage.getItem('store')).toBeNull();
    expect(localStorage.getItem('preferences')).toBeNull();
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('does not re-run migration when plan:v3 already exists', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 3, recipes: [], preferences: 'kept', lastStoreId: 'carrefour' }),
    );
    localStorage.setItem('preferences', 'should-be-ignored');

    const plan = readPlan();

    expect(plan.preferences).toBe('kept');
    expect(plan.lastStoreId).toBe('carrefour');
    expect(localStorage.getItem('preferences')).toBe('should-be-ignored');
  });

  it('round-trips a written plan', () => {
    const plan = {
      version: 3 as const,
      recipes: [
        {
          id: 'r1',
          label: 'Empanadas',
          source: { kind: 'url' as const, url: 'https://e.test', status: 'ready' as const },
          ingredients: [{ id: 'i1', text: 'pollo', qty: 200, unit: 'g' }],
          createdAt: 1,
        },
      ],
      preferences: '',
      lastStoreId: null,
    };
    writePlan(plan);
    expect(readPlan()).toEqual(plan);
  });

  it('mutatePlan applies the function and persists', () => {
    mutatePlan((p) => {
      p.preferences = 'updated';
      return p;
    });
    expect(readPlan().preferences).toBe('updated');
  });

  it('returns an empty plan on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not json');
    const plan = readPlan();
    expect(plan.recipes).toEqual([]);
  });
});
