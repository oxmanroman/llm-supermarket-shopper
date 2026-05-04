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
