# Recipe URL → Cart (v2) — Design

**Date:** 2026-05-04
**Status:** Approved (brainstorming)
**Owner:** Gori
**Builds on:** PoC v1 (`2026-05-04-supermarket-poc-design.md`)

## 1. Goal

Let the user paste any recipe URL and have the cart auto-populate with matching products from the currently selected supermarket (Jumbo or Carrefour). Picks honor a free-text user "preferences" string (e.g., "prioritize lactose-free dairy, prefer La Serenísima"). Supermarket hand-off remains unchanged from v1 — the user reviews items in the cart drawer and clicks "Send to {store}" as before.

## 2. Scope

### In

- New input on the home page: "Paste recipe URL" with an action button.
- New backend route `POST /api/recipe` that runs the full pipeline server-side:
  1. Fetch URL HTML (server-side, bypasses CORS).
  2. Strip `<script>`/`<style>`/comments to clean text.
  3. LLM call #1 (extract): cleaned HTML → `Ingredient[]`.
  4. For each ingredient, call existing `productSearch(store, ingredient.name)` → top 6 candidates.
  5. LLM call #2 (match): `Ingredient[]` + per-ingredient candidates + user preferences → `Pick[]` (one `skuId` per ingredient or `null`).
  6. Return `{ items: CartItem[], unmatched: string[] }`.
- Picked items are **merged** into the existing local cart (additive — does not replace).
- Preferences UI: gear icon in navbar opens a `Dialog` with one multi-line `<TextField>`. Persisted to `localStorage` under key `preferences`. Sent to LLM call #2 only (extract step doesn't need them).
- LLM stack: `@openrouter/ai-sdk-provider` + Vercel AI SDK + `anthropic/claude-sonnet-4.5:extended` (1M context).
- `OPENROUTER_API_KEY` is the only new `.env` secret.
- After processing, cart drawer auto-opens; a `Snackbar` reports any unmatched ingredients.

### Out (deferred to v3+)

- Recipe images (vision LLM).
- Per-ingredient swap UI in the recipe response (cart drawer remains the edit surface).
- Preferences applied to the extract step.
- Streaming progress / per-step UI.
- More stores (Día / Disco / Vea).

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Browser                                                  │
│ - Existing search input                                  │
│ - NEW "Paste recipe URL" input + action button           │
│ - NEW gear icon in navbar → preferences dialog           │
│ - Existing cart drawer (review/edit)                     │
└────────────┬─────────────────────────────────────────────┘
             │ POST /api/recipe { url, store, preferences }
             ▼
┌──────────────────────────────────────────────────────────┐
│ Next.js Route Handler /api/recipe (POST)                 │
│ Wraps lib/recipe/pipeline.runRecipePipeline              │
└────────────┬─────────────────────────────────────────────┘
             ▼
┌──────────────────────────────────────────────────────────┐
│ lib/recipe/pipeline.ts                                   │
│ 1. fetchAndCleanHtml(url)            (lib/recipe/fetch)  │
│ 2. extractIngredients(html)          (lib/llm/extract)   │
│ 3. for each ingredient:                                  │
│      productSearch(store, ingredient)  (lib/vtex/search) │
│ 4. pickSkus(ingredients, candidates, preferences)        │
│      (lib/llm/match)                                     │
│ 5. return { items, unmatched }                           │
└──────────────────────────────────────────────────────────┘
```

The pipeline is plain orchestration; each step is a single small function. Route Handler is a thin wrapper. `lib/recipe/pipeline.ts` is reusable from any caller (Jest test, future CLI, future MCP server).

### New module layout

```
src/
  lib/
    llm/
      client.ts             # createLlm() — OpenRouter + AI SDK setup
      extract.ts            # extractIngredients(html): Promise<Ingredient[]>
      match.ts              # pickSkus(ingredients, candidates, prefs): Promise<Pick[]>
      types.ts              # Ingredient, Pick (Zod schemas + inferred types)
    recipe/
      fetch.ts              # fetchAndCleanHtml(url): Promise<string>
      pipeline.ts           # runRecipePipeline(input): Promise<RecipeResult>
    storage/
      preferences.ts        # readPrefs/writePrefs/clearPrefs (localStorage)
  app/api/recipe/route.ts   # POST handler, validates body, calls pipeline
  hooks/usePreferences.ts   # localStorage-backed preferences string
  containers/
    PreferencesDialog.tsx   # gear-icon dialog with single textarea
    RecipeInput.tsx         # URL input + action button + spinner
```

`extract.ts` and `match.ts` import the model id from a single constant in `client.ts` so model swaps are one-line changes.

## 4. LLM contracts

### Extract (LLM #1)

Input: cleaned HTML string. No truncation (1M context model).

Output schema (Zod):

```ts
const IngredientSchema = z.object({
  name: z.string(),                 // "leche entera"
  qty: z.number().nullable(),       // 1, 0.5, null if "to taste"
  unit: z.string().nullable(),      // "L", "g", "cucharada", null
  notes: z.string().optional(),     // "tibia", "sin sal"
});
const ExtractSchema = z.array(IngredientSchema);
```

Prompt (rough shape):

> You are extracting an ingredient list from a recipe page (HTML provided). Return ingredients in **Spanish (es-AR)** since the user shops at an Argentine supermarket. Include all ingredients listed in the recipe; do not invent unlisted pantry staples.

Implementation: `generateObject({ model, schema: ExtractSchema, messages: [...] })`.

### Match (LLM #2)

Input: `{ ingredients: Ingredient[], candidates: Product[][] }` (parallel arrays — `candidates[i]` is the top-6 products from VTEX search for `ingredients[i]`). Plus the `preferences` string if present.

Output schema:

```ts
const PickSchema = z.object({
  ingredientIndex: z.number().int().nonnegative(),
  pickedSkuId: z.string().nullable(),  // null = no acceptable match
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),                  // 1-line, for debug logs only
});
const MatchSchema = z.array(PickSchema);
```

Prompt (rough shape):

> You are matching recipe ingredients to supermarket products. For each ingredient, choose the best `skuId` from its candidate list, or return `null` if none is reasonable. Honor the user's preferences (free text, in their own words):
>
> ```
> <preferences string, omitted if empty>
> ```
>
> Return one pick per ingredient.

Implementation: single `generateObject` call (one round-trip for all ingredients), schema=`MatchSchema`.

## 5. Preferences

- `lib/storage/preferences.ts` exposes `readPrefs(): string`, `writePrefs(text: string): void`, `clearPrefs(): void`. Backed by `localStorage` key `preferences`. Returns `''` when missing.
- `hooks/usePreferences.ts` wraps the storage helpers in React state, returning `{ prefs, setPrefs }`.
- `PreferencesDialog.tsx`: MUI `Dialog`. Header "Shopping preferences". One multi-line `<TextField>` with a placeholder like `"e.g. prefer lactose-free dairy, prioritize La Serenísima brand, avoid spicy products"`. "Save" persists; "Cancel" discards.
- `Navbar.tsx` gets a new gear icon between "switch store" and "open cart" that opens the dialog.
- `RecipeInput.tsx` reads `prefs` via the hook and includes it in the POST body.

## 6. UX flow

1. User has selected a store (existing flow).
2. Home page shows the existing search bar AND a new "Paste recipe URL" input above it.
3. User pastes URL, clicks "Add recipe to cart". Button shows spinner with "Reading recipe…".
4. Pipeline runs server-side (5–15s typical).
5. On success **with at least one matched item**: cart drawer auto-opens; a `Snackbar` shows "Added N items." If unmatched ingredients exist, the snackbar appends "Couldn't match: salvia, pimentón ahumado." (autohide after ~6s). On success with **zero matched items**: drawer does NOT auto-open; snackbar shows "No products matched any ingredients."
6. User reviews/edits in cart drawer (existing UI), clicks "Send to {store}".

If `prefs` is non-empty, the gear icon shows a small dot via MUI `Badge variant="dot"` to indicate preferences are active.

## 7. Error handling

- Invalid URL or fetch fails (DNS, 4xx, 5xx, timeout) → `/api/recipe` returns `{ error: 'FETCH_FAILED', detail }` with status 502. Client shows error in a snackbar; cart unaffected.
- Cleaned HTML below ~500 chars (likely a paywall or empty page) → `{ error: 'EMPTY_RECIPE' }`, snackbar "Couldn't read the recipe — try a different URL."
- LLM call fails (provider 5xx, timeout, schema validation error) → `{ error: 'LLM_FAILED', detail }`, snackbar "Recipe processing failed. Try again."
- Some ingredients can't be matched (LLM returns `null` picks) → matched items are added to cart; unmatched names returned in `unmatched: string[]`. Surfaced in the success snackbar.
- Empty cart from pipeline (zero matches) → still considered success, but snackbar "No products matched any ingredients" and cart drawer doesn't auto-open.
- `OPENROUTER_API_KEY` missing in env → `/api/recipe` returns 500 with `MISSING_API_KEY` and a clear server-log message.

## 8. Tests

| Layer | Tool | Scope |
|---|---|---|
| Unit | Jest | `lib/recipe/fetch.ts`: fetches URL, strips `<script>`/`<style>`, returns text. `fetch` mocked. |
| Unit | Jest | `lib/llm/extract.ts`: builds the right prompt and parses the AI SDK response into `Ingredient[]`. AI SDK call mocked. |
| Unit | Jest | `lib/llm/match.ts`: builds the right prompt (including preferences when present, omitting when empty) and parses into `Pick[]`. AI SDK call mocked. |
| Unit | Jest | `lib/recipe/pipeline.ts`: orchestrates the three steps with mocks; verifies that picks with `null` skuId become entries in `unmatched` and items with a matched skuId become `CartItem[]`. |
| Unit | Jest | `lib/storage/preferences.ts`: read/write/clear round-trips. |
| Live | Jest (`*.live.test.ts`, opt-in via `pnpm test:live`) | One real call per LLM step against a stable recipe URL (e.g., a chosen Paulina Cocina or Cookpad page). Asserts ≥3 ingredients extracted, and ≥1 match returned for Jumbo. Costs real OpenRouter tokens — guarded by both `LIVE_TESTS=1` and `OPENROUTER_API_KEY` being set. |
| E2E | Playwright | Mock `/api/recipe` to return a fixed payload; verify UI: paste URL → spinner → cart populates with returned items → snackbar shows unmatched count. Also verify the preferences dialog: open, type, save, close, reopen, value persists. |

## 9. Acceptance criteria

The v2 milestone is complete when:

1. With a real recipe URL pasted (e.g., a Paulina Cocina pasta page) and Jumbo selected, clicking "Add recipe to cart" results in ≥4 items showing up in the cart drawer with reasonable matches.
2. Repeating the same URL with Carrefour selected works.
3. Setting a preference like "prefer lactose-free milk" causes the LLM to pick the lactose-free SKU when one is in the candidate list.
4. Pasting a 404 URL shows a clear error snackbar; cart unaffected.
5. `pnpm test:unit` passes (16 prior + new unit tests, target ≥25 total).
6. `pnpm test:live` passes for both Jumbo and Carrefour (existing tests + new LLM live test).
7. `pnpm test:e2e` passes (existing happy/switch-store tests still green; new tests for paste-URL flow and preferences dialog).
8. Send-to-store hand-off (existing v1 flow) still works for the populated cart.

## 10. Risks and open notes

- **LLM matching quality** is the main subjective risk. The match call sees only the top-6 candidates from VTEX search, so if VTEX search misses the true match (e.g., misspelling, brand-only listing), the LLM can't fix it. Mitigation: search top-6 is decent baseline; later milestone could try multi-query (run search on `name`, `name + brand hint`, `name singular vs plural`) and union before matching.
- **Recipe URL fetch and bot protection.** Some recipe sites (NYT Cooking, paywalled outlets) won't return useful HTML to a server-side fetch. PoC users probably paste from open Argentine sites (Paulina Cocina, Cookpad, food blogs); for v2 we accept this limitation. If bothersome, we can add a small adapter list with site-specific handling later.
- **Preferences are global, not per-store.** Switching stores doesn't change preferences. This is intentional — preferences describe the user, not the store.
- **Cost per recipe** is roughly the size of the HTML in tokens for extract + ~6 candidates × N ingredients in tokens for match. With Sonnet 4.5 at standard pricing this is cents, well within "personal-use OK".
- **Adding preferences to the extract step** could allow scaling ("cooking for 4") or substitutions at parse time. Deferred — current scope is product preferences only.

## 11. Out of scope, future milestones

- v3: recipe image upload (vision LLM).
- v3: in-flight ingredient swap UI ("not what I meant" per row, before items hit cart).
- v4: more stores (Día/Disco/Vea — config additions only since they're VTEX too).
- v4: query refinement strategies for VTEX search (synonyms, plural/singular, brand hint).
- v4: streaming UI (per-step progress, partial cart fill while LLM #2 is still running).
