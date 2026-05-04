'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Box, Container, IconButton, Typography } from '@mui/material';
import { CheckoutHandedOff, CheckoutLoading, CheckoutResolution, CheckoutStoreSelect, Navbar } from '~/containers';
import { usePlan } from '~/hooks';
import type { StoreId } from '~/lib/vtex/types';
import type { Resolution } from '~/types/plan';

export default function CheckoutPage() {
  const router = useRouter();
  const { plan, hydrated, update } = usePlan();

  useEffect(() => {
    if (hydrated && plan.recipes.every((r) => r.ingredients.length === 0)) {
      router.replace('/');
    }
  }, [hydrated, plan.recipes, router]);

  if (!hydrated) return null;

  const startResolution = (storeId: StoreId) => {
    update((p) => ({
      ...p,
      lastStoreId: storeId,
      lastResolution: { state: 'aggregating', storeId, startedAt: Date.now() },
    }));
  };

  const back = () => {
    update((p) => ({ ...p, lastResolution: { state: 'idle' } }));
  };

  const resolution = plan.lastResolution as Resolution | undefined;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <Container maxWidth='md' sx={{ py: 4, flexGrow: 1, width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <IconButton onClick={() => router.push('/')} aria-label='Volver al plan'>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant='subtitle2' color='text.secondary' sx={{ ml: 1 }}>
            Volver al plan
          </Typography>
        </Box>

        {(!resolution || resolution.state === 'idle') && (
          <CheckoutStoreSelect initialStoreId={plan.lastStoreId} onContinue={startResolution} />
        )}
        {resolution &&
          (resolution.state === 'aggregating' ||
            resolution.state === 'searching' ||
            resolution.state === 'matching') && <CheckoutLoading />}
        {resolution && resolution.state === 'ready' && <CheckoutResolution onBack={back} />}
        {resolution && resolution.state === 'handed-off' && <CheckoutHandedOff />}
      </Container>
    </Box>
  );
}
