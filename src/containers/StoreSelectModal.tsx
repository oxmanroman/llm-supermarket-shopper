'use client';

import { Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { STORES, STORE_IDS } from '~/lib/vtex/stores';
import type { StoreId } from '~/lib/vtex/types';

type Props = {
  open: boolean;
  onSelect: (storeId: StoreId) => void;
};

export const StoreSelectModal = ({ open, onSelect }: Props) => {
  return (
    <Dialog open={open} disableEscapeKeyDown fullWidth maxWidth='xs'>
      <DialogTitle>Choose your supermarket</DialogTitle>
      <DialogContent>
        <Typography variant='body2' sx={{ mb: 2 }}>
          {`Pick where you'd like to shop. You can change it later from the navbar — switching will clear your cart.`}
        </Typography>
        <Stack spacing={1.5}>
          {STORE_IDS.map((id) => (
            <Button
              key={id}
              variant='contained'
              size='large'
              fullWidth
              onClick={() => onSelect(id)}
              data-testid={`select-store-${id}`}
            >
              {STORES[id].name}
            </Button>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
};
