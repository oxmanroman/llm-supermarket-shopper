'use client';

import { useState } from 'react';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import {
  AppBar,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Toolbar,
  Typography,
} from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { STORES } from '~/lib/vtex/stores';
import type { Store, StoreId } from '~/lib/vtex/types';

type Props = {
  store: Store | null;
  cartCount: number;
  onOpenCart: () => void;
  onSwitchStore: (id: StoreId) => void;
};

export const Navbar = ({ store, cartCount, onOpenCart, onSwitchStore }: Props) => {
  const { mode, setMode } = useColorScheme();
  const [picking, setPicking] = useState(false);

  const otherStores = Object.values(STORES).filter((s) => s.id !== store?.id);
  const toggleTheme = () => setMode(mode === 'dark' ? 'light' : 'dark');

  return (
    <>
      <AppBar position='static' color='default' elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <Typography variant='h6' sx={{ flexGrow: 1 }}>
            Supermarket
          </Typography>
          {store && (
            <Button
              size='small'
              variant='outlined'
              onClick={() => setPicking(true)}
              data-testid='switch-store-button'
              sx={{ mr: 1 }}
            >
              {store.name}
            </Button>
          )}
          <IconButton onClick={onOpenCart} data-testid='open-cart-button' aria-label='Open cart'>
            <Badge badgeContent={cartCount} color='primary'>
              <ShoppingCartIcon />
            </Badge>
          </IconButton>
          <IconButton onClick={toggleTheme} aria-label='Toggle theme'>
            {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        </Toolbar>
      </AppBar>
      <Dialog open={picking} onClose={() => setPicking(false)}>
        <DialogTitle>Switch store?</DialogTitle>
        <DialogContent>
          <Typography variant='body2'>Switching will clear your current cart. Pick a new store below.</Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1, p: 2 }}>
          <Button onClick={() => setPicking(false)}>Cancel</Button>
          {otherStores.map((s) => (
            <Button
              key={s.id}
              variant='contained'
              onClick={() => {
                onSwitchStore(s.id);
                setPicking(false);
              }}
              data-testid={`switch-to-${s.id}`}
            >
              {s.name}
            </Button>
          ))}
        </DialogActions>
      </Dialog>
    </>
  );
};
