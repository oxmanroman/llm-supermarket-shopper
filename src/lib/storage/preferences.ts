const KEY = 'preferences';

export function readPrefs(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(KEY) ?? '';
}

export function writePrefs(text: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, text.trim());
}

export function clearPrefs(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
