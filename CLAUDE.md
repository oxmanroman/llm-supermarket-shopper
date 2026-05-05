# CLAUDE.md

Working notes for AI agents (Claude Code, Cursor, etc.) operating in this repo. Captures the load-bearing knowledge that has bitten us during development. Read once at session start; the README is for users, this file is for you.

## Project in one paragraph

Personal weekly meal planner for Argentine supermarkets (Jumbo, Carrefour, both VTEX). User pastes recipe URLs / pasted recipe text / loose ingredients on the home page. At checkout, an LLM aggregates duplicates across recipes, searches each on the chosen store, picks SKUs and per-package cart quantities, and opens the supermarket's add-to-cart URL in a new tab. Backend integration is anonymous (the user pays on the supermarket's own hosted checkout). Two users total; data lives entirely in localStorage. No auth, no DB.

## Stack

- Next.js 15 (App Router), React 19, MUI v6, TypeScript strict.
- LLM: OpenRouter + Vercel AI SDK + `anthropic/claude-sonnet-4.6` (native 1M context — **do not** add `:extended` suffix; OpenRouter returns "No endpoints found" for current models with that suffix).
- pnpm only. Path alias `~/` → `src/`.
- Jest for unit + opt-in live tests, Playwright for E2E (chromium reliable; webkit may fail on missing system libs).
- Lint-staged + husky. Conventional Commits enforced by user preference.

## Architecture (where things live)

```
src/
  app/
    page.tsx                              planner home — recipe cards + sticky checkout bar
    checkout/page.tsx                     state-machine page: store-select → loading → resolution
    api/recipe/extract/route.ts           POST: URL or text → { label, ingredients, isLoose }
    api/checkout/resolve/route.ts         POST: full resolve pipeline
    api/search/route.ts                   GET: VTEX search proxy (used by manual replacement)
  lib/
    recipe/fetch.ts                       fetches recipe URL via r.jina.ai proxy
    llm/extract.ts                        extract LLM (URL OR text → ingredients)
    llm/match.ts                          match LLM (ingredients + candidates → picks with cartQty)
    llm/types.ts                          Zod schemas (IngredientSchema, PickSchema, ExtractResultSchema)
    llm/client.ts                         OpenRouter client, MODEL_ID constant
    llm/errors.ts                         describeLlmError() — surfaces upstream details
    checkout/aggregate.ts                 aggregate LLM (per-recipe → unified shopping list)
    checkout/resolve.ts                   orchestrator: aggregate → search → match → URL build
    vtex/search.ts                        productSearch(store, query)
    vtex/cart.ts                          buildAddToCartUrl(store, items)
    vtex/stores.ts                        STORES table; Jumbo=32 SC, Carrefour=1 SC
    storage/plan.ts                       readPlan/writePlan/mutatePlan + v2 migration
    storage/preferences.ts                free-text preferences (free-text)
  hooks/
    usePlan.ts                            useState wrapper around Plan storage
    usePreferences.ts                     same for preferences
  containers/                             MUI containers; named exports
  types/plan.ts                           Plan, Recipe, IngredientLine, Resolution, MatchedItem
docs/superpowers/                         specs and plans, one per milestone
```

Tests live alongside as `__tests__/*.test.ts`. Live tests are `*.live.test.ts` and skipped unless both `LIVE_TESTS=1` and `OPENROUTER_API_KEY` are set.

## Conventions (user-enforced)

- **Conventional Commits** for every commit (`feat(scope): ...`, `fix(scope): ...`, `docs:`, `test:`, `chore:`, `refactor:`). Semantic PR checks reject commits without the prefix.
- **Never add `Co-Authored-By` lines.** No exceptions.
- **Skip approval gates after writing specs.** User prefers spec → plan → build flow with no "please review" pause unless they ask.
- **Prefer LLM-driven logic over deterministic code** when it keeps the implementation simpler. Cost is acceptable. Examples: ingredient aggregation/dedup/translation/unit conversion are all LLM tasks here, not regex pipelines.
- **Use named exports**, not default exports (frontend rule).
- **No `any`.** Use `unknown` when a type is genuinely unknown; cast at the boundary with explicit reason.
- **No comments unless they explain WHY.** Don't restate what the code does. Don't reference task numbers or PR titles. Do explain non-obvious constraints, gotchas, and load-bearing decisions — see e.g. comments in `aggregate.ts` and `recomputeRedirectUrl`.

## Load-bearing knowledge (gotchas that have bitten us)

These are the ones to memorize. Each represents a real bug we hit and fixed.

### 1. Zod v4 + Anthropic structured output

**Do not** use `.int()`, `.nonnegative()`, `.min()`, `.max()` on numeric fields in any Zod schema passed to `generateObject`. Zod v4 emits safe-integer `minimum`/`maximum` (-2⁵³+1, 2⁵³-1) in JSON Schema, and Anthropic's structured-output validator rejects ANY `minimum`/`maximum` on `integer` types with:

```
output_config.format.schema: For 'integer' type, properties maximum, minimum are not supported
```

Use plain `z.number()` for indices and counts. Validate range in code if needed.

### 2. Cart-add URL `qty` is package count, not weight

The supermarket's `https://www.{store}.com.ar/checkout/cart/add?sku=X&qty=N&...` URL's `qty` parameter means "add N packages of SKU X to the cart". It is **not** the recipe quantity in g/ml/unidad. So a recipe needing 500 g of flour matched to a 1 kg package needs `qty=1`, not `qty=500`.

The matcher LLM computes `cartQty` per pick by parsing the package size from the candidate name (e.g. "Harina 0000 1 Kg Caserita") and dividing the recipe need, rounded up. `MatchedItem.cartQty` carries it through; `recomputeRedirectUrl` uses it.

### 3. Jumbo's VTEX sales channel is 32, not 1

`STORES.jumbo.defaultSalesChannel: '32'`. Carrefour is `1`. Discoverable from each storefront's `/api/sessions` response (the `vtex_segment` cookie's `channel` field). If you mismatch, cart-add silently fails with `ORD027` ("Ítem no encontrado o no disponible") and you'd have no idea — the orderForm `messages` array is the only signal.

### 4. Recipe URL fetch must go through Jina

`fetchAndCleanHtml(url)` proxies through `https://r.jina.ai/<url>`. Direct server-side fetch from Vercel/our egress IPs gets 403'd by Cloudflare on some recipe sites (e.g. `alicante.com.ar`) regardless of headers — Cloudflare fingerprints Node's TLS handshake. Jina sees the source from its own IP and returns clean Markdown.

### 5. Imperial unit conversion lives in the aggregator, not extract

Sonnet 4.6 stubbornly preserves "cups/tbsp/taza/cucharada" at extract time even with worked examples and strict final-check rules. We tried; it doesn't yield. Conversion to supermarket-friendly units (g/kg/ml/L/unidad) happens in the **aggregate** step, which already normalizes for cross-recipe unification, so it applies to single-recipe imperial inputs too.

### 6. Aggregator output unit must be in `{g, kg, ml, L, unidad, null}`

Anything else (taza, cucharada, cdita, cup, tbsp) is a bug — the live eval suite (`src/lib/checkout/__tests__/eval.live.test.ts`) asserts this on every fixture in en/es/fr.

### 7. Plan mutation must invalidate `lastResolution`

Any change to `Plan.recipes` invalidates the cached resolution. Otherwise after a successful checkout, adding a new recipe and clicking Checkout again would surface the stale resolution. The `updateRecipes(fn)` helper in `src/app/page.tsx` does this — every recipe-touching mutation goes through it. Collapse-toggle stays on plain `update` because it's UI-only.

### 8. New-tab hand-off must be synchronous

`window.open(redirectUrl, '_blank', 'noopener')` MUST run inside the click handler, with no `await` between the click and the call. Popup blockers fire otherwise. That's why the resolution screen pre-builds `redirectUrl` (in `recomputeRedirectUrl`) — by the time the user clicks "Enviar", the URL is ready.

### 9. Sending to supermarket no longer transitions UI state

Clicking "Enviar a {store}" only opens the new tab. The resolution screen stays put so the user can compare what we sent against the supermarket cart. "Vaciar plan" is the explicit gesture to clear the plan; it lives at the bottom of the resolution screen with a confirmation dialog.

## Test patterns

- **Unit tests** mock `ai`'s `generateObject` and `productSearch`. They live alongside source as `__tests__/*.test.ts` (Jest auto-discovers).
- **Live tests** (`*.live.test.ts`) are gated:
  ```ts
  const live = process.env.LIVE_TESTS === '1' && Boolean(process.env.OPENROUTER_API_KEY);
  const liveDescribe = live ? describe : describe.skip;
  ```
  They run with `pnpm test:live`. Cost real OpenRouter tokens (~$0.10 for the full eval suite).
- **E2E tests** (Playwright) live in `tests/poc.spec.ts`. They mock `/api/**` so they don't depend on the LLM.
- **The "eval" file** (`src/lib/checkout/__tests__/eval.live.test.ts`) runs 6 recipe fixtures (es×2, en×2, fr×2) end-to-end through the LLM and asserts on the cartQty regression, unit normalization, and pantry-skip coverage. Run after any prompt change to either `aggregate.ts` or `match.ts`.

When you change an LLM prompt: run the eval suite. If a fixture fails, iterate the prompt; don't loosen the test unless the assertion was opportunistic (e.g., "this specific brand should appear in matches" — that's a quality signal, not a correctness invariant).

## When the user reports a bug

Use the **superpowers:systematic-debugging** skill. The pattern that has worked:
1. Reproduce with a real recipe (curl `/api/checkout/resolve` directly is fast — see `_test-fetch.mjs`-style ad-hoc scripts in commit history).
2. Trace the data through the pipeline. The four LLM-touching seams are extract → aggregate → search → match. Errors in the bug usually live at one of those boundaries.
3. Form ONE hypothesis, write a failing test, then fix.
4. Re-run the live eval suite to confirm no regression on other fixtures.

## Don't

- Don't run `pnpm next dev` directly — use `pnpm dev`. The pre-existing port 3000 is sometimes held by a stale process; use `-p <other-port>` if it's busy.
- Don't add a `next.config` flag for `experimental.optimizeFonts` or similar — boilerplate is intentionally minimal.
- Don't propose Promptfoo, Braintrust, or other eval frameworks; user explicitly preferred a Jest live-test suite for simplicity.
- Don't add Co-Authored-By, ever. The user has flagged this multiple times.
- Don't `auto-clear` the plan after a successful checkout. The user explicitly clicks "Vaciar plan".
- Don't ask the user to "review the spec" after writing one. Skip straight to plan + build.

## Where the spec & plan history lives

`docs/superpowers/specs/` and `docs/superpowers/plans/`, one per milestone (v1 PoC, v2 immediate-cart, v3 recipe-first-planner). Read the latest spec for any non-trivial change to understand intent. The plans capture the implementation order and load-bearing decisions; the specs capture the what/why.
