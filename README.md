# Supermarket — Recipe-First Planner

A personal weekly meal planner that ends in a populated supermarket cart. Paste recipe URLs, pasted recipe text, or loose ingredients into a plain-text shopping list grouped by recipe; at checkout, an LLM unifies duplicate ingredients across recipes, picks SKUs in your supermarket of choice, and opens the supermarket's cart in a new tab with everything pre-filled.

Currently targets Argentine supermarkets that run on VTEX: **Jumbo** and **Carrefour**. Integration is anonymous (no API keys for the supermarket side; you log in to pay on the supermarket's own checkout).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/supermarket&env=OPENROUTER_API_KEY&envDescription=OpenRouter%20API%20key%20for%20LLM%20calls&envLink=https://openrouter.ai/keys)

> Replace `YOUR_USERNAME/supermarket` in the deploy button URL with your fork's path.

## Features

- **Plain-text shopping list grouped by recipe.** Paste a recipe URL, paste a recipe text, or type a single loose ingredient — the LLM extracts ingredients in Argentine Spanish and adds them as a card. Loose items pool into an "Otros" card.
- **Delayed resolution.** You commit to a specific supermarket only at checkout. Switching stores doesn't trash the plan.
- **LLM aggregation across recipes.** "1 cebolla" in three recipes becomes "3 cebollas" in the shopping list. Imperial cooking units (cups, tbsp, tsp, oz, lb) auto-convert to supermarket-friendly units (g, ml, kg, L, unidad). Pantry staples (sal, pimienta, aceite común, agua) auto-skip into a "Saltadas" section, promotable.
- **Per-package cart quantities.** "500 g harina" matched to "Harina 0000 1 Kg" sends 1 package to the cart, not 500. Computed by the matcher from each candidate's package size.
- **Inline swap and manual search.** Wrong pick? Click swap to choose from the other VTEX search candidates (with photos). Unmatched ingredient? Search manually inline.
- **Free-text preferences.** "Prefer lactose-free dairy", "always La Serenísima", whatever — passed to the matcher LLM at checkout. Saved in localStorage.
- **Keep the resolution open after sending.** The new-tab hand-off lets you compare the supermarket cart against what we resolved, without losing the resolution view.

## Stack

Next.js 15 (App Router), React 19, MUI v6, TypeScript, pnpm. LLM via OpenRouter + Vercel AI SDK + `anthropic/claude-sonnet-4.6` (1M-context, native). Jest for unit + live LLM tests, Playwright for E2E.

## Quick start

### Hosted (recommended for personal use)

Click the Vercel button above. You'll need:
- A free [Vercel](https://vercel.com) account.
- A free [OpenRouter](https://openrouter.ai/keys) API key with credit available — `anthropic/claude-sonnet-4.6` is roughly $3/M input tokens, ~$0.05 per checkout, and you can cap your spend on OpenRouter.

Set `OPENROUTER_API_KEY` in the Vercel project's environment variables.

### Local

```bash
pnpm install
cp .env.example .env
# add OPENROUTER_API_KEY=sk-or-... to .env
pnpm dev   # http://localhost:3000
```

## Flow

1. **Plan** (`/`). Paste a URL, paste text, or type a loose item. Each becomes a recipe card. Edit, rename, remove (with undo), collapse.
2. **Preferences** (gear icon, top right). Free-text preferences for the matcher LLM.
3. **Checkout** (`/checkout`). Pick supermarket → LLM aggregates ingredients → VTEX search per ingredient → LLM picks SKUs and computes cart quantities. The resolution screen shows three sections:
   - **Listo para enviar** — matched picks with photos, recipe-need caption, package count, swap UI.
   - **No encontramos** — unmatched aggregated ingredients with inline manual search.
   - **Saltadas** — pantry staples the LLM dropped, promotable back into search.
4. **Send**. Click "Enviar a {store}" → new tab opens on the supermarket with all items in the cart. The resolution view stays open in your tab so you can compare.
5. When done, click **Vaciar plan** at the bottom of the resolution screen.

## Architecture (one-screen overview)

```
Browser (planner UI / resolution UI)
   │ POST /api/recipe/extract       (URL or pasted text)
   │ POST /api/checkout/resolve     ({store, recipes, preferences})
   │ GET  /api/search               (manual replacement)
   ▼
Next.js Route Handlers
   │
   ├─ lib/recipe/fetch.ts            URL → cleaned text via r.jina.ai (bypasses Cloudflare)
   ├─ lib/llm/extract.ts             cleaned text → { label, ingredients[], isLoose }
   ├─ lib/checkout/aggregate.ts      recipes → { aggregated[], skipped[] } (LLM #1)
   ├─ lib/vtex/search.ts             per ingredient → top candidates from VTEX
   ├─ lib/llm/match.ts               { ingredients, candidates, prefs } → picks with cartQty (LLM #2)
   └─ lib/checkout/resolve.ts        orchestrates + builds VTEX add-to-cart URL
```

The browser then `window.open`s the URL — the supermarket adds the items to that browser's session and the user pays on the supermarket's hosted checkout.

## Scripts

| Script | What |
|---|---|
| `pnpm dev` | Dev server on http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build & serve |
| `pnpm test:unit` | Jest unit tests |
| `pnpm test:live` | Live integration tests against real Jumbo/Carrefour and OpenRouter (gated by `LIVE_TESTS=1` and `OPENROUTER_API_KEY`; ~$0.10 / run) |
| `pnpm test:e2e` | Playwright E2E (mocked APIs) |
| `pnpm format` | Prettier + ESLint |

## Design docs

The full v1 → v2 → v3 design history lives in `docs/superpowers/`:

- v3 (current): `docs/superpowers/specs/2026-05-04-recipe-first-planning-design.md`
- v2 (recipe URL → immediate cart): `docs/superpowers/specs/2026-05-04-recipe-url-to-cart-design.md`
- v1 (PoC, single-supermarket cart): `docs/superpowers/specs/2026-05-04-supermarket-poc-design.md`
- VTEX endpoint research: `docs/superpowers/research/2026-05-04-vtex-samples.md`

## Roadmap

What's intentionally not in scope right now:
- Recipe images (vision LLM).
- More stores (Día / Disco / Vea — same VTEX, mostly config).
- Multi-supermarket comparison.
- Auth / multi-user.

If the project ever stops being personal-use, the obvious next steps are: per-user plans behind auth, recipe images, and Día/Disco/Vea support.

## License

Private, personal-use. Fork and use however; no warranty.
