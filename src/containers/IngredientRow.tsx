'use client';

import { useState } from 'react';
import DeleteIcon from '@mui/icons-material/Delete';
import { Box, Chip, IconButton, TextField, Typography } from '@mui/material';
import type { IngredientLine } from '~/types/plan';

type Props = {
  line: IngredientLine;
  onChange: (next: IngredientLine) => void;
  onRemove: () => void;
};

export const IngredientRow = ({ line, onChange, onRemove }: Props) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text);
  const qtyLabel = line.qty != null ? `${line.qty}${line.unit ? ' ' + line.unit : ''}` : (line.unit ?? '');

  const commit = () => {
    const next = draft.trim();
    if (next && next !== line.text) onChange({ ...line, text: next });
    setEditing(false);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }} data-testid={`ingredient-${line.id}`}>
      {editing ? (
        <TextField
          size='small'
          fullWidth
          // eslint-disable-next-line jsx-a11y/no-autofocus -- inline edit: focusing the field the user just clicked into is the expected interaction
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(line.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <Typography variant='body2' sx={{ flexGrow: 1, cursor: 'text' }} onClick={() => setEditing(true)}>
          {line.text}
        </Typography>
      )}
      {qtyLabel && <Chip size='small' label={qtyLabel} />}
      <IconButton size='small' onClick={onRemove} aria-label='Quitar ingrediente'>
        <DeleteIcon fontSize='small' />
      </IconButton>
    </Box>
  );
};
