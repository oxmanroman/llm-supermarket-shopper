'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';

type PreferencesDialogProps = {
  open: boolean;
  initialValue: string;
  onSave: (value: string) => void;
  onClose: () => void;
};

export const PreferencesDialog = ({ open, initialValue, onSave, onClose }: PreferencesDialogProps) => {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth='sm'>
      <DialogTitle>Shopping preferences</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Free text. Sent to the LLM when matching ingredients to products.
        </DialogContentText>
        <TextField
          // eslint-disable-next-line jsx-a11y/no-autofocus -- modal dialog: focusing the only input on open is the expected interaction
          autoFocus
          multiline
          minRows={4}
          fullWidth
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='e.g. prefer lactose-free dairy, prioritize La Serenísima brand, avoid spicy products'
          inputProps={{ 'data-testid': 'preferences-input' }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant='contained'
          onClick={() => {
            onSave(value);
            onClose();
          }}
          data-testid='preferences-save'
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};
