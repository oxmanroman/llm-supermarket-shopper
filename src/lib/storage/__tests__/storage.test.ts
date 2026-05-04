/** @jest-environment jsdom */
import { readCart, writeCart, clearCart } from '../cart';
import { readStore, writeStore, clearStore } from '../store';

beforeEach(() => localStorage.clear());

describe('cart storage', () => {
  it('returns [] when nothing stored', () => {
    expect(readCart('jumbo')).toEqual([]);
  });

  it('round-trips items per store', () => {
    writeCart('jumbo', [{ skuId: '1', qty: 2, name: 'milk', price: 100 }]);
    writeCart('carrefour', [{ skuId: '9', qty: 1, name: 'rice', price: 200 }]);
    expect(readCart('jumbo')).toEqual([{ skuId: '1', qty: 2, name: 'milk', price: 100 }]);
    expect(readCart('carrefour')).toEqual([{ skuId: '9', qty: 1, name: 'rice', price: 200 }]);
  });

  it('clearCart wipes only the given store', () => {
    writeCart('jumbo', [{ skuId: '1', qty: 1, name: 'a', price: 1 }]);
    writeCart('carrefour', [{ skuId: '2', qty: 1, name: 'b', price: 2 }]);
    clearCart('jumbo');
    expect(readCart('jumbo')).toEqual([]);
    expect(readCart('carrefour')).toHaveLength(1);
  });

  it('returns [] on corrupt JSON', () => {
    localStorage.setItem('cart:jumbo', '{not json');
    expect(readCart('jumbo')).toEqual([]);
  });
});

describe('store storage', () => {
  it('returns null when nothing stored', () => {
    expect(readStore()).toBeNull();
  });

  it('round-trips a store id', () => {
    writeStore('carrefour');
    expect(readStore()).toBe('carrefour');
  });

  it('returns null on invalid stored value', () => {
    localStorage.setItem('store', 'spar');
    expect(readStore()).toBeNull();
  });

  it('clearStore wipes the value', () => {
    writeStore('jumbo');
    clearStore();
    expect(readStore()).toBeNull();
  });
});
