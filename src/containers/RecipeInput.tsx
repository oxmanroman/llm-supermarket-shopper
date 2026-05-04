'use client';

import { useState } from 'react';
import { Box, Button, CircularProgress, TextField } from '@mui/material';
import { usePreferences } from '~/hooks/usePreferences';
import type { CartItem, StoreId } from '~/lib/vtex/types';

export type RecipeResult = { items: CartItem[]; unmatched: string[] };

type RecipeInputProps = {
  storeId: StoreId;
  onResult: (result: RecipeResult) => void;
  onError: (message: string) => void;
};

export const RecipeInput = ({ storeId, onResult, onError }: RecipeInputProps) => {
  const { prefs } = usePreferences();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, store: storeId, preferences: prefs }),
      });
      const body = (await res.json()) as RecipeResult & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onResult({ items: body.items ?? [], unmatched: body.unmatched ?? [] });
      setUrl('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Recipe processing failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component='form' onSubmit={submit} sx={{ display: 'flex', gap: 1, mb: 2 }}>
      <TextField
        fullWidth
        type='url'
        placeholder='Paste a recipe URL'
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        inputProps={{ 'data-testid': 'recipe-url-input' }}
      />
      <Button
        type='submit'
        variant='contained'
        disabled={!url.trim() || loading}
        data-testid='recipe-submit-button'
        startIcon={loading ? <CircularProgress size={16} color='inherit' /> : undefined}
      >
        {loading ? 'Reading recipe…' : 'Add recipe to cart'}
      </Button>
    </Box>
  );
};
