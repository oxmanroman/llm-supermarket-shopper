'use client';

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardMedia,
  CircularProgress,
  Container,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { CartItem, Product, Store } from '~/lib/vtex/types';

type Props = {
  store: Store;
  onAdd: (item: CartItem) => void;
};

export const SearchPage = ({ store, onAdd }: Props) => {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setTouched(true);
    try {
      const res = await fetch(`/api/search?store=${store.id}&q=${encodeURIComponent(query)}`);
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
    <Container maxWidth='lg' sx={{ py: 4 }}>
      <Box component='form' onSubmit={search} sx={{ display: 'flex', gap: 1, mb: 3 }}>
        <TextField
          fullWidth
          placeholder={`Search ${store.name}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputProps={{ 'data-testid': 'search-input' }}
        />
        <Button type='submit' variant='contained' disabled={!query.trim() || loading}>
          Search
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity='error' sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!loading && touched && products.length === 0 && !error && (
        <Typography variant='body2' color='text.secondary'>
          No results for &quot;{query}&quot; on {store.name}.
        </Typography>
      )}

      <Stack direction='row' flexWrap='wrap' gap={2} data-testid='results-grid'>
        {products.map((p) => (
          <Card key={p.skuId} sx={{ width: { xs: '100%', sm: 220 } }} data-testid={`product-${p.skuId}`}>
            {p.imageUrl && (
              <CardMedia component='img' image={p.imageUrl} alt={p.name} sx={{ height: 140, objectFit: 'contain' }} />
            )}
            <CardContent>
              <Typography variant='body2' sx={{ minHeight: 40 }}>
                {p.name}
              </Typography>
              <Typography variant='subtitle1' sx={{ mt: 1 }}>
                ${p.price.toLocaleString('es-AR')}
              </Typography>
            </CardContent>
            <CardActions>
              <Button
                fullWidth
                disabled={!p.available}
                onClick={() =>
                  onAdd({
                    skuId: p.skuId,
                    qty: 1,
                    name: p.name,
                    imageUrl: p.imageUrl,
                    price: p.price,
                  })
                }
                data-testid={`add-${p.skuId}`}
              >
                {p.available ? 'Add' : 'Unavailable'}
              </Button>
            </CardActions>
          </Card>
        ))}
      </Stack>
    </Container>
  );
};
