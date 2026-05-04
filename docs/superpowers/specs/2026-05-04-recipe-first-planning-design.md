# Recipe-First Planning (v3) — Design

**Date:** 2026-05-04
**Status:** Approved (UX brainstorming subagent + controller decisions)
**Owner:** Gori
**Builds on:** v2 (`2026-05-04-recipe-url-to-cart-design.md`). Replaces the v2 home-page UX wholesale. Keeps all v2 backend primitives (VTEX search, URL builder, LLM extract/match, OpenRouter+AI SDK setup).

## 1. Goal

Invert the v2 mental model. The home page is now a **plain-text weekly meal planner**: paste recipe URLs or type a recipe / loose ingredient, and a list of recipes-with-ingredients builds up. The user commits to a specific supermarket only at checkout, when an LLM aggregates duplicate ingredients across recipes, searches each in the chosen store, picks the best SKU, and shows a review screen with matched / unmatched / skipped sections. Final action opens the supermarket's hosted cart in a new tab so the planner stays open.

## 2. Scope

### In

- Single top-level `Plan` persisted to localStorage at key `plan:v3`. One-shot wipe migration from v2 keys (`cart:jumbo`, `cart:carrefour`, `store`, `preferences`) on first load: `preferences` is ported into `Plan.preferences`; the others are deleted.
- New home-page (`/`) layout: single composite "Add" input at top; vertical stack of recipe cards; sticky bottom bar with "N ingredientes · M recetas" + "Checkout" button.
- Single composite add-input. URL detected by `/^https?:\/\//`. Free text routed to the same LLM extractor (label + ingredients). Single short string (≤ 4 words, no list structure) is auto-routed to a synthetic `Otros` recipe. The LLM makes the URL-vs-recipe-text-vs-loose-item call internally.
- Per-recipe actions: rename (click title), remove (with undo snackbar), collapse/expand. Per-ingredient actions: edit text, remove. Inline "+ add ingredient" at the bottom of each recipe.
- Checkout flow at `/checkout` (full-page route, not a modal). State machine persisted to localStorage at `Plan.lastResolution`. Steps: store choice → aggregate → search → match → review → hand-off.
- New endpoint `POST /api/recipe/extract` — input `{ url?: string; text?: string }`, output `{ label: string; ingredients: IngredientLine[] }`. No store, no SKU.
- New endpoint `POST /api/checkout/resolve` — input `{ store, recipes, preferences }`, output `Resolution` (matched + unmatched + skipped + per-ingredient candidates so swap is offline).
- Hand-off via `window.open(redirectUrl, '_blank', 'noopener')` synchronously inside the click handler. URL is pre-built once `Resolution.state === 'ready'`.
- Manual replacement on the resolution screen for `unmatched` items: typed query → existing `/api/search` → user picks → moves to matched.
- Swap UI on the resolution screen for matched items: shows the rest of the candidates (already cached on `Resolution`), one click swaps in. No re-search.
- Preferences: unchanged behavior, persisted at `Plan.preferences`. Sent to the aggregator (LLM #1) and matcher (LLM #2).

### Out (deferred to later)

- Recipe images / vision LLM — still v4+.
- Multi-store comparison.
- Reorder of recipes / drag-and-drop.
- Per-recipe quantities scaling ("cooking for 4 people").
- Saved past plans / history.
- Multi-user / auth.

## 3. Information architecture

### Storage shape

```ts
export type IngredientLine = {
  id: string;          // nanoid
  text: string;        // verbatim line as the LLM extracted or the user typed
  qty: number | null;  // parsed by extraction LLM
  unit: string | null; // 'g' | 'cucharada' | 'L' | etc.
  notes?: string;      // 'picado', 'tibia', etc.
};

export type Recipe = {
  id: string;
  label: string;       // editable by user
  source:
    | { kind: 'url'; url: string; status: 'extracting' | 'ready' | 'error'; error?: string }
    | { kind: 'manual' }
    | { kind: 'loose' }; // the synthetic "Otros" bucket
  ingredients: IngredientLine[];
  collapsed?: boolean;
  createdAt: number;
};

export type Plan = {
  version: 3;
  recipes: Recipe[];          // creation order; the synthetic 'loose' recipe (if any) is pinned to the bottom in render
  preferences: string;        // free text; same as v2
  lastStoreId: StoreId | null; // pre-selected at checkout for convenience
  lastResolution?: Resolution; // see §6
};
```

Identity: nanoid for both `Recipe.id` and `IngredientLine.id`. Indexes are unsafe across edits.

### Single localStorage key

`plan:v3`. JSON-encoded `Plan`. The migration job runs on first hydration: if `plan:v3` exists, do nothing. Otherwise: read `localStorage.getItem('preferences')` (if present, port to `Plan.preferences`), then delete `cart:jumbo`, `cart:carrefour`, `store`, `preferences`. Initialize `Plan` with empty `recipes`, the ported (or empty) `preferences`, `lastStoreId: null`.

### Loose ingredient bucket

A synthetic `Recipe` is auto-created the first time a loose ingredient is added: `{ id: <nanoid>, label: 'Otros', source: { kind: 'loose' }, ingredients: [...], createdAt: ... }`. There is at most one such recipe per plan. Subsequent loose adds append to its `ingredients`. The card renders pinned to the bottom of the list and is visually distinct (subtle "Otros" badge instead of a numbered title).

## 4. Add-to-list interactions

A single MUI `TextField` at the top of the home page, with a submit button. Multiline (textarea) so pasting multi-line recipes works; `Enter` submits unless `Shift+Enter` (which inserts a newline).

Routing decision (client-side, before any API call):

- If trimmed value matches `/^https?:\/\/\S+$/` → recipe-by-URL flow.
- Else → recipe-by-text flow (LLM also decides loose-vs-recipe).

### Recipe by URL

1. On submit, optimistically push a `Recipe` with `source: { kind: 'url', url, status: 'extracting' }`, label `"Cargando…"`, no ingredients. Card renders a spinner and the URL.
2. Fire `POST /api/recipe/extract` with `{ url }`.
3. On success: update the recipe in place — `source.status = 'ready'`, `label` = response label, `ingredients` = response array.
4. On failure: `source.status = 'error'`, `source.error = message`. Card shows error inline with "Reintentar" and "Quitar" buttons.
5. Duplicate detection: before push, if `recipes.some(r => r.source.kind === 'url' && r.source.url === url)`, skip the push and show a transient snackbar "Ya agregada"; do not duplicate.

The input clears immediately on submit so the user can paste several URLs in succession.

### Recipe by text

1. On submit, fire `POST /api/recipe/extract` with `{ text }`.
2. Add a placeholder recipe with `source: { kind: 'manual' }`, label `"Procesando…"`, no ingredients. Spinner.
3. On success: replace placeholder with the response.
4. On loose-item branch: the API returns the loose marker (`{ label: '<original text>', ingredients: [<single line>] }` plus a flag `isLoose: true`). Client appends to the synthetic `Otros` recipe instead of creating a new card. (No flicker: spinner/placeholder is removed and the `Otros` card animates in or grows.)

### LLM contract for `/api/recipe/extract`

```ts
// Input
type ExtractRequest = { url: string } | { text: string };

// Output
type ExtractResponse = {
  label: string;            // for URL: title of the recipe; for text: title or summary; for loose: the input verbatim
  ingredients: IngredientLine[];
  isLoose: boolean;         // true ⇒ caller routes to 'Otros'
};
```

LLM prompt: "Given a recipe page (HTML cleaned via Jina) OR free text, return its title and ingredient list in Argentine Spanish. If the input is a single short phrase (≤ 4 words, no list), set `isLoose: true` and treat it as a single ingredient."

The current `extractIngredients(html)` becomes one path of this endpoint. The text path runs the same LLM call with a different prompt prefix that doesn't reference HTML.

## 5. Cart list view (home page)

### Layout

- Container `<Container maxWidth='md'>` (narrower than v2's `lg`; this is a list, not a grid).
- Top: composite Add input (multiline TextField + Add button).
- Middle: vertical stack of `RecipeCard` components. Each card:
  - Header: editable label (click → inline edit), source affordance (small link icon for URL recipes; clicking opens the source URL in a new tab), collapse chevron, overflow menu (`Rename`, `Quitar`).
  - Body: ingredient list. Each row shows `text` plus a small qty/unit pill (e.g., `200 g`) when present. Hover/long-press reveals a `×` button.
  - Footer: `+ Agregar ingrediente` inline-add row.
- Synthetic `Otros` recipe pinned to bottom; same shape as a normal card but with a different header style (no link icon, no edit-title, no overflow menu — only "Quitar todos" if any).
- Sticky bottom bar (always visible, both desktop and mobile): `"N ingredientes · M recetas"` on the left, `Checkout` button on the right (disabled when `recipes` has no ingredients).

### Empty state

Friendly message: `"Pegá una URL de receta o escribí lo que querés cocinar."` with three small chips below as visual hints: `[URL]` `[Texto]` `[Ingrediente suelto]`. No illustration, no examples.

### Per-recipe actions

- **Rename**: click on label → inline `<TextField>`; Enter or blur saves; Escape cancels.
- **Quitar**: removes the recipe; shows undo snackbar with "Deshacer" for ~6s. Undo restores the recipe at its original index.
- **Collapse/expand**: chevron toggles `Recipe.collapsed`. Persisted in the plan.

### Per-ingredient actions

- **Edit**: click row → inline `<TextField>`; Enter or blur saves the new `text` (we don't re-parse qty/unit on edit — qty and unit stay as the LLM-extracted values; the user can also remove and re-add).
- **Remove**: × button.
- **Inline add**: bottom row in each card; submitting appends an ingredient with `text` set, `qty/unit/notes` null.

### Removed v2 surfaces

- Initial store-select modal — gone.
- `SearchPage` (search bar + product grid) on the home page — gone. Component salvaged into a reusable `<ProductSearch>` for manual replacement on the resolution screen (§7).
- `CartDrawer` — gone. The page is the cart.
- Navbar cart icon, navbar store-switcher button — gone.
- `/api/checkout` route — gone. URL building is pure; inlined at the resolution step.
- `/api/recipe` route — renamed to `/api/recipe/extract` and refocused (no store, no SKU output).

### Kept v2 surfaces

- Navbar gear icon → preferences dialog (now writes to `Plan.preferences`).
- Navbar theme toggle.
- Snackbar (repurposed for adds, removes, errors, undo).

## 6. Resolution state machine

```ts
type Resolution =
  | { state: 'idle' }
  | { state: 'aggregating'; storeId: StoreId; startedAt: number }
  | { state: 'searching';   storeId: StoreId; aggregated: AggregatedIngredient[] }
  | { state: 'matching';    storeId: StoreId; aggregated: AggregatedIngredient[]; candidates: Product[][] }
  | {
      state: 'ready';
      storeId: StoreId;
      matched: MatchedItem[];        // { ingredient, picked: Product, qty }
      unmatched: AggregatedIngredient[];
      skipped: SkippedIngredient[];  // { name, reason }
      candidates: Product[][];        // parallel to aggregated; cached for swap UI
      redirectUrl: string;            // pre-built; recomputed on every mutation
    }
  | { state: 'handed-off'; storeId: StoreId; matched: MatchedItem[]; redirectUrl: string; handedOffAt: number }
  | { state: 'error'; storeId: StoreId; failedAt: 'aggregate' | 'search' | 'match'; message: string };

type AggregatedIngredient = {
  id: string;
  name: string;
  qty: number | null;
  unit: string | null;
  sources: { recipeId: string; recipeLabel: string; originalText: string }[];
};

type MatchedItem = {
  aggregatedId: string;
  ingredient: AggregatedIngredient;
  picked: Product;
  confidence: 'high' | 'medium' | 'low';
};

type SkippedIngredient = { name: string; reason: string }; // e.g. "pantry staple"
```

### Transitions

- `idle` → `aggregating` on user clicking "Continuar" after store choice.
- `aggregating` → `searching` automatic, on aggregate response.
- `searching` → `matching` automatic, on VTEX responses.
- `matching` → `ready` automatic, on match response.
- `ready` → `ready` on user mutations: swap (replace `picked`), remove, manual-add (move from `unmatched` to `matched`), promote-skipped (move from `skipped` to `unmatched` and re-search inline), edit qty.
  Each `ready→ready` mutation also recomputes `redirectUrl` synchronously.
- `ready` → `handed-off` on user click "Send to {store}".
- `handed-off` → `idle` on explicit `Vaciar plan` or new checkout.
- `aggregating | searching | matching` → `error` on any failure.
- `error` → `aggregating` on user "Reintentar".
- any of `ready | error` → `idle` (with new `aggregating` cycle starting after store reselect) on user clicking "Volver" → sends the user back to step (b) of §7.

### Plan-mutation invalidation

Any mutation to `Plan.recipes` (add, remove, edit, rename) sets `Plan.lastResolution = undefined`. The user will see step (b) on next click of "Checkout", not a stale resolution.

### Persistence

Every transition writes the entire `Plan` to localStorage. So the user can navigate to/from `/checkout`, refresh the tab, and still see the resolution they had.

## 7. Checkout flow

A full-page route at `/checkout`. Reads `Plan` from localStorage on mount. If `recipes` is empty, redirects to `/`.

### (a) Click "Checkout"
Sticky bar button on `/` navigates to `/checkout`. No async work yet.

### (b) Store selection

- Inline at the top of `/checkout`.
- Two large `<Card>` tiles side-by-side: `Jumbo`, `Carrefour`. Border-highlighted if `Plan.lastStoreId` matches. Click to select.
- Below: `Continuar` button (disabled until a tile is selected).
- Also: `Volver al plan` link in the header.

### (c) Aggregating + searching + matching (one work step)

- Click `Continuar` → state becomes `aggregating`.
- Single full-page loading view: centered MUI `<CircularProgress>` + a status line. Status text updates as the substate transitions: `"Unificando ingredientes…"` → `"Buscando en {store}…"` → `"Eligiendo productos…"`.
- Behind the scenes: `POST /api/checkout/resolve` is called with `{ store, recipes, preferences }`. Server:
  1. **Aggregate (LLM #1)**: input is the entire flattened ingredient list with recipe-source attribution. Output is `{ aggregated: AggregatedIngredient[]; skipped: SkippedIngredient[] }`. Pantry staples (water, salt, pepper, oil, sugar) default-drop into `skipped` with `reason: 'pantry staple'`. Multiple instances of the same ingredient unify (sum quantities when units match; pick a generous-rounded total when they don't, with `notes` capturing the per-source originals).
  2. **Search VTEX**: parallel `productSearch(store, name)` for each aggregated ingredient.
  3. **Match (LLM #2)**: same `pickSkus` shape as v2 but operating over aggregated ingredients (no plural of recipes). Returns picks.
  4. Server constructs `MatchedItem[]`, computes `redirectUrl` via `buildAddToCartUrl`, returns the full `Resolution` `ready` payload.
- Client merges the response into `Plan.lastResolution` and persists.

### (d) Resolution screen

When `state === 'ready'`. Three sections, each a list:

1. **Listo para enviar** (matched). Per row: aggregated name + qty/unit pill, the picked product image (small thumbnail), product name, price, confidence dot (small circle, color-coded), `de: <recipe labels>` subtext, swap action button (`⇄`), remove action (`×`). Click `⇄` → inline expansion shows the other candidates from `Resolution.candidates[idx]` (max 6); click one to set as the new `picked`.

2. **No encontramos** (unmatched). Per row: aggregated name + qty/unit, plus an inline `<ProductSearch>` mini-component (typed query → `/api/search` → list of results → click "Usar este" to move into matched). Also `Ignorar` to remove from unmatched without resolving.

3. **Saltadas** (skipped). Collapsed by default. Per row: name + reason. `Volver a buscar` button promotes back into unmatched and runs `productSearch` for it inline.

Top of screen: total ($X · N productos), `Volver` (returns to step (b); discards resolution; sets `lastResolution = undefined`), and primary `Send to {store}` button.

Editing qty inline: each matched row's qty pill is clickable → small spinner control (1, 2, 3…). Updates `MatchedItem.ingredient.qty`. Recomputes `redirectUrl`.

### (e) Hand-off

The `Send to {store}` button's `onClick` is **synchronous**:

```tsx
<Button onClick={() => {
  window.open(resolution.redirectUrl, '_blank', 'noopener');
  setResolution({ ...resolution, state: 'handed-off', handedOffAt: Date.now() });
}}>
```

No `await`, no `fetch` between the click and `window.open` — popup blockers permit `window.open` only as a direct user gesture.

### (f) After hand-off

The user is on a new tab on the supermarket site. The planner tab still shows `/checkout` in `handed-off` state with a banner: `"Lista enviada a {store}. Empezá una nueva semana cuando estés listo."` plus a primary `Vaciar plan` button (clears `recipes`, `lastResolution`; keeps `preferences` and `lastStoreId`).

Plan does NOT auto-clear. The user explicitly clicks `Vaciar plan`.

## 8. Module / file map

### New

- `src/types/plan.ts` — `Plan`, `Recipe`, `IngredientLine`, plan-level Zod schemas. (Note: `IngredientLine` overlaps with v2's `Ingredient` — we keep the v2 type for the LLM contract and define `IngredientLine` for plan storage; they have the same shape but are distinct conceptually.)
- `src/lib/storage/plan.ts` — `readPlan() / writePlan() / mutatePlan(fn)` plus the v2-key migration on first load.
- `src/lib/recipe/extract-text.ts` — text-mode counterpart to the existing URL extraction. Same LLM model, different prompt prefix.
- `src/lib/checkout/aggregate.ts` — LLM #1 (aggregate). Input `Recipe[] + preferences`. Output `{ aggregated, skipped }`.
- `src/lib/checkout/resolve.ts` — orchestrator (aggregate + parallel search + match) producing the `Resolution` ready payload.
- `src/app/api/recipe/extract/route.ts` — replaces `/api/recipe`.
- `src/app/api/checkout/resolve/route.ts` — new.
- `src/app/checkout/page.tsx` — the full-page route with state machine.
- `src/hooks/usePlan.ts` — wraps `lib/storage/plan.ts` with React state.
- `src/containers/AddRecipeBar.tsx` — top-of-page composite input.
- `src/containers/RecipeCard.tsx`, `IngredientRow.tsx`, `OtrosCard.tsx`.
- `src/containers/CheckoutStoreSelect.tsx`, `CheckoutLoading.tsx`, `CheckoutResolution.tsx`, `CheckoutHandedOff.tsx`.
- `src/containers/ProductSearch.tsx` — extracted from `SearchPage` for reuse on the resolution screen.

### Modified

- `src/app/page.tsx` — replaced wholesale (planner layout).
- `src/app/layout.tsx` — title to `"Recetas"` or similar (still TBD copy; not load-bearing).
- `src/containers/Navbar.tsx` — drop cart icon, drop store switcher; keep gear (preferences) and theme.
- `src/containers/index.ts` — drop `CartDrawer`, `SearchPage`, `RecipeInput`, `StoreSelectModal`. Add the new containers.
- `src/lib/llm/extract.ts` — keep but generalize: accept either `html` (from Jina) or plain text. Return `{ label, ingredients, isLoose }`.

### Deleted

- `src/app/api/recipe/route.ts` — replaced by `/api/recipe/extract`.
- `src/app/api/checkout/route.ts` — URL builder inlined into `lib/checkout/resolve.ts`.
- `src/containers/CartDrawer.tsx`, `SearchPage.tsx`, `StoreSelectModal.tsx`, `RecipeInput.tsx` — supplanted by new components. (Search logic lifted into `ProductSearch.tsx`.)
- `src/lib/storage/cart.ts`, `src/lib/storage/store.ts` — supplanted by `plan.ts`. (The `preferences.ts` storage helper survives but is now used only by the migration path; reads in v3 go through `Plan.preferences`.)
- `src/hooks/useCart.ts`, `src/hooks/useStore.ts` — deleted.
- v2 spec files stay; this v3 spec supersedes the home-page UX in the v2 spec, leaves backend primitives untouched.

## 9. LLM contracts (v3 specifics)

### Aggregate (LLM #1, server-side at `/api/checkout/resolve`)

Input:
```ts
{
  recipes: Recipe[];      // including 'Otros' if present
  preferences: string;
}
```

Output (Zod-validated):
```ts
{
  aggregated: { id, name, qty, unit, sources: { recipeId, recipeLabel, originalText }[] }[];
  skipped:    { name, reason }[];
}
```

Prompt (paraphrase): "Given a list of recipes with ingredient lines, produce a unified shopping list. Combine duplicates across recipes (same item: sum quantities; pick a sensible total when units differ; record per-source originals). Drop common pantry staples (salt, pepper, water, plain oil, sugar, baking soda) into a `skipped` list with reason `'pantry staple'` UNLESS the user's preferences say otherwise. Return all output names in Argentine Spanish (es-AR)."

### Match (LLM #2, server-side at `/api/checkout/resolve`)

Same as v2 `pickSkus`, but the input is `AggregatedIngredient[]` instead of `Ingredient[]`. Output schema unchanged. Apply the same Zod-v4 caveat: no `.int()` / `.min()` / `.max()` on numeric fields (Anthropic rejects them in JSON Schema).

### Extract (LLM, server-side at `/api/recipe/extract`)

Two modes (URL via Jina-cleaned text, or pasted text). Same model, same Zod output:
```ts
{ label: string; ingredients: IngredientLine[]; isLoose: boolean }
```

System prompt picks the `isLoose` branch when input is a single short phrase. Otherwise returns full title + ingredient list.

## 10. Edge cases (decisions made)

- **Same recipe URL added twice** → silently no-op with snackbar `"Ya agregada"`.
- **URL fetch fails** → recipe in `error` state; inline `Reintentar` / `Quitar`. Aggregation ignores recipes with `source.status !== 'ready'`.
- **0 ingredients extracted** → recipe rendered as ready but empty; hint banner inside the card: `"No encontramos ingredientes en esa página. Agregalos a mano."`. Inline-add still works.
- **Mismatched units in aggregation** (e.g., `200g flour` + `1 cup flour`) → LLM normalizes; if it can't, it returns `qty: null, unit: null, notes: "200g + 1 cup"`. Matcher buys a sensible package.
- **Pantry staples** → default-skipped into `skipped[]`, visible (collapsed by default) on resolution screen, promotable.
- **Wrong pick** → swap UI on resolution row, candidates pre-loaded.
- **Unmatched ingredient** → inline `<ProductSearch>` mini-component on the row.
- **User changes mind about supermarket mid-checkout** → `Volver` button on resolution screen returns to step (b); resolution is discarded.
- **Network failure during resolution** → `state === 'error'` with substep + message; `Reintentar` re-runs from aggregate (idempotent; cheap).
- **Plan mutation after resolution** → `lastResolution` invalidated; next `Checkout` click starts fresh at step (b).
- **`OPENROUTER_API_KEY` missing** → API returns 500 with `MISSING_API_KEY` (existing behavior). Resolution lands in `error` state; `Reintentar` re-runs (still fails until user fixes env).

## 11. Tests

| Layer | Tool | Scope |
|---|---|---|
| Unit | Jest | `lib/storage/plan.ts` — read/write/migrate; v2-keys-present case ports `preferences` and clears the rest; idempotency on re-mount. |
| Unit | Jest | `lib/recipe/extract-text.ts` — text path returns the same shape as URL path; `isLoose` branch on short input. |
| Unit | Jest | `lib/checkout/aggregate.ts` — mocked LLM; verifies prompt includes preferences when present, omits when empty; correctly merges duplicate-ingredient input. |
| Unit | Jest | `lib/checkout/resolve.ts` — orchestration; mocked aggregate + search + match; verifies parallel `productSearch`, candidate caching, `redirectUrl` building; mutation paths (swap / remove / promote-skipped / qty edit) recompute the URL. |
| Unit | Jest | Component-state tests for `RecipeCard` rename / remove / undo flow (using existing testing-library, if installed; otherwise Playwright covers this). |
| Live | Jest (`*.live.test.ts`, env-gated) | One run that aggregates a 2-recipe fixture and matches against real Jumbo. Cost: a single Claude call. |
| E2E | Playwright | New specs: paste URL → recipe card appears with ingredients (mocked extract); paste text → manual recipe card; type single phrase → `Otros` card; remove + undo; checkout flow with mocked `/api/checkout/resolve` returning a fixed payload, verify resolution screen renders matched/unmatched/skipped, swap, remove, "Send to {store}" → asserts `window.open` was called with the right URL. |
| Manual smoke | Browser | Real recipe URL → planner → checkout against Jumbo and Carrefour, verifies new tab opens. |

## 12. Acceptance criteria

The v3 milestone is complete when:

1. First load with v2 keys present cleanly migrates `preferences` and clears the rest.
2. Pasting a recipe URL on `/` produces a recipe card with the LLM-extracted label and ingredients within ~15s.
3. Pasting a multi-line recipe text produces a manual recipe card.
4. Typing a single short phrase produces an entry in the `Otros` card.
5. Removing a recipe shows an undo snackbar; clicking undo restores it.
6. Clicking `Checkout` navigates to `/checkout` and shows store selection with `lastStoreId` highlighted.
7. Continuing through the work step renders matched / unmatched / skipped sections with reasonable picks.
8. Swap UI on a matched row replaces the picked product without a re-search.
9. Manual replacement on an unmatched row resolves it via `/api/search`.
10. `Send to {store}` opens a new tab pointing to the supermarket cart-add URL with all matched items in the query string; the planner tab stays on `/checkout` in `handed-off` state.
11. `Vaciar plan` clears recipes and resolution but preserves `preferences` and `lastStoreId`.
12. `pnpm test:unit` passes (≥ existing 34 plus new ~15 tests).
13. `pnpm test:e2e` passes (existing 4 plus new ~3 v3 specs; v2 specs that test the killed surfaces are removed).
14. `pnpm test:live` passes when env is configured.

## 13. Risks and notes

- **Aggregator quality.** The aggregate LLM step is new and load-bearing. Bad aggregation means duplicate items in the cart or missed combinations. Mitigation: tight prompt; explicit examples in the prompt for unit normalization; `Resolution` keeps `sources[]` so we can debug what the LLM did. Empirical verification on at least one multi-recipe live test before declaring done.
- **State machine complexity.** The resolution state machine is the riskiest part of v3. Mitigation: persist every transition to localStorage (so a buggy edge case is recoverable by the user navigating away and back); explicit Zod schema on `Resolution`; comprehensive unit test on `lib/checkout/resolve.ts`.
- **Hand-off URL recomputation.** Any mutation on the resolution screen must recompute `redirectUrl` synchronously before the next render. If we forget, the `window.open` could fire a stale URL. Mitigation: derive `redirectUrl` inside the React state-update reducer / mutation function — never store it stale.
- **Popup blockers.** The `window.open` MUST be inside the click handler. Mitigation: forbid any `await` between the click and `window.open` in code review; the resolution work happens before `ready`, so by the time the user clicks `Send`, the URL is ready. Validated by the Playwright spec.
- **Migration data loss.** If the migration is buggy, the user loses their v2 carts. Mitigation: v2 carts are per-store-SKU lists with no semantic value beyond the user's current shopping intent — the user clears their browser carts often anyway. We log the wiped keys to console once at migration so it's debuggable. **Don't block on migration failure** — proceed with empty plan.
