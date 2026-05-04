'use client';

import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';

const labelFor = (state: string): string => {
  if (state === 'aggregating') return 'Unificando ingredientes…';
  if (state === 'searching') return 'Buscando productos…';
  if (state === 'matching') return 'Eligiendo productos…';
  return 'Procesando…';
};

type Props = {
  state?: string;
  error?: { message: string; onRetry: () => void };
};

export const CheckoutLoading = ({ state = 'aggregating', error }: Props) => {
  if (error) {
    return (
      <Box sx={{ py: 6 }}>
        <Alert
          severity='error'
          action={
            <Button color='inherit' size='small' onClick={error.onRetry}>
              Reintentar
            </Button>
          }
        >
          {error.message}
        </Alert>
      </Box>
    );
  }
  return (
    <Stack alignItems='center' spacing={2} sx={{ py: 6 }}>
      <CircularProgress />
      <Typography variant='body2' color='text.secondary'>
        {labelFor(state)}
      </Typography>
    </Stack>
  );
};
