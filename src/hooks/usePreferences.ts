'use client';

import { useCallback, useEffect, useState } from 'react';
import { readPrefs, writePrefs } from '~/lib/storage/preferences';

export function usePreferences() {
  const [prefs, setPrefsState] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefsState(readPrefs());
    setHydrated(true);
  }, []);

  const setPrefs = useCallback((text: string) => {
    writePrefs(text);
    setPrefsState(text.trim());
  }, []);

  return { prefs, setPrefs, hydrated };
}
