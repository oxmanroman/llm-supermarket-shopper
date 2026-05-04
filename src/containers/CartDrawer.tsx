'use client';

import { useState } from 'react';
import DeleteIcon from '@mui/icons-material/Delete';
import { Alert, Box, Button, Drawer, IconButton, Stack, TextField, Typography } from '@mui/material';
import type { CartItem, Store } from '~/lib/vtex/types';

type Props = {
  open: boolean;
  onClose: () => void;
  store: Store;
  items: CartItem[];
  total: number;
  onSetQty: (skuId: string, qty: number) => void;
  onRemove: (skuId: string) => void;
};

export const CartDrawer = ({ open, onClose, store, items, total, onSetQty, onRemove }: Props) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkout = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: store.id,
          items: items.map((i) => ({ skuId: i.skuId, qty: i.qty })),
        }),
      });
      const body = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok || !body.redirectUrl) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.location.href = body.redirectUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
      setSubmitting(false);
    }
  };

  return (
    <Drawer anchor='right' open={open} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: 380 }, p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Typography variant='h6' sx={{ mb: 2 }}>
          Your cart · {store.name}
        </Typography>

        {items.length === 0 ? (
          <Typography variant='body2' color='text.secondary'>
            Cart is empty.
          </Typography>
        ) : (
          <Stack spacing={2} sx={{ flexGrow: 1, overflowY: 'auto' }} data-testid='cart-items'>
            {items.map((i) => (
              <Box
                key={i.skuId}
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                data-testid={`cart-item-${i.skuId}`}
              >
                {i.imageUrl && (
                  <Box component='img' src={i.imageUrl} alt='' sx={{ width: 48, height: 48, objectFit: 'contain' }} />
                )}
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant='body2'>{i.name}</Typography>
                  <Typography variant='caption' color='text.secondary'>
                    ${i.price.toLocaleString('es-AR')}
                  </Typography>
                </Box>
                <TextField
                  type='number'
                  size='small'
                  value={i.qty}
                  onChange={(e) => onSetQty(i.skuId, Number.parseInt(e.target.value, 10) || 0)}
                  inputProps={{ min: 0, style: { width: 48 }, 'data-testid': `qty-${i.skuId}` }}
                />
                <IconButton onClick={() => onRemove(i.skuId)} aria-label='Remove'>
                  <DeleteIcon />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}

        {error && (
          <Alert severity='error' sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction='row' justifyContent='space-between' sx={{ mb: 2 }}>
            <Typography variant='subtitle1'>Total</Typography>
            <Typography variant='subtitle1'>${total.toLocaleString('es-AR')}</Typography>
          </Stack>
          <Button
            fullWidth
            variant='contained'
            disabled={items.length === 0 || submitting}
            onClick={checkout}
            data-testid='checkout-button'
          >
            {submitting ? 'Redirecting…' : `Send to ${store.name}`}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
};
