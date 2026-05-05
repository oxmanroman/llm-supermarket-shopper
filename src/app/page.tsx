'use client';

import { useState } from 'react';
import { Alert, Box, Container, Snackbar, Typography } from '@mui/material';
import { AddRecipeBar, Navbar, PlanFooter, RecipeCard } from '~/containers';
import { usePlan } from '~/hooks';
import type { IngredientLine, Recipe } from '~/types/plan';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

type SnackState = { severity: 'success' | 'error' | 'info'; message: string; undo?: () => void } | null;

export default function Home() {
  const { plan, hydrated, update } = usePlan();
  const [snack, setSnack] = useState<SnackState>(null);

  // Any change to recipes invalidates a cached resolution: the previous
  // matched/unmatched/skipped lists were computed against a different recipe
  // set, and a 'handed-off' state is for a shipment that no longer matches
  // the current plan. Otherwise clicking Checkout after edits would show a
  // stale banner or list. UI-only mutations (collapse toggle) keep the
  // resolution intact and use plain `update`.
  const updateRecipes = (recipesFn: (recipes: Recipe[]) => Recipe[]) =>
    update((p) => ({
      ...p,
      recipes: recipesFn(p.recipes),
      lastResolution: { state: 'idle' },
    }));

  if (!hydrated) return null;

  const handleAdd = async (input: { url: string } | { text: string }) => {
    const id = newId();
    if ('url' in input) {
      // Duplicate detection.
      if (plan.recipes.some((r) => r.source.kind === 'url' && r.source.url === input.url)) {
        setSnack({ severity: 'info', message: 'Ya agregada' });
        return;
      }
      const placeholder: Recipe = {
        id,
        label: 'Cargando…',
        source: { kind: 'url', url: input.url, status: 'extracting' },
        ingredients: [],
        createdAt: now(),
      };
      updateRecipes((recipes) => [...recipes, placeholder]);
      try {
        const res = await fetch('/api/recipe/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: input.url }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        updateRecipes((recipes) =>
          recipes.map((r) =>
            r.id === id
              ? {
                  ...r,
                  label: body.label,
                  source: { kind: 'url', url: input.url, status: 'ready' },
                  ingredients: (
                    body.ingredients as { name: string; qty: number | null; unit: string | null; notes?: string }[]
                  ).map((i) => ({ id: newId(), text: i.name, qty: i.qty, unit: i.unit, notes: i.notes })),
                }
              : r,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'extract failed';
        updateRecipes((recipes) =>
          recipes.map((r) =>
            r.id === id
              ? {
                  ...r,
                  source: { kind: 'url', url: input.url, status: 'error', error: msg },
                }
              : r,
          ),
        );
      }
      return;
    }

    // Text path.
    const placeholderId = newId();
    const placeholder: Recipe = {
      id: placeholderId,
      label: 'Procesando…',
      source: { kind: 'manual' },
      ingredients: [],
      createdAt: now(),
    };
    updateRecipes((recipes) => [...recipes, placeholder]);
    try {
      const res = await fetch('/api/recipe/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const ingredients: IngredientLine[] = (
        body.ingredients as { name: string; qty: number | null; unit: string | null; notes?: string }[]
      ).map((i) => ({ id: newId(), text: i.name, qty: i.qty, unit: i.unit, notes: i.notes }));
      if (body.isLoose) {
        updateRecipes((existing) => {
          const recipes = existing.filter((r) => r.id !== placeholderId);
          const looseIdx = recipes.findIndex((r) => r.source.kind === 'loose');
          if (looseIdx === -1) {
            recipes.push({
              id: newId(),
              label: 'Otros',
              source: { kind: 'loose' },
              ingredients,
              createdAt: now(),
            });
          } else {
            recipes[looseIdx] = {
              ...recipes[looseIdx],
              ingredients: [...recipes[looseIdx].ingredients, ...ingredients],
            };
          }
          return recipes;
        });
      } else {
        updateRecipes((recipes) =>
          recipes.map((r) => (r.id === placeholderId ? { ...r, label: body.label, ingredients } : r)),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'extract failed';
      setSnack({ severity: 'error', message: msg });
      updateRecipes((recipes) => recipes.filter((r) => r.id !== placeholderId));
    }
  };

  const removeRecipe = (id: string) => {
    const idx = plan.recipes.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const recipe = plan.recipes[idx];
    updateRecipes((recipes) => recipes.filter((r) => r.id !== id));
    setSnack({
      severity: 'info',
      message: `"${recipe.label}" eliminada`,
      undo: () => {
        updateRecipes((recipes) => {
          if (recipes.some((r) => r.id === recipe.id)) return recipes;
          const next = [...recipes];
          const insertIdx = Math.min(idx, next.length);
          next.splice(insertIdx, 0, recipe);
          return next;
        });
        setSnack(null);
      },
    });
  };

  // Render: 'loose' recipe always at bottom.
  const sorted = [...plan.recipes].sort(
    (a, b) => Number(a.source.kind === 'loose') - Number(b.source.kind === 'loose'),
  );
  const ingredientCount = plan.recipes.reduce((n, r) => n + r.ingredients.length, 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <Container maxWidth='md' sx={{ py: 4, flexGrow: 1, width: '100%' }}>
        <AddRecipeBar onSubmit={handleAdd} />
        {sorted.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography variant='body2' color='text.secondary'>
              Pegá una URL de receta o escribí lo que querés cocinar.
            </Typography>
          </Box>
        ) : (
          sorted.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onRename={(label) =>
                updateRecipes((recipes) => recipes.map((r) => (r.id === recipe.id ? { ...r, label } : r)))
              }
              onRemove={() => removeRecipe(recipe.id)}
              onToggleCollapse={() =>
                // Collapse is a UI-only flag; intentionally does NOT invalidate
                // the resolution.
                update((p) => ({
                  ...p,
                  recipes: p.recipes.map((r) => (r.id === recipe.id ? { ...r, collapsed: !r.collapsed } : r)),
                }))
              }
              onAddIngredient={(text) =>
                updateRecipes((recipes) =>
                  recipes.map((r) =>
                    r.id === recipe.id
                      ? {
                          ...r,
                          ingredients: [...r.ingredients, { id: newId(), text, qty: null, unit: null }],
                        }
                      : r,
                  ),
                )
              }
              onChangeIngredient={(line) =>
                updateRecipes((recipes) =>
                  recipes.map((r) =>
                    r.id === recipe.id
                      ? {
                          ...r,
                          ingredients: r.ingredients.map((i) => (i.id === line.id ? line : i)),
                        }
                      : r,
                  ),
                )
              }
              onRemoveIngredient={(lineId) =>
                updateRecipes((recipes) =>
                  recipes.map((r) =>
                    r.id === recipe.id
                      ? {
                          ...r,
                          ingredients: r.ingredients.filter((i) => i.id !== lineId),
                        }
                      : r,
                  ),
                )
              }
            />
          ))
        )}
      </Container>
      <PlanFooter ingredientCount={ingredientCount} recipeCount={plan.recipes.length} />
      <Snackbar
        open={snack !== null}
        autoHideDuration={6000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        action={
          snack?.undo ? (
            <Box
              component='button'
              onClick={() => snack.undo?.()}
              sx={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
            >
              Deshacer
            </Box>
          ) : undefined
        }
      >
        {snack ? (
          <Alert
            severity={snack.severity}
            onClose={() => setSnack(null)}
            sx={{ width: '100%' }}
            data-testid='plan-snackbar'
          >
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
