# Supermarket — Recipe-First Planner

Personal-use weekly meal planner that ends in a populated supermarket cart. The user adds recipes (URL, pasted text, or single loose ingredient) into a plain-text shopping list grouped by recipe; at checkout, an LLM aggregates duplicates across recipes, searches each in the chosen supermarket, picks the best SKU, and opens the supermarket's cart in a new tab with everything pre-filled.

Currently supports: Jumbo, Carrefour. Both run on VTEX; integration is anonymous.

## Stack

Next.js 15 (App Router), React 19, MUI v6, TypeScript, Jest, Playwright, pnpm. LLM via OpenRouter + Vercel AI SDK + `anthropic/claude-sonnet-4.6` (1M context, native).

## Setup

```bash
pnpm install
cp .env.example .env
# add OPENROUTER_API_KEY=... to .env
```

## Scripts

| Script | What |
|---|---|
| `pnpm dev` | Dev server on http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build & serve |
| `pnpm test:unit` | Jest unit tests |
| `pnpm test:live` | Live integration tests against real Jumbo/Carrefour and OpenRouter (skipped from `test:unit`) |
| `pnpm test:e2e` | Playwright E2E |
| `pnpm format` | Prettier + ESLint |

## Flow

1. **Plan** (`/`). Paste a recipe URL, paste recipe text, or type a single ingredient. Each becomes a card in the recipe-grouped list (loose ingredients pool into an "Otros" card). Edit, rename, remove (with undo), collapse.
2. **Preferences** (gear icon). Free-text shopping preferences saved to localStorage, sent to the LLM at checkout.
3. **Checkout** (`/checkout`). Pick supermarket → LLM aggregates ingredients → VTEX search per ingredient → LLM picks SKUs. Resolution screen shows matched / unmatched (with inline manual search) / skipped (pantry staples). Swap candidates inline. Edit qty inline.
4. **Send**. Opens the supermarket's `/checkout/cart/add?sku=...` URL in a new tab; planner stays open. Click "Vaciar plan" when ready to start a new week.

## Manual smoke

After any non-trivial change:
1. `pnpm dev` → http://localhost:3000.
2. Paste a real Argentine recipe URL → recipe card appears with ingredients.
3. Paste another recipe (or text). Type a loose item ("yerba") → goes to Otros.
4. Click Checkout → pick Jumbo → wait ~10–30s → resolution screen.
5. Swap one matched product. Manually search for one unmatched. Edit a qty.
6. Click "Enviar a Jumbo" → new tab opens on jumbo.com.ar with the cart populated. Log in there to pay.
7. Repeat with Carrefour.

## Specs & plans

- v1 (PoC): `docs/superpowers/specs/2026-05-04-supermarket-poc-design.md`, `docs/superpowers/plans/2026-05-04-supermarket-poc.md`
- v2 (recipe URL → cart, immediate): `docs/superpowers/specs/2026-05-04-recipe-url-to-cart-design.md`, `docs/superpowers/plans/2026-05-04-recipe-url-to-cart.md`
- v3 (recipe-first planning, delayed resolution): `docs/superpowers/specs/2026-05-04-recipe-first-planning-design.md`, `docs/superpowers/plans/2026-05-04-recipe-first-planning.md`
- VTEX endpoint research: `docs/superpowers/research/2026-05-04-vtex-samples.md`
