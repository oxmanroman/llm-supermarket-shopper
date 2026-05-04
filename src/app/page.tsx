'use client';

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { CartDrawer, Navbar, SearchPage, StoreSelectModal } from '~/containers';
import { useCart, useStore } from '~/hooks';

export default function Home() {
  const { store, storeId, hydrated, selectStore, switchStore } = useStore();
  const { items, total, addItem, setQty, remove } = useCart(storeId);
  const [cartOpen, setCartOpen] = useState(false);

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
          <SearchPage store={store} onAdd={addItem} />
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
    </Box>
  );
}
