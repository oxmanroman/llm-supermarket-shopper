'use client';

import { useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import type { Product, StoreId } from '~/lib/vtex/types';

type Props = {
  storeId: StoreId;
  initialQuery?: string;
  pickLabel?: string;
  onPick: (product: Product) => void;
};

export const ProductSearch = ({ storeId, initialQuery = '', pickLabel = 'Usar este', onPick }: Props) => {
  const [query, setQuery] = useState(initialQuery);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?store=${storeId}&q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { products: Product[] };
      setProducts(body.products);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box component='form' onSubmit={search} sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <TextField
          size='small'
          fullWidth
          placeholder='Buscar producto…'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputProps={{ 'data-testid': 'product-search-input' }}
        />
        <Button type='submit' size='small' variant='outlined' disabled={!query.trim() || loading}>
          {loading ? <CircularProgress size={16} /> : 'Buscar'}
        </Button>
      </Box>
      {error && (
        <Alert severity='error' sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {products.length === 0 && !loading && !error && (
        <Typography variant='caption' color='text.secondary'>
          Escribí algo y presioná Buscar.
        </Typography>
      )}
      <List dense>
        {products.map((p) => (
          <ListItem
            key={p.skuId}
            secondaryAction={
              <Button size='small' variant='contained' onClick={() => onPick(p)} data-testid={`pick-${p.skuId}`}>
                {pickLabel}
              </Button>
            }
          >
            <ListItemButton sx={{ pr: 12 }}>
              <ListItemAvatar>
                <Avatar
                  variant='rounded'
                  src={p.imageUrl}
                  alt=''
                  sx={{ width: 56, height: 56, bgcolor: 'background.default', '& img': { objectFit: 'contain' } }}
                />
              </ListItemAvatar>
              <ListItemText primary={p.name} secondary={`$${p.price.toLocaleString('es-AR')}`} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};
