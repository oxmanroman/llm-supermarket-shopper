'use client';

import { useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LinkIcon from '@mui/icons-material/Link';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { IngredientLine, Recipe } from '~/types/plan';
import { IngredientRow } from './IngredientRow';

type Props = {
  recipe: Recipe;
  onRename: (label: string) => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
  onAddIngredient: (text: string) => void;
  onChangeIngredient: (line: IngredientLine) => void;
  onRemoveIngredient: (id: string) => void;
  onRetryUrl?: () => void;
};

export const RecipeCard = ({
  recipe,
  onRename,
  onRemove,
  onToggleCollapse,
  onAddIngredient,
  onChangeIngredient,
  onRemoveIngredient,
  onRetryUrl,
}: Props) => {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(recipe.label);
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const [newIngredient, setNewIngredient] = useState('');

  const isLoose = recipe.source.kind === 'loose';
  const isError = recipe.source.kind === 'url' && recipe.source.status === 'error';
  const isExtracting = recipe.source.kind === 'url' && recipe.source.status === 'extracting';

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== recipe.label) onRename(next);
    setEditingTitle(false);
  };

  const addIngredient = (event: React.FormEvent) => {
    event.preventDefault();
    const text = newIngredient.trim();
    if (!text) return;
    onAddIngredient(text);
    setNewIngredient('');
  };

  return (
    <Card variant='outlined' sx={{ mb: 2 }} data-testid={`recipe-${recipe.id}`}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          {editingTitle ? (
            <TextField
              size='small'
              fullWidth
              // eslint-disable-next-line jsx-a11y/no-autofocus -- inline title edit: focusing the field the user just clicked into is the expected interaction
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                if (e.key === 'Escape') {
                  setTitleDraft(recipe.label);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <Typography
              variant='subtitle1'
              sx={{ flexGrow: 1, cursor: isLoose ? 'default' : 'text', fontWeight: 500 }}
              onClick={() => !isLoose && setEditingTitle(true)}
            >
              {isExtracting ? 'Cargando…' : recipe.label}
            </Typography>
          )}
          {recipe.source.kind === 'url' && !isExtracting && (
            <IconButton
              size='small'
              component='a'
              href={recipe.source.url}
              target='_blank'
              rel='noopener'
              aria-label='Abrir receta'
            >
              <LinkIcon fontSize='small' />
            </IconButton>
          )}
          <IconButton size='small' onClick={onToggleCollapse} aria-label={recipe.collapsed ? 'Expandir' : 'Colapsar'}>
            {recipe.collapsed ? <ExpandMoreIcon fontSize='small' /> : <ExpandLessIcon fontSize='small' />}
          </IconButton>
          {!isLoose && (
            <>
              <IconButton size='small' onClick={(e) => setMenuEl(e.currentTarget)} aria-label='Más acciones'>
                <MoreVertIcon fontSize='small' />
              </IconButton>
              <Menu open={Boolean(menuEl)} anchorEl={menuEl} onClose={() => setMenuEl(null)}>
                <MenuItem
                  onClick={() => {
                    setMenuEl(null);
                    setEditingTitle(true);
                  }}
                >
                  Renombrar
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuEl(null);
                    onRemove();
                  }}
                >
                  Quitar
                </MenuItem>
              </Menu>
            </>
          )}
        </Box>

        {isExtracting && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <CircularProgress size={16} />
            <Typography variant='caption' color='text.secondary'>
              Extrayendo ingredientes…
            </Typography>
          </Box>
        )}

        {isError && (
          <Alert severity='error' sx={{ mb: 1 }}>
            {recipe.source.kind === 'url' && recipe.source.error ? recipe.source.error : 'Falló la extracción'}
            {onRetryUrl && (
              <IconButton size='small' onClick={onRetryUrl} sx={{ ml: 1 }}>
                Reintentar
              </IconButton>
            )}
          </Alert>
        )}

        {!recipe.collapsed && (
          <Stack>
            {recipe.ingredients.map((line) => (
              <IngredientRow
                key={line.id}
                line={line}
                onChange={onChangeIngredient}
                onRemove={() => onRemoveIngredient(line.id)}
              />
            ))}
            <Box component='form' onSubmit={addIngredient} sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <TextField
                size='small'
                fullWidth
                placeholder='+ Agregar ingrediente'
                value={newIngredient}
                onChange={(e) => setNewIngredient(e.target.value)}
                inputProps={{ 'data-testid': `add-ingredient-${recipe.id}` }}
              />
              <IconButton type='submit' size='small' disabled={!newIngredient.trim()}>
                <AddIcon fontSize='small' />
              </IconButton>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};
