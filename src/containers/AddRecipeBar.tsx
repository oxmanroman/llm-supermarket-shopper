'use client';

import { useState } from 'react';
import { Box, Button, CircularProgress, TextField } from '@mui/material';

type Props = {
  onSubmit: (input: { url: string } | { text: string }) => Promise<void>;
};

const URL_RE = /^https?:\/\/\S+$/i;

export const AddRecipeBar = ({ onSubmit }: Props) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const handle = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const input = URL_RE.test(trimmed) ? { url: trimmed } : { text: trimmed };
      await onSubmit(input);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component='form' onSubmit={handle} sx={{ display: 'flex', gap: 1, mb: 3 }}>
      <TextField
        fullWidth
        multiline
        maxRows={6}
        placeholder='Pegá una URL de receta o escribí lo que querés cocinar'
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputProps={{ 'data-testid': 'add-input' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !value.includes('\n')) {
            void handle(e);
          }
        }}
      />
      <Button
        type='submit'
        variant='contained'
        disabled={!value.trim() || busy}
        startIcon={busy ? <CircularProgress size={16} color='inherit' /> : undefined}
        data-testid='add-submit'
      >
        Agregar
      </Button>
    </Box>
  );
};
