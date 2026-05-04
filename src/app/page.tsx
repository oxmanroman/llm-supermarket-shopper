'use client';

import { useState } from 'react';
import { Alert, Box, Container, Snackbar, Typography } from '@mui/material';
import { CartDrawer, Navbar, RecipeInput, type RecipeResult, SearchPage, StoreSelectModal } from '~/containers';
import { useCart } from '~/hooks/useCart';
import { useStore } from '~/hooks/useStore';

type SnackState = { severity: 'success' | 'error'; message: string } | null;

export default function Home() {
  const { store, storeId, hydrated, selectStore, switchStore } = useStore();
  const { items, total, addItem, setQty, remove } = useCart(storeId);
  const [cartOpen, setCartOpen] = useState(false);
  const [snack, setSnack] = useState<SnackState>(null);

  const handleRecipeResult = (result: RecipeResult) => {
    for (const item of result.items) addItem(item);
    if (result.items.length === 0) {
      setSnack({ severity: 'error', message: 'No products matched any ingredients.' });
      return;
    }
    const unmatchedNote = result.unmatched.length > 0 ? ` Couldn't match: ${result.unmatched.join(', ')}.` : '';
    setSnack({ severity: 'success', message: `Added ${result.items.length} items.${unmatchedNote}` });
    setCartOpen(true);
  };

  if (!hydrated) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar
        store={store}
        cartCount={items.reduce((n, i) => n + i.qty, 0)}
        onOpenCart={() => setCartOpen(true)}
        onSwitchStore={switchStore}
      />
      <Box sx={{ flexGrow: 1 }}>
        {store ? (
          <Container maxWidth='lg' sx={{ py: 4 }}>
            <RecipeInput
              storeId={store.id}
              onResult={handleRecipeResult}
              onError={(message) => setSnack({ severity: 'error', message })}
            />
            <SearchPage store={store} onAdd={addItem} />
          </Container>
        ) : (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography variant='body2' color='text.secondary'>
              Pick a supermarket to start.
            </Typography>
          </Box>
        )}
      </Box>
      <StoreSelectModal open={!store} onSelect={selectStore} />
      {store && (
        <CartDrawer
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          store={store}
          items={items}
          total={total}
          onSetQty={setQty}
          onRemove={remove}
        />
      )}
      <Snackbar
        open={snack !== null}
        autoHideDuration={6000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert
            severity={snack.severity}
            onClose={() => setSnack(null)}
            sx={{ width: '100%' }}
            data-testid='recipe-snackbar'
          >
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
