'use client';

import { useRouter } from 'next/navigation';
import { Box, Button, Typography } from '@mui/material';

type Props = {
  ingredientCount: number;
  recipeCount: number;
};

export const PlanFooter = ({ ingredientCount, recipeCount }: Props) => {
  const router = useRouter();
  const disabled = ingredientCount === 0;

  return (
    <Box
      sx={{
        position: 'sticky',
        bottom: 0,
        backgroundColor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        py: 1.5,
        px: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
      }}
    >
      <Typography variant='body2' color='text.secondary'>
        {ingredientCount} ingredientes · {recipeCount} recetas
      </Typography>
      <Button
        variant='contained'
        onClick={() => router.push('/checkout')}
        disabled={disabled}
        data-testid='checkout-button'
      >
        Checkout
      </Button>
    </Box>
  );
};
