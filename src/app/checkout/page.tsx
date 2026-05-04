'use client';

import { useEffect, useRef } from 'react';
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
  const inFlight = useRef(false);

  useEffect(() => {
    if (hydrated && plan.recipes.every((r) => r.ingredients.length === 0)) {
      router.replace('/');
    }
  }, [hydrated, plan.recipes, router]);

  // Fire the resolve call when state is 'aggregating'.
  useEffect(() => {
    const r = plan.lastResolution as Resolution | undefined;
    if (!hydrated || !r || r.state !== 'aggregating') return;
    if (inFlight.current) return;
    inFlight.current = true;

    const storeId = r.storeId;
    fetch('/api/checkout/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: storeId,
        recipes: plan.recipes,
        preferences: plan.preferences,
      }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        update((p) => ({
          ...p,
          lastResolution: {
            state: 'ready',
            storeId,
            matched: body.matched,
            unmatched: body.unmatched,
            skipped: body.skipped,
            candidates: body.candidates,
            redirectUrl: body.redirectUrl,
          },
        }));
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : 'unknown error';
        update((p) => ({
          ...p,
          lastResolution: { state: 'error', storeId, failedAt: 'aggregate', message },
        }));
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [hydrated, plan, update]);

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

  const retry = () => {
    const r = plan.lastResolution as Resolution | undefined;
    if (!r || r.state !== 'error') return;
    update((p) => ({
      ...p,
      lastResolution: { state: 'aggregating', storeId: r.storeId, startedAt: Date.now() },
    }));
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
            resolution.state === 'matching') && <CheckoutLoading state={resolution.state} />}
        {resolution && resolution.state === 'error' && (
          <CheckoutLoading error={{ message: resolution.message, onRetry: retry }} />
        )}
        {resolution && resolution.state === 'ready' && <CheckoutResolution onBack={back} />}
        {resolution && resolution.state === 'handed-off' && <CheckoutHandedOff />}
      </Container>
    </Box>
  );
}
