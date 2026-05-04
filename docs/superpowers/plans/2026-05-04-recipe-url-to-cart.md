# Recipe URL → Cart (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user paste a recipe URL and have the cart auto-populate with LLM-matched products (Jumbo or Carrefour), honoring a user-saved free-text preferences string.

**Architecture:** Server-side pipeline `fetch URL → strip HTML → LLM extract → VTEX search per ingredient → LLM match → return CartItem[]`. UI is thin: a new "Paste recipe URL" input on the home page, a gear icon in the navbar that opens a preferences dialog, and a Snackbar that reports unmatched ingredients. All LLM calls go through `@openrouter/ai-sdk-provider` + Vercel AI SDK with `anthropic/claude-sonnet-4.5:extended` (1M context).

**Tech Stack:** Next.js 15, React 19, MUI v6, TypeScript, Jest, Playwright, pnpm. New deps: `ai`, `zod`, `@openrouter/ai-sdk-provider`.

**Spec:** `docs/superpowers/specs/2026-05-04-recipe-url-to-cart-design.md`

---

## File Map

**New:**
- `src/lib/llm/client.ts` — OpenRouter client + `MODEL` constant
- `src/lib/llm/types.ts` — `IngredientSchema`, `PickSchema` and inferred types
- `src/lib/llm/extract.ts` — `extractIngredients(html): Promise<Ingredient[]>`
- `src/lib/llm/match.ts` — `pickSkus(input): Promise<Pick[]>`
- `src/lib/llm/__tests__/extract.test.ts`
- `src/lib/llm/__tests__/match.test.ts`
- `src/lib/llm/__tests__/llm.live.test.ts`
- `src/lib/recipe/fetch.ts` — `fetchAndCleanHtml(url): Promise<string>`
- `src/lib/recipe/pipeline.ts` — `runRecipePipeline(input): Promise<RecipeResult>`
- `src/lib/recipe/__tests__/fetch.test.ts`
- `src/lib/recipe/__tests__/pipeline.test.ts`
- `src/lib/storage/preferences.ts`
- `src/lib/storage/__tests__/preferences.test.ts`
- `src/app/api/recipe/route.ts` — `POST` handler
- `src/hooks/usePreferences.ts`
- `src/containers/PreferencesDialog.tsx`
- `src/containers/RecipeInput.tsx`

**Modify:**
- `src/hooks/index.ts` — add `usePreferences` export
- `src/containers/index.ts` — add `PreferencesDialog`, `RecipeInput`
- `src/containers/Navbar.tsx` — add gear icon + preferences dialog mount + dot badge when prefs is non-empty
- `src/app/page.tsx` — render `RecipeInput`, mount `Snackbar`, auto-open cart drawer on success
- `package.json` — new deps + (no new scripts; `test:live` already covers live tests)
- `.env.example` — `OPENROUTER_API_KEY=`
- `tests/poc.spec.ts` — extend with paste-URL and preferences-dialog scenarios

---

## Task 1: Install LLM deps and scaffold the client

**Files:**
- Modify: `package.json`, `.env.example`
- Create: `src/lib/llm/client.ts`

- [ ] **Step 1: Install deps**

```bash
pnpm add ai zod @openrouter/ai-sdk-provider
```

Expected: pnpm-lock.yaml updates; no errors.

- [ ] **Step 2: Update `.env.example`**

Replace the file's contents with:

```
OPENROUTER_API_KEY=
```

- [ ] **Step 3: Create the LLM client**

Create `src/lib/llm/client.ts`:

```ts
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export const MODEL_ID = 'anthropic/claude-sonnet-4.5:extended';

export function createLlm() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY: OPENROUTER_API_KEY is not set');
  }
  const openrouter = createOpenRouter({ apiKey });
  return openrouter(MODEL_ID);
}
```

- [ ] **Step 4: Verify it compiles**

```bash
pnpm lint
```

Expected: clean. (The new file is exported but not yet used — that's fine; it's a library entry.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example src/lib/llm/client.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "chore(llm): install AI SDK + OpenRouter and scaffold client"
```

---

## Task 2: LLM types and Zod schemas

**Files:** Create: `src/lib/llm/types.ts`

- [ ] **Step 1: Implement schemas**

Create `src/lib/llm/types.ts`:

```ts
import { z } from 'zod';

export const IngredientSchema = z.object({
  name: z.string(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  notes: z.string().optional(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const ExtractSchema = z.array(IngredientSchema);

export const PickSchema = z.object({
  ingredientIndex: z.number().int().nonnegative(),
  pickedSkuId: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
});
export type Pick = z.infer<typeof PickSchema>;

export const MatchSchema = z.array(PickSchema);
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/llm/types.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(llm): add Ingredient and Pick Zod schemas"
```

---

## Task 3: Preferences storage + hook

**Files:**
- Create: `src/lib/storage/preferences.ts`
- Create: `src/lib/storage/__tests__/preferences.test.ts`
- Create: `src/hooks/usePreferences.ts`
- Modify: `src/hooks/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/storage/__tests__/preferences.test.ts`:

```ts
/** @jest-environment jsdom */
import { readPrefs, writePrefs, clearPrefs } from '../preferences';

beforeEach(() => localStorage.clear());

describe('preferences storage', () => {
  it('returns "" when nothing stored', () => {
    expect(readPrefs()).toBe('');
  });

  it('round-trips a string', () => {
    writePrefs('prefer lactose-free dairy');
    expect(readPrefs()).toBe('prefer lactose-free dairy');
  });

  it('writePrefs trims whitespace', () => {
    writePrefs('   prefer X   ');
    expect(readPrefs()).toBe('prefer X');
  });

  it('clearPrefs wipes the value', () => {
    writePrefs('foo');
    clearPrefs();
    expect(readPrefs()).toBe('');
  });

  it('readPrefs returns "" on a missing localStorage', () => {
    // Simulate SSR-like environment where localStorage is unavailable
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    try {
      expect(readPrefs()).toBe('');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/lib/storage/__tests__/preferences.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement storage helpers**

Create `src/lib/storage/preferences.ts`:

```ts
const KEY = 'preferences';

export function readPrefs(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(KEY) ?? '';
}

export function writePrefs(text: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, text.trim());
}

export function clearPrefs(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test:unit src/lib/storage/__tests__/preferences.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Implement the hook**

Create `src/hooks/usePreferences.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { readPrefs, writePrefs } from '~/lib/storage/preferences';

export function usePreferences() {
  const [prefs, setPrefsState] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefsState(readPrefs());
    setHydrated(true);
  }, []);

  const setPrefs = useCallback((text: string) => {
    writePrefs(text);
    setPrefsState(text.trim());
  }, []);

  return { prefs, setPrefs, hydrated };
}
```

- [ ] **Step 6: Update hooks index**

Modify `src/hooks/index.ts` — append:

```ts
export * from './usePreferences';
```

- [ ] **Step 7: Run all unit tests**

```bash
pnpm test:unit
```

Expected: all previous tests still pass + 5 new preferences tests.

- [ ] **Step 8: Commit**

```bash
git add src/lib/storage/preferences.ts src/lib/storage/__tests__/preferences.test.ts src/hooks/usePreferences.ts src/hooks/index.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(state): add preferences storage and usePreferences hook"
```

---

## Task 4: Preferences dialog + Navbar wire

**Files:**
- Create: `src/containers/PreferencesDialog.tsx`
- Modify: `src/containers/Navbar.tsx`
- Modify: `src/containers/index.ts`

- [ ] **Step 1: Implement the dialog**

Create `src/containers/PreferencesDialog.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';

type PreferencesDialogProps = {
  open: boolean;
  initialValue: string;
  onSave: (value: string) => void;
  onClose: () => void;
};

export const PreferencesDialog = ({ open, initialValue, onSave, onClose }: PreferencesDialogProps) => {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth='sm'>
      <DialogTitle>Shopping preferences</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Free text. Sent to the LLM when matching ingredients to products.
        </DialogContentText>
        <TextField
          autoFocus
          multiline
          minRows={4}
          fullWidth
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='e.g. prefer lactose-free dairy, prioritize La Serenísima brand, avoid spicy products'
          inputProps={{ 'data-testid': 'preferences-input' }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant='contained'
          onClick={() => {
            onSave(value);
            onClose();
          }}
          data-testid='preferences-save'
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};
```

- [ ] **Step 2: Update containers index**

Modify `src/containers/index.ts` — add line:

```ts
export * from './PreferencesDialog';
```

(Keep existing exports.)

- [ ] **Step 3: Wire gear icon into Navbar**

Replace `src/containers/Navbar.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsIcon from '@mui/icons-material/Settings';
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
import { PreferencesDialog } from '~/containers/PreferencesDialog';
import { usePreferences } from '~/hooks/usePreferences';
import { STORES } from '~/lib/vtex/stores';
import type { Store, StoreId } from '~/lib/vtex/types';

type NavbarProps = {
  store: Store | null;
  cartCount: number;
  onOpenCart: () => void;
  onSwitchStore: (id: StoreId) => void;
};

export const Navbar = ({ store, cartCount, onOpenCart, onSwitchStore }: NavbarProps) => {
  const { mode, setMode } = useColorScheme();
  const { prefs, setPrefs } = usePreferences();
  const [picking, setPicking] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

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
          <IconButton
            onClick={() => setPrefsOpen(true)}
            data-testid='open-preferences-button'
            aria-label='Open preferences'
          >
            <Badge color='primary' variant='dot' invisible={prefs.length === 0}>
              <SettingsIcon />
            </Badge>
          </IconButton>
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

      <PreferencesDialog
        open={prefsOpen}
        initialValue={prefs}
        onSave={setPrefs}
        onClose={() => setPrefsOpen(false)}
      />
    </>
  );
};
```

- [ ] **Step 4: Smoke-build**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/containers/PreferencesDialog.tsx src/containers/Navbar.tsx src/containers/index.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(ui): add preferences dialog and gear icon in navbar"
```

---

## Task 5: Recipe URL fetch + HTML cleaner

**Files:**
- Create: `src/lib/recipe/fetch.ts`
- Create: `src/lib/recipe/__tests__/fetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/recipe/__tests__/fetch.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { fetchAndCleanHtml } from '../fetch';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => mockFetch.mockReset());

describe('fetchAndCleanHtml', () => {
  it('returns cleaned text content with scripts and styles removed', async () => {
    const html = `<html><head>
        <script>var x = 1;</script>
        <style>.a{color:red}</style>
        <title>Recipe</title>
      </head><body>
        <h1>Pasta carbonara</h1>
        <ul><li>200g pasta</li><li>2 huevos</li></ul>
        <script>tracking()</script>
      </body></html>`;
    mockFetch.mockResolvedValueOnce(new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }));

    const cleaned = await fetchAndCleanHtml('https://example.test/recipe');

    expect(cleaned).not.toContain('var x = 1');
    expect(cleaned).not.toContain('color:red');
    expect(cleaned).toContain('Pasta carbonara');
    expect(cleaned).toContain('200g pasta');
    expect(cleaned).toContain('2 huevos');
  });

  it('throws FETCH_FAILED on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    await expect(fetchAndCleanHtml('https://example.test/missing')).rejects.toThrow(/FETCH_FAILED.*404/);
  });

  it('throws FETCH_FAILED on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(fetchAndCleanHtml('https://nope.test/x')).rejects.toThrow(/FETCH_FAILED/);
  });

  it('throws EMPTY_RECIPE if cleaned content is < 500 chars', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html><body>tiny</body></html>', { status: 200 }));
    await expect(fetchAndCleanHtml('https://example.test/empty')).rejects.toThrow(/EMPTY_RECIPE/);
  });

  it('uses a browser-like User-Agent header', async () => {
    const big = `<html><body>${'pasta '.repeat(200)}</body></html>`;
    mockFetch.mockResolvedValueOnce(new Response(big, { status: 200 }));
    await fetchAndCleanHtml('https://example.test/x');
    const call = mockFetch.mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/Mozilla/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/lib/recipe/__tests__/fetch.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement fetch + cleaner**

Create `src/lib/recipe/fetch.ts`:

```ts
const HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
};

const MIN_CLEANED_LENGTH = 500;

export async function fetchAndCleanHtml(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    throw new Error(`FETCH_FAILED: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`FETCH_FAILED: ${response.status}`);
  }
  const html = await response.text();
  const cleaned = clean(html);
  if (cleaned.length < MIN_CLEANED_LENGTH) {
    throw new Error('EMPTY_RECIPE');
  }
  return cleaned;
}

function clean(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test:unit src/lib/recipe/__tests__/fetch.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe/fetch.ts src/lib/recipe/__tests__/fetch.test.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(recipe): add server-side URL fetcher with HTML cleaner"
```

---

## Task 6: Extract ingredients from HTML (LLM #1)

**Files:**
- Create: `src/lib/llm/extract.ts`
- Create: `src/lib/llm/__tests__/extract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/llm/__tests__/extract.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('../client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));

import { generateObject } from 'ai';
import { extractIngredients } from '../extract';

const mockGenerate = generateObject as jest.MockedFunction<typeof generateObject>;

beforeEach(() => mockGenerate.mockReset());

describe('extractIngredients', () => {
  it('passes the html to generateObject and returns the parsed ingredient list', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: [
        { name: 'manteca', qty: 200, unit: 'g' },
        { name: 'huevo', qty: 2, unit: null },
      ],
    } as never);

    const result = await extractIngredients('<html>recipe HTML</html>');

    expect(result).toEqual([
      { name: 'manteca', qty: 200, unit: 'g' },
      { name: 'huevo', qty: 2, unit: null },
    ]);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const args = mockGenerate.mock.calls[0][0] as { model: unknown; prompt: string; schema: unknown };
    expect(args.model).toBe('mocked-model');
    expect(args.prompt).toContain('<html>recipe HTML</html>');
    expect(args.prompt.toLowerCase()).toContain('es-ar');
  });

  it('rethrows AI SDK failures wrapped as LLM_FAILED', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('rate limit'));
    await expect(extractIngredients('<html></html>')).rejects.toThrow(/LLM_FAILED.*rate limit/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/lib/llm/__tests__/extract.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement extract**

Create `src/lib/llm/extract.ts`:

```ts
import { generateObject } from 'ai';
import { createLlm } from './client';
import { ExtractSchema, type Ingredient } from './types';

const SYSTEM_PROMPT = `You extract ingredient lists from recipe pages.

INPUT: HTML of a recipe page (any language; typically Spanish or English).

TASK: Return a structured ingredient list in **Argentine Spanish (es-AR)**, since the user shops at an Argentine supermarket.

RULES:
- Include every ingredient the recipe lists.
- If the recipe is in another language, translate ingredient names to Argentine Spanish (e.g., "butter" -> "manteca", "avocado" -> "palta", "bell pepper" -> "morrón").
- Quantities: numeric when given (e.g., "2 cucharadas" -> qty: 2, unit: "cucharada"). Use null when not specified or "to taste".
- Do NOT invent or assume ingredients that aren't listed.`;

export async function extractIngredients(html: string): Promise<Ingredient[]> {
  try {
    const result = await generateObject({
      model: createLlm(),
      schema: ExtractSchema,
      prompt: `${SYSTEM_PROMPT}\n\nHTML:\n${html}`,
    });
    return result.object;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    if (detail.startsWith('MISSING_API_KEY')) throw error;
    throw new Error(`LLM_FAILED: ${detail}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test:unit src/lib/llm/__tests__/extract.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/extract.ts src/lib/llm/__tests__/extract.test.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(llm): add ingredient extraction from HTML"
```

---

## Task 7: Match ingredients to SKUs (LLM #2)

**Files:**
- Create: `src/lib/llm/match.ts`
- Create: `src/lib/llm/__tests__/match.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/llm/__tests__/match.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('../client', () => ({ createLlm: jest.fn(() => 'mocked-model') }));

import { generateObject } from 'ai';
import { pickSkus } from '../match';

const mockGenerate = generateObject as jest.MockedFunction<typeof generateObject>;

beforeEach(() => mockGenerate.mockReset());

const ingredient = { name: 'leche', qty: 1, unit: 'L' };
const candidates = [
  { skuId: '1', productId: 'p1', name: 'Leche entera 1L', price: 800, available: true },
  { skuId: '2', productId: 'p2', name: 'Leche descremada 1L', price: 850, available: true },
];

describe('pickSkus', () => {
  it('builds the prompt without a preferences block when prefs is empty and returns picks', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: [{ ingredientIndex: 0, pickedSkuId: '1', confidence: 'high', reason: 'whole milk match' }],
    } as never);

    const result = await pickSkus({ ingredients: [ingredient], candidates: [candidates], preferences: '' });

    expect(result).toEqual([{ ingredientIndex: 0, pickedSkuId: '1', confidence: 'high', reason: 'whole milk match' }]);
    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('"name": "leche"');
    expect(args.prompt).toContain('"skuId": "1"');
    expect(args.prompt.toLowerCase()).not.toContain('user preferences');
  });

  it('includes preferences block in the prompt when prefs is non-empty', async () => {
    mockGenerate.mockResolvedValueOnce({
      object: [{ ingredientIndex: 0, pickedSkuId: '2', confidence: 'high', reason: 'lactose-free pref' }],
    } as never);

    await pickSkus({
      ingredients: [ingredient],
      candidates: [candidates],
      preferences: 'prefer lactose-free dairy',
    });

    const args = mockGenerate.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).toContain('USER PREFERENCES');
    expect(args.prompt).toContain('prefer lactose-free dairy');
  });

  it('rethrows AI SDK failures wrapped as LLM_FAILED', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('boom'));
    await expect(
      pickSkus({ ingredients: [ingredient], candidates: [candidates], preferences: '' }),
    ).rejects.toThrow(/LLM_FAILED.*boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/lib/llm/__tests__/match.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement match**

Create `src/lib/llm/match.ts`:

```ts
import { generateObject } from 'ai';
import type { Product } from '~/lib/vtex/types';
import { createLlm } from './client';
import { MatchSchema, type Ingredient, type Pick } from './types';

const SYSTEM_PROMPT = `You match recipe ingredients to supermarket products.

For each ingredient, choose the best candidate skuId from its candidate list, or return null if no candidate is a reasonable match. Use "high"/"medium"/"low" confidence based on how well the chosen SKU matches the ingredient (name, brand, package size, dietary attributes if listed in candidate names).

Return one pick per ingredient. The "ingredientIndex" must match the index in the input array.`;

type PickInput = {
  ingredients: Ingredient[];
  candidates: Product[][];
  preferences: string;
};

export async function pickSkus(input: PickInput): Promise<Pick[]> {
  const payload = input.ingredients.map((ingredient, i) => ({
    ingredient,
    candidates: input.candidates[i] ?? [],
  }));

  const prefsBlock = input.preferences.trim().length
    ? `\n\nUSER PREFERENCES (in their own words; honor when applicable):\n"""\n${input.preferences.trim()}\n"""`
    : '';

  const prompt = `${SYSTEM_PROMPT}${prefsBlock}\n\nINGREDIENTS AND CANDIDATES:\n${JSON.stringify(payload, null, 2)}`;

  try {
    const result = await generateObject({
      model: createLlm(),
      schema: MatchSchema,
      prompt,
    });
    return result.object;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    if (detail.startsWith('MISSING_API_KEY')) throw error;
    throw new Error(`LLM_FAILED: ${detail}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test:unit src/lib/llm/__tests__/match.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/match.ts src/lib/llm/__tests__/match.test.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(llm): add SKU matcher with optional user preferences"
```

---

## Task 8: Recipe pipeline orchestrator

**Files:**
- Create: `src/lib/recipe/pipeline.ts`
- Create: `src/lib/recipe/__tests__/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/recipe/__tests__/pipeline.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('../fetch', () => ({ fetchAndCleanHtml: jest.fn() }));
jest.mock('~/lib/llm/extract', () => ({ extractIngredients: jest.fn() }));
jest.mock('~/lib/llm/match', () => ({ pickSkus: jest.fn() }));
jest.mock('~/lib/vtex/search', () => ({ productSearch: jest.fn() }));

import { fetchAndCleanHtml } from '../fetch';
import { extractIngredients } from '~/lib/llm/extract';
import { pickSkus } from '~/lib/llm/match';
import { productSearch } from '~/lib/vtex/search';
import { runRecipePipeline } from '../pipeline';
import { STORES } from '~/lib/vtex/stores';

const mockedFetch = fetchAndCleanHtml as jest.MockedFunction<typeof fetchAndCleanHtml>;
const mockedExtract = extractIngredients as jest.MockedFunction<typeof extractIngredients>;
const mockedPick = pickSkus as jest.MockedFunction<typeof pickSkus>;
const mockedSearch = productSearch as jest.MockedFunction<typeof productSearch>;

beforeEach(() => {
  mockedFetch.mockReset();
  mockedExtract.mockReset();
  mockedPick.mockReset();
  mockedSearch.mockReset();
});

describe('runRecipePipeline', () => {
  it('returns CartItem[] for matched picks and unmatched names for null picks', async () => {
    mockedFetch.mockResolvedValueOnce('<html>ok</html>');
    mockedExtract.mockResolvedValueOnce([
      { name: 'manteca', qty: 200, unit: 'g' },
      { name: 'salvia', qty: null, unit: null },
    ]);
    mockedSearch
      .mockResolvedValueOnce([
        { skuId: 'sku-manteca', productId: 'p1', name: 'Manteca 200g', price: 1500, available: true },
      ])
      .mockResolvedValueOnce([]);
    mockedPick.mockResolvedValueOnce([
      { ingredientIndex: 0, pickedSkuId: 'sku-manteca', confidence: 'high', reason: 'name match' },
      { ingredientIndex: 1, pickedSkuId: null, confidence: 'low', reason: 'no candidates' },
    ]);

    const result = await runRecipePipeline({
      url: 'https://example.test/recipe',
      store: STORES.jumbo,
      preferences: '',
    });

    expect(result.items).toEqual([
      { skuId: 'sku-manteca', qty: 1, name: 'Manteca 200g', imageUrl: undefined, price: 1500 },
    ]);
    expect(result.unmatched).toEqual(['salvia']);
    expect(mockedFetch).toHaveBeenCalledWith('https://example.test/recipe');
    expect(mockedSearch).toHaveBeenCalledTimes(2);
    expect(mockedPick).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredients: [
          { name: 'manteca', qty: 200, unit: 'g' },
          { name: 'salvia', qty: null, unit: null },
        ],
        preferences: '',
      }),
    );
  });

  it('passes preferences through to pickSkus', async () => {
    mockedFetch.mockResolvedValueOnce('<html>ok</html>');
    mockedExtract.mockResolvedValueOnce([{ name: 'leche', qty: 1, unit: 'L' }]);
    mockedSearch.mockResolvedValueOnce([
      { skuId: '1', productId: 'p1', name: 'Leche', price: 800, available: true },
    ]);
    mockedPick.mockResolvedValueOnce([
      { ingredientIndex: 0, pickedSkuId: '1', confidence: 'high', reason: 'lactose-free' },
    ]);

    await runRecipePipeline({
      url: 'https://example.test/r',
      store: STORES.jumbo,
      preferences: 'prefer lactose-free dairy',
    });

    expect(mockedPick).toHaveBeenCalledWith(
      expect.objectContaining({ preferences: 'prefer lactose-free dairy' }),
    );
  });

  it('returns all-unmatched when extract returns []', async () => {
    mockedFetch.mockResolvedValueOnce('<html>ok</html>');
    mockedExtract.mockResolvedValueOnce([]);

    const result = await runRecipePipeline({
      url: 'https://example.test/x',
      store: STORES.jumbo,
      preferences: '',
    });

    expect(result.items).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(mockedPick).not.toHaveBeenCalled();
  });

  it('skips picks pointing at SKUs not in their candidate list', async () => {
    mockedFetch.mockResolvedValueOnce('<html>ok</html>');
    mockedExtract.mockResolvedValueOnce([{ name: 'leche', qty: null, unit: null }]);
    mockedSearch.mockResolvedValueOnce([
      { skuId: '1', productId: 'p', name: 'Leche', price: 800, available: true },
    ]);
    mockedPick.mockResolvedValueOnce([
      { ingredientIndex: 0, pickedSkuId: 'made-up-sku', confidence: 'low', reason: 'hallucinated' },
    ]);

    const result = await runRecipePipeline({
      url: 'https://example.test/x',
      store: STORES.jumbo,
      preferences: '',
    });

    expect(result.items).toEqual([]);
    expect(result.unmatched).toEqual(['leche']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/lib/recipe/__tests__/pipeline.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement pipeline**

Create `src/lib/recipe/pipeline.ts`:

```ts
import { extractIngredients } from '~/lib/llm/extract';
import { pickSkus } from '~/lib/llm/match';
import type { Ingredient, Pick } from '~/lib/llm/types';
import { productSearch } from '~/lib/vtex/search';
import type { CartItem, Product, Store } from '~/lib/vtex/types';
import { fetchAndCleanHtml } from './fetch';

export type RecipePipelineInput = {
  url: string;
  store: Store;
  preferences: string;
};

export type RecipeResult = {
  items: CartItem[];
  unmatched: string[];
};

export async function runRecipePipeline(input: RecipePipelineInput): Promise<RecipeResult> {
  const html = await fetchAndCleanHtml(input.url);
  const ingredients = await extractIngredients(html);
  if (ingredients.length === 0) {
    return { items: [], unmatched: [] };
  }

  const candidates: Product[][] = await Promise.all(
    ingredients.map((ingredient) => productSearch(input.store, ingredient.name).catch(() => [])),
  );

  const picks = await pickSkus({ ingredients, candidates, preferences: input.preferences });

  const items: CartItem[] = [];
  const unmatched: string[] = [];
  const picksByIndex = new Map<number, Pick>(picks.map((p) => [p.ingredientIndex, p]));

  for (let idx = 0; idx < ingredients.length; idx++) {
    const ingredient = ingredients[idx];
    const pick = picksByIndex.get(idx);
    const product = pick?.pickedSkuId
      ? candidates[idx]?.find((c) => c.skuId === pick.pickedSkuId)
      : undefined;
    if (product) {
      items.push({
        skuId: product.skuId,
        qty: 1,
        name: product.name,
        imageUrl: product.imageUrl,
        price: product.price,
      });
    } else {
      unmatched.push(ingredient.name);
    }
  }

  return { items, unmatched };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test:unit src/lib/recipe/__tests__/pipeline.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Run all unit tests**

```bash
pnpm test:unit
```

Expected: total tests > 30 (16 prior + new ones), all passing, live tests skipped.

- [ ] **Step 6: Commit**

```bash
git add src/lib/recipe/pipeline.ts src/lib/recipe/__tests__/pipeline.test.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(recipe): add pipeline orchestrator (fetch + extract + search + match)"
```

---

## Task 9: POST /api/recipe route handler

**Files:** Create: `src/app/api/recipe/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/recipe/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { runRecipePipeline } from '~/lib/recipe/pipeline';
import { STORES, isStoreId } from '~/lib/vtex/stores';

type RecipeBody = {
  url?: string;
  store?: string;
  preferences?: string;
};

export async function POST(request: Request) {
  let body: RecipeBody;
  try {
    body = (await request.json()) as RecipeBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!isStoreId(body.store)) {
    return NextResponse.json({ error: 'invalid store' }, { status: 400 });
  }
  if (typeof body.url !== 'string' || !/^https?:\/\//i.test(body.url)) {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  try {
    const result = await runRecipePipeline({
      url: body.url,
      store: STORES[body.store],
      preferences: typeof body.preferences === 'string' ? body.preferences : '',
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[api/recipe]', message);
    if (message.startsWith('FETCH_FAILED')) {
      return NextResponse.json({ error: 'FETCH_FAILED', detail: message }, { status: 502 });
    }
    if (message.startsWith('EMPTY_RECIPE')) {
      return NextResponse.json({ error: 'EMPTY_RECIPE' }, { status: 422 });
    }
    if (message.startsWith('MISSING_API_KEY')) {
      return NextResponse.json({ error: 'MISSING_API_KEY' }, { status: 500 });
    }
    if (message.startsWith('LLM_FAILED')) {
      return NextResponse.json({ error: 'LLM_FAILED', detail: message }, { status: 502 });
    }
    return NextResponse.json({ error: 'UNKNOWN', detail: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manual smoke (validation paths only — no LLM call)**

Start the dev server in the background:

```bash
pnpm dev > /tmp/devsrv.log 2>&1 &
DEV_PID=$!
sleep 8
```

```bash
# Invalid JSON
curl -s -w '\nstatus=%{http_code}\n' -X POST -H 'Content-Type: application/json' -d 'not json' \
  http://localhost:3000/api/recipe
# expect: status=400 {"error":"invalid json"}

# Invalid store
curl -s -w '\nstatus=%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"store":"foo","url":"https://example.test/r"}' \
  http://localhost:3000/api/recipe
# expect: status=400 {"error":"invalid store"}

# Invalid URL
curl -s -w '\nstatus=%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"store":"jumbo","url":"not-a-url"}' \
  http://localhost:3000/api/recipe
# expect: status=400 {"error":"invalid url"}

kill $DEV_PID 2>/dev/null
wait 2>/dev/null
```

(Don't curl with a real URL yet — that requires `OPENROUTER_API_KEY` set.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/recipe/route.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(api): add POST /api/recipe route handler"
```

---

## Task 10: Live LLM integration test (opt-in)

**Files:** Create: `src/lib/llm/__tests__/llm.live.test.ts`

This test costs real OpenRouter tokens. It runs only when **both** `LIVE_TESTS=1` AND `OPENROUTER_API_KEY` are set.

- [ ] **Step 1: Write the test**

Create `src/lib/llm/__tests__/llm.live.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { extractIngredients } from '../extract';
import { pickSkus } from '../match';

jest.setTimeout(60_000);

const live = process.env.LIVE_TESTS === '1' && Boolean(process.env.OPENROUTER_API_KEY);
const liveDescribe = live ? describe : describe.skip;

const SAMPLE_RECIPE_HTML = `
  <html><body>
    <h1>Pasta carbonara para 2 personas</h1>
    <h2>Ingredientes</h2>
    <ul>
      <li>200 g de spaghetti</li>
      <li>100 g de panceta</li>
      <li>2 huevos</li>
      <li>50 g de queso parmesano rallado</li>
      <li>Sal y pimienta a gusto</li>
    </ul>
  </body></html>
`;

liveDescribe('live LLM integration', () => {
  it('extracts ingredients from a small Spanish recipe', async () => {
    const ingredients = await extractIngredients(SAMPLE_RECIPE_HTML);
    expect(ingredients.length).toBeGreaterThanOrEqual(4);
    const names = ingredients.map((i) => i.name.toLowerCase());
    expect(names.some((n) => n.includes('spaghetti') || n.includes('fideo') || n.includes('pasta'))).toBe(true);
    expect(names.some((n) => n.includes('huevo'))).toBe(true);
  });

  it('picks SKUs and honors a non-empty preference', async () => {
    const ingredients = [{ name: 'leche', qty: 1, unit: 'L' as const }];
    const candidates = [
      [
        { skuId: 'sku-whole', productId: 'pw', name: 'Leche entera 1L', price: 900, available: true },
        { skuId: 'sku-skim', productId: 'ps', name: 'Leche descremada 1L', price: 900, available: true },
        { skuId: 'sku-lac', productId: 'pl', name: 'Leche deslactosada 1L', price: 950, available: true },
      ],
    ];

    const lactosePicks = await pickSkus({
      ingredients,
      candidates,
      preferences: 'I am lactose intolerant; prefer lactose-free dairy',
    });
    expect(lactosePicks).toHaveLength(1);
    expect(lactosePicks[0].pickedSkuId).toBe('sku-lac');

    const noPrefsPicks = await pickSkus({ ingredients, candidates, preferences: '' });
    expect(noPrefsPicks).toHaveLength(1);
    expect(['sku-whole', 'sku-skim', 'sku-lac']).toContain(noPrefsPicks[0].pickedSkuId);
  });
});
```

- [ ] **Step 2: Verify it skips by default**

```bash
pnpm test:unit
```

Expected: live LLM test reported as skipped; all other tests pass.

- [ ] **Step 3: Run live test (requires `OPENROUTER_API_KEY` set)**

If the env var is set in your shell or `.env`:

```bash
LIVE_TESTS=1 pnpm test:live
```

Expected: existing 6 VTEX live tests + 2 new LLM live tests all pass. If you don't have an `OPENROUTER_API_KEY`, skip this step and document it in the commit message.

- [ ] **Step 4: Commit**

```bash
git add src/lib/llm/__tests__/llm.live.test.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "test(llm): add opt-in live integration tests for extract + match"
```

---

## Task 11: RecipeInput component

**Files:** Create: `src/containers/RecipeInput.tsx`, modify `src/containers/index.ts`

- [ ] **Step 1: Implement the component**

Create `src/containers/RecipeInput.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Box, Button, CircularProgress, TextField } from '@mui/material';
import { usePreferences } from '~/hooks/usePreferences';
import type { CartItem, StoreId } from '~/lib/vtex/types';

export type RecipeResult = { items: CartItem[]; unmatched: string[] };

type RecipeInputProps = {
  storeId: StoreId;
  onResult: (result: RecipeResult) => void;
  onError: (message: string) => void;
};

export const RecipeInput = ({ storeId, onResult, onError }: RecipeInputProps) => {
  const { prefs } = usePreferences();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, store: storeId, preferences: prefs }),
      });
      const body = (await res.json()) as RecipeResult & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onResult({ items: body.items ?? [], unmatched: body.unmatched ?? [] });
      setUrl('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Recipe processing failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component='form' onSubmit={submit} sx={{ display: 'flex', gap: 1, mb: 2 }}>
      <TextField
        fullWidth
        type='url'
        placeholder='Paste a recipe URL'
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        inputProps={{ 'data-testid': 'recipe-url-input' }}
      />
      <Button
        type='submit'
        variant='contained'
        disabled={!url.trim() || loading}
        data-testid='recipe-submit-button'
        startIcon={loading ? <CircularProgress size={16} color='inherit' /> : undefined}
      >
        {loading ? 'Reading recipe…' : 'Add recipe to cart'}
      </Button>
    </Box>
  );
};
```

- [ ] **Step 2: Update containers index**

Modify `src/containers/index.ts` — add line:

```ts
export * from './RecipeInput';
```

- [ ] **Step 3: Verify it compiles**

```bash
pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/containers/RecipeInput.tsx src/containers/index.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(ui): add RecipeInput component"
```

---

## Task 12: Wire RecipeInput + Snackbar into the home page

**Files:** Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace `src/app/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Alert, Box, Container, Snackbar, Typography } from '@mui/material';
import {
  CartDrawer,
  Navbar,
  RecipeInput,
  type RecipeResult,
  SearchPage,
  StoreSelectModal,
} from '~/containers';
import { useCart, useStore } from '~/hooks';

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
    const unmatchedNote =
      result.unmatched.length > 0 ? ` Couldn't match: ${result.unmatched.join(', ')}.` : '';
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
```

Note: `SearchPage` already wraps its content in its own `Container`. The new outer `Container` here just frames `RecipeInput`. If `SearchPage`'s `Container` causes nested-padding issues, drop the outer `Container` and put `RecipeInput` in a plain `Box` with `sx={{ maxWidth: 'lg', mx: 'auto', px: { xs: 2, sm: 3 }, pt: 4 }}`.

- [ ] **Step 2: Smoke-build**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 3: Manual smoke** (UI)

```bash
pnpm dev
```

In a browser, http://localhost:3000:
1. Pick a store. Confirm gear icon visible in navbar.
2. Click gear → dialog opens. Type "prefer lactose-free dairy". Save. Reopen — value persists. Close.
3. Confirm gear icon shows a small dot.
4. Paste a real Argentine recipe URL (e.g., from Paulina Cocina or Cookpad ES). Click "Add recipe to cart".
5. After ~5–15s, cart drawer auto-opens with items; snackbar shows count and any unmatched.
6. If `OPENROUTER_API_KEY` isn't set, you'll get a 500 with `MISSING_API_KEY` and an error snackbar — that's expected; set the key in `.env` and retry.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "feat(ui): wire recipe input + snackbar; auto-open cart on success"
```

---

## Task 13: Playwright E2E for paste-URL flow + preferences

**Files:** Modify: `tests/poc.spec.ts`

- [ ] **Step 1: Read existing spec to confirm shape**

```bash
sed -n '1,50p' tests/poc.spec.ts
```

You'll see the existing helper `mockApi`. We'll extend it to also mock `/api/recipe`, then add two new tests.

- [ ] **Step 2: Append the new tests to `tests/poc.spec.ts`**

Add the following at the end of the file (after the existing tests):

```ts
test('paste recipe URL → cart populates and snackbar shows unmatched', async ({ page, context }) => {
  await context.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/recipe')) {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          items: [
            { skuId: '1001', qty: 1, name: 'Manteca 200g', price: 1500 },
            { skuId: '1002', qty: 1, name: 'Huevos x12', price: 2200 },
          ],
          unmatched: ['salvia'],
        }),
      });
    } else {
      await mockApi(route);
    }
  });

  await page.goto('/');
  await page.getByTestId('select-store-jumbo').click();

  await page.getByTestId('recipe-url-input').fill('https://example.test/recipe');
  await page.getByTestId('recipe-submit-button').click();

  await expect(page.getByTestId('cart-item-1001')).toBeVisible();
  await expect(page.getByTestId('cart-item-1002')).toBeVisible();
  await expect(page.getByTestId('recipe-snackbar')).toContainText('Added 2 items');
  await expect(page.getByTestId('recipe-snackbar')).toContainText("Couldn't match: salvia");
});

test('preferences dialog: open, save, persists across reopen, dot badge appears', async ({ page, context }) => {
  await context.route('**/api/**', mockApi);
  await page.goto('/');
  await page.getByTestId('select-store-jumbo').click();

  await page.getByTestId('open-preferences-button').click();
  await page.getByTestId('preferences-input').fill('prefer lactose-free dairy');
  await page.getByTestId('preferences-save').click();

  // Dot indicator: the Badge variant="dot" applies a class on the IconButton container.
  // Re-open dialog to confirm value persisted.
  await page.getByTestId('open-preferences-button').click();
  await expect(page.getByTestId('preferences-input')).toHaveValue('prefer lactose-free dairy');
});
```

- [ ] **Step 3: Run E2E**

```bash
pnpm playwright:test --project=chromium
```

Expected: 4 tests pass (2 existing + 2 new). If any timeouts occur on the recipe test, give the recipe-submit-button a longer wait via `await expect(...).toBeVisible({ timeout: 5000 })` on the cart items.

- [ ] **Step 4: Commit**

```bash
git add tests/poc.spec.ts
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "test(e2e): add paste-URL flow and preferences-dialog Playwright specs"
```

---

## Task 14: README and tag

**Files:** Modify: `README.md`

- [ ] **Step 1: Update README**

Read the file first, then replace its contents with:

```markdown
# Supermarket

Recipe-to-cart helper for Argentine supermarkets. Pick a supermarket, paste a recipe URL or search the catalog, build a cart, hand off to the supermarket's checkout.

Currently supports: Jumbo, Carrefour. Both run on VTEX; integration is anonymous (no API keys for the supermarket side).

## Stack

Next.js 15 (App Router), React 19, MUI v6, TypeScript, Jest, Playwright, pnpm. LLM via OpenRouter + Vercel AI SDK + `anthropic/claude-sonnet-4.5:extended` (1M context).

## Setup

```bash
pnpm install
cp .env.example .env
# add OPENROUTER_API_KEY=... to .env
```

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Start dev server on http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build & serve |
| `pnpm test:unit` | Jest unit tests |
| `pnpm test:live` | Live integration tests against real Jumbo/Carrefour and OpenRouter. Skipped from `test:unit`. |
| `pnpm test:e2e` | Playwright E2E tests |
| `pnpm test` | unit + e2e |
| `pnpm format` | Prettier + ESLint fixes |

## Features

- **Search**: type a product name, see the supermarket's results, add to cart.
- **Paste a recipe URL**: server-side LLM extracts ingredients, picks the best SKU per ingredient (top 6 candidates from VTEX search), adds matched items to cart.
- **Preferences**: gear icon in navbar opens a dialog for free-text preferences (e.g., "prefer lactose-free dairy"). Sent to the matching LLM call. Persisted in localStorage.
- **Switch store**: navbar dropdown; clears cart on confirm.
- **Cart hand-off**: stateless VTEX `/checkout/cart/add?sku=...&sc=...&redirect=true` URL. The user lands on the supermarket's site with the items in their session and logs in to pay.

## How the cart hand-off works

`/api/checkout` returns a URL like `https://www.jumbo.com.ar/checkout/cart/add?sku=A&qty=1&seller=1&sku=B&qty=2&seller=1&sc=32&redirect=true`. The browser navigates there; the supermarket adds items to its own session and redirects to its checkout page. The user logs into their existing supermarket account on the supermarket's site to pay.

## Manual smoke checklist

After any change to recipe flow or preferences:

1. `pnpm dev` → http://localhost:3000.
2. Pick Jumbo. Confirm gear icon visible.
3. Paste a real recipe URL (e.g., a Paulina Cocina pasta page). Click "Add recipe to cart". Within ~15s, cart drawer auto-opens with items; snackbar shows count.
4. Open gear → type "prefer lactose-free dairy" → Save. Re-paste a recipe with milk; confirm the LLM picks the lactose-free option.
5. Click "Send to Jumbo". Confirm the items appear on Jumbo's cart.
6. Repeat for Carrefour.

## Specs & plans

- v1 (PoC): `docs/superpowers/specs/2026-05-04-supermarket-poc-design.md`, `docs/superpowers/plans/2026-05-04-supermarket-poc.md`
- v2 (recipe URL): `docs/superpowers/specs/2026-05-04-recipe-url-to-cart-design.md`, `docs/superpowers/plans/2026-05-04-recipe-url-to-cart.md`
- VTEX endpoint samples: `docs/superpowers/research/2026-05-04-vtex-samples.md`
```

- [ ] **Step 2: Final test run**

```bash
pnpm test:unit && pnpm test:e2e --project=chromium
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git -c user.name="Gori" -c user.email="gori@wonderland.xyz" commit -m "docs: update README for v2 (recipe URL + preferences)"
```

- [ ] **Step 4: Tag v2**

```bash
git tag -a v2 -m "v2: recipe URL → cart with LLM extraction, SKU matching, and user preferences"
```

---

## Acceptance verification

The v2 milestone is complete when, in this order:

1. ✅ Pasting a real recipe URL with Jumbo selected populates the cart with ≥4 reasonable matches.
2. ✅ Same URL works on Carrefour.
3. ✅ Setting "prefer lactose-free dairy" causes the LLM to pick the lactose-free SKU when present.
4. ✅ A 404 URL surfaces a clear error snackbar; cart unaffected.
5. ✅ `pnpm test:unit` passes (≥30 total).
6. ✅ `pnpm test:live` passes for VTEX (6 tests) and LLM (2 tests) when `OPENROUTER_API_KEY` is set.
7. ✅ `pnpm test:e2e` passes (4 tests).
8. ✅ Cart hand-off (Send to {store}) still works for the populated cart.
