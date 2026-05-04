# Supermarket

Recipe-to-cart helper for Argentine supermarkets. PoC stage: pick a supermarket, search its catalog, build a cart, hand off to the supermarket's checkout with all items in the user's cart.

Currently supports: Jumbo, Carrefour. Both run on VTEX; integration is anonymous (no API keys).

## Stack

Next.js 15 (App Router), React 19, MUI v6, TypeScript, Jest, Playwright, pnpm.

## Setup

```bash
pnpm install
```

No environment variables are required for the PoC. `.env.example` is empty.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Start dev server on http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build & serve |
| `pnpm test:unit` | Jest unit tests |
| `pnpm test:live` | Live integration tests (real network calls to Jumbo + Carrefour). Skipped from `test:unit`. |
| `pnpm test:e2e` | Playwright E2E tests |
| `pnpm test` | unit + e2e |
| `pnpm format` | Prettier + ESLint fixes |

## How the cart hand-off works

The backend never creates a cart on the supermarket. Instead, `/api/checkout` returns a stateless URL like `https://www.jumbo.com.ar/checkout/cart/add?sku=A&qty=1&seller=1&sku=B&qty=2&seller=1&sc=1&redirect=true`. The browser navigates there; the supermarket adds the items to *that browser's* session and redirects to its checkout page. The user logs into their existing supermarket account on the supermarket's site to pay.

This avoids cross-origin cookie issues entirely.

## Manual smoke checklist

After any non-trivial change to the search or cart flow:

1. `pnpm dev`, open http://localhost:3000.
2. Pick Jumbo → search "leche" → at least one result with image and price.
3. Add two products → cart badge shows 2 → drawer shows both with qty editor.
4. Click "Send to Jumbo" → browser navigates to `www.jumbo.com.ar` with both items in cart.
5. Repeat 2–4 for Carrefour after switching stores from the navbar.
6. Switch from Carrefour back to Jumbo → confirm dialog appears → cart cleared.

## Spec & plan

- Spec: `docs/superpowers/specs/2026-05-04-supermarket-poc-design.md`
- Plan: `docs/superpowers/plans/2026-05-04-supermarket-poc.md`
- VTEX endpoint samples: `docs/superpowers/research/2026-05-04-vtex-samples.md`
