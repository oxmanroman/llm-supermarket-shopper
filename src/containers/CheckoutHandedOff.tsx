'use client';

import { useRouter } from 'next/navigation';
import { Box, Button, Stack, Typography } from '@mui/material';
import { usePlan } from '~/hooks';
import { STORES } from '~/lib/vtex/stores';
import type { Resolution } from '~/types/plan';

export const CheckoutHandedOff = () => {
  const router = useRouter();
  const { plan, update } = usePlan();
  const r = plan.lastResolution as Resolution | undefined;
  if (!r || r.state !== 'handed-off') return null;
  const store = STORES[r.storeId];

  const clearPlan = () => {
    update((p) => ({ ...p, recipes: [], lastResolution: { state: 'idle' } }));
    router.push('/');
  };

  return (
    <Stack spacing={3} sx={{ py: 4 }} alignItems='center'>
      <Typography variant='h6'>Lista enviada a {store.name}.</Typography>
      <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'center', maxWidth: 480 }}>
        El supermercado se abrió en una nueva pestaña con todos los productos en tu carrito. Cuando termines la compra,
        podés vaciar el plan para empezar otra semana.
      </Typography>
      <Box>
        <Button variant='contained' onClick={clearPlan} data-testid='clear-plan'>
          Vaciar plan
        </Button>
      </Box>
    </Stack>
  );
};
