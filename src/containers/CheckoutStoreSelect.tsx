'use client';

import { useState } from 'react';
import { Box, Button, Card, CardActionArea, Stack, Typography } from '@mui/material';
import { STORES, STORE_IDS } from '~/lib/vtex/stores';
import type { StoreId } from '~/lib/vtex/types';

type Props = {
  initialStoreId: StoreId | null;
  onContinue: (storeId: StoreId) => void;
};

export const CheckoutStoreSelect = ({ initialStoreId, onContinue }: Props) => {
  const [chosen, setChosen] = useState<StoreId | null>(initialStoreId);
  return (
    <Box>
      <Typography variant='h6' sx={{ mb: 2 }}>
        ¿Dónde comprás?
      </Typography>
      <Stack direction='row' spacing={2} sx={{ mb: 3 }}>
        {STORE_IDS.map((id) => (
          <Card
            key={id}
            variant={chosen === id ? 'elevation' : 'outlined'}
            sx={{
              flex: 1,
              borderColor: chosen === id ? 'primary.main' : undefined,
              borderWidth: chosen === id ? 2 : 1,
            }}
          >
            <CardActionArea onClick={() => setChosen(id)} data-testid={`store-tile-${id}`}>
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant='h6'>{STORES[id].name}</Typography>
              </Box>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
      <Button
        variant='contained'
        disabled={!chosen}
        onClick={() => chosen && onContinue(chosen)}
        data-testid='store-continue'
      >
        Continuar
      </Button>
    </Box>
  );
};
