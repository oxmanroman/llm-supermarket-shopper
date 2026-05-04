'use client';

import { useMemo, useState } from 'react';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { usePlan } from '~/hooks';
import { recomputeRedirectUrl } from '~/lib/checkout/resolve';
import { STORES } from '~/lib/vtex/stores';
import type { Product } from '~/lib/vtex/types';
import type { AggregatedIngredient, Resolution, SkippedIngredient } from '~/types/plan';
import { ProductSearch } from './ProductSearch';

type Props = { onBack: () => void };

type ReadyResolution = Extract<Resolution, { state: 'ready' }>;

export const CheckoutResolution = ({ onBack }: Props) => {
  const { plan, update } = usePlan();
  const r = plan.lastResolution as ReadyResolution | undefined;
  const [swapOpenFor, setSwapOpenFor] = useState<string | null>(null);

  const total = useMemo(() => {
    if (!r) return 0;
    return r.matched.reduce((sum, m) => sum + m.picked.price * Math.max(1, Math.round(m.ingredient.qty ?? 1)), 0);
  }, [r]);

  if (!r || r.state !== 'ready') return null;
  const store = STORES[r.storeId];

  const apply = (fn: (curr: ReadyResolution) => ReadyResolution) => {
    update((p) => {
      const curr = p.lastResolution as ReadyResolution | undefined;
      if (!curr || curr.state !== 'ready') return p;
      const next = fn(curr);
      const redirectUrl = recomputeRedirectUrl(next.matched, store);
      return { ...p, lastResolution: { ...next, redirectUrl } };
    });
  };

  const swapMatched = (aggId: string, candidate: Product) => {
    apply((curr) => ({
      ...curr,
      matched: curr.matched.map((m) => (m.aggregatedId === aggId ? { ...m, picked: candidate } : m)),
    }));
    setSwapOpenFor(null);
  };

  const removeMatched = (aggId: string) => {
    apply((curr) => ({ ...curr, matched: curr.matched.filter((m) => m.aggregatedId !== aggId) }));
  };

  const setMatchedQty = (aggId: string, qty: number) => {
    if (!Number.isFinite(qty) || qty < 1) return;
    apply((curr) => ({
      ...curr,
      matched: curr.matched.map((m) => (m.aggregatedId === aggId ? { ...m, ingredient: { ...m.ingredient, qty } } : m)),
    }));
  };

  const promoteUnmatched = (aggId: string, picked: Product, ing: AggregatedIngredient) => {
    apply((curr) => ({
      ...curr,
      unmatched: curr.unmatched.filter((u) => u.id !== aggId),
      matched: [...curr.matched, { aggregatedId: aggId, ingredient: ing, picked, confidence: 'medium' }],
    }));
  };

  const dropUnmatched = (aggId: string) => {
    apply((curr) => ({ ...curr, unmatched: curr.unmatched.filter((u) => u.id !== aggId) }));
  };

  const promoteSkipped = (item: SkippedIngredient) => {
    apply((curr) => ({
      ...curr,
      skipped: curr.skipped.filter((s) => s.name !== item.name),
      unmatched: [...curr.unmatched, { id: crypto.randomUUID(), name: item.name, qty: null, unit: null, sources: [] }],
    }));
  };

  const sendToStore = () => {
    window.open(r.redirectUrl, '_blank', 'noopener');
    update((p) => ({
      ...p,
      lastResolution: {
        state: 'handed-off',
        storeId: r.storeId,
        matched: r.matched,
        redirectUrl: r.redirectUrl,
        handedOffAt: Date.now(),
      },
    }));
  };

  return (
    <Box>
      <Stack direction='row' justifyContent='space-between' alignItems='center' sx={{ mb: 2 }}>
        <Typography variant='h6'>
          ${total.toLocaleString('es-AR')} · {r.matched.length} productos
        </Typography>
        <Stack direction='row' spacing={1}>
          <Button onClick={onBack}>Volver</Button>
          <Button
            variant='contained'
            onClick={sendToStore}
            disabled={r.matched.length === 0}
            data-testid='send-to-store'
          >
            Enviar a {store.name}
          </Button>
        </Stack>
      </Stack>

      <Typography variant='subtitle1' sx={{ mb: 1 }}>
        Listo para enviar
      </Typography>
      <Stack spacing={1} sx={{ mb: 3 }}>
        {r.matched.length === 0 && (
          <Typography variant='body2' color='text.secondary'>
            (vacío)
          </Typography>
        )}
        {r.matched.map((m) => {
          const candidates = r.candidates[m.aggregatedId] ?? [];
          const others = candidates.filter((c) => c.skuId !== m.picked.skuId);
          const open = swapOpenFor === m.aggregatedId;
          return (
            <Card key={m.aggregatedId} variant='outlined' data-testid={`matched-${m.aggregatedId}`}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5 }}>
                {m.picked.imageUrl && (
                  <Box
                    component='img'
                    src={m.picked.imageUrl}
                    alt=''
                    sx={{ width: 48, height: 48, objectFit: 'contain' }}
                  />
                )}
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant='body2' sx={{ fontWeight: 500 }}>
                    {m.picked.name}
                  </Typography>
                  <Typography variant='caption' color='text.secondary'>
                    {m.ingredient.name} · de {m.ingredient.sources.map((s) => s.recipeLabel).join(', ') || '—'}
                  </Typography>
                </Box>
                <TextField
                  type='number'
                  size='small'
                  value={Math.max(1, Math.round(m.ingredient.qty ?? 1))}
                  onChange={(e) => setMatchedQty(m.aggregatedId, Number.parseInt(e.target.value, 10) || 1)}
                  inputProps={{ min: 1, style: { width: 56 }, 'data-testid': `qty-${m.aggregatedId}` }}
                />
                <Typography variant='body2' sx={{ minWidth: 80, textAlign: 'right' }}>
                  ${m.picked.price.toLocaleString('es-AR')}
                </Typography>
                <IconButton
                  size='small'
                  onClick={() => setSwapOpenFor(open ? null : m.aggregatedId)}
                  disabled={others.length === 0}
                  aria-label='Cambiar producto'
                  data-testid={`swap-${m.aggregatedId}`}
                >
                  <SwapHorizIcon fontSize='small' />
                </IconButton>
                <IconButton size='small' onClick={() => removeMatched(m.aggregatedId)} aria-label='Quitar'>
                  <DeleteIcon fontSize='small' />
                </IconButton>
              </CardContent>
              <Collapse in={open}>
                <Box sx={{ px: 2, pb: 2 }}>
                  <List dense>
                    {others.slice(0, 6).map((cand) => (
                      <ListItem
                        key={cand.skuId}
                        secondaryAction={
                          <Button
                            size='small'
                            variant='outlined'
                            onClick={() => swapMatched(m.aggregatedId, cand)}
                            data-testid={`swap-pick-${cand.skuId}`}
                          >
                            Usar este
                          </Button>
                        }
                      >
                        <ListItemText primary={cand.name} secondary={`$${cand.price.toLocaleString('es-AR')}`} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              </Collapse>
            </Card>
          );
        })}
      </Stack>

      {r.unmatched.length > 0 && (
        <>
          <Typography variant='subtitle1' sx={{ mb: 1 }}>
            No encontramos
          </Typography>
          <Stack spacing={1} sx={{ mb: 3 }}>
            {r.unmatched.map((u) => (
              <Card key={u.id} variant='outlined' data-testid={`unmatched-${u.id}`}>
                <CardContent>
                  <Stack direction='row' alignItems='center' spacing={1} sx={{ mb: 1 }}>
                    <Typography variant='body2' sx={{ flexGrow: 1, fontWeight: 500 }}>
                      {u.name}
                    </Typography>
                    <Button size='small' onClick={() => dropUnmatched(u.id)}>
                      Ignorar
                    </Button>
                  </Stack>
                  <ProductSearch
                    storeId={r.storeId}
                    initialQuery={u.name}
                    pickLabel='Usar este'
                    onPick={(p) => promoteUnmatched(u.id, p, u)}
                  />
                </CardContent>
              </Card>
            ))}
          </Stack>
        </>
      )}

      {r.skipped.length > 0 && (
        <Accordion variant='outlined'>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid='skipped-section'>
            <Typography variant='subtitle1'>Saltadas ({r.skipped.length})</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              {r.skipped.map((s) => (
                <Stack key={s.name} direction='row' alignItems='center' spacing={1}>
                  <Typography variant='body2' sx={{ flexGrow: 1 }}>
                    {s.name}
                  </Typography>
                  <Typography variant='caption' color='text.secondary'>
                    {s.reason}
                  </Typography>
                  <Button size='small' onClick={() => promoteSkipped(s)}>
                    Buscar igual
                  </Button>
                </Stack>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      {r.matched.length === 0 && r.unmatched.length === 0 && (
        <Alert severity='info'>No hay productos para enviar.</Alert>
      )}
    </Box>
  );
};
