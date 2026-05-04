/** @jest-environment jsdom */
import { readPrefs, writePrefs, clearPrefs } from '../preferences';

beforeEach(() => localStorage.clear());

describe('preferences storage', () => {
  it('returns "" when nothing stored', () => {
    expect(readPrefs()).toBe('');
  });

  it('round-trips a string', () => {
    writePrefs('prefer lactose-free dairy');
    expect(readPrefs()).toBe('prefer lactose-free dairy');
  });

  it('writePrefs trims whitespace', () => {
    writePrefs('   prefer X   ');
    expect(readPrefs()).toBe('prefer X');
  });

  it('clearPrefs wipes the value', () => {
    writePrefs('foo');
    clearPrefs();
    expect(readPrefs()).toBe('');
  });

  it('readPrefs returns "" on a missing localStorage', () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    try {
      expect(readPrefs()).toBe('');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  });
});
