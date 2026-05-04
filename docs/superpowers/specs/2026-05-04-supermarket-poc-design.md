# Supermarket Cart PoC — Design

**Date:** 2026-05-04
**Status:** Approved (brainstorming) — pending implementation plan
**Owner:** Gori

## 1. Goal

Prove end-to-end that we can:

1. Search a real Argentine supermarket's catalog (Jumbo, Carrefour) without authentication.
2. Build an anonymous cart on that supermarket via VTEX's public Checkout API.
3. Hand the user off to the supermarket's hosted checkout with their items already in the cart.

If this works on two independent VTEX tenants, the multi-store abstraction is proven and the LLM-driven recipe-extraction layer can be built on top in a later milestone with low integration risk.

## 2. Non-Goals (deferred to later milestones)

- Recipe input (URL or image), LLM extraction via OpenRouter, ingredient aggregation.
- Día / Disco / Vea support.
- User authentication on our app, multi-user persistence, server-side cart storage.
- Splitting a cart across multiple supermarkets.
- Price comparison across supermarkets.
- Saved searches, favorites, history.

## 3. Scope of the PoC

### In

- Boilerplate already copied into project root.
- First-visit modal forces supermarket choice (Jumbo or Carrefour). Choice persisted in `localStorage`.
- Navbar shows current store and a "Change store" affordance. Switching prompts a confirm dialog and clears the local cart on confirmation.
- Search page: typed free-text query → backend calls VTEX search on the selected store → results grid (image, name, price, "Add" button).
- "Add" appends `{skuId, qty: 1, name, image, price}` to a localStorage cart scoped to the current store.
- Cart drawer: list items, change quantity (1–N), remove items.
- "Send to {store}" button: backend creates an anonymous orderForm on the chosen store, sets shipping data for postal code `1425` (Arenales 3569, CABA), adds all items, returns the supermarket's checkout URL. Client redirects via `window.location.href`.
- Manual smoke verification: user logs into the supermarket and confirms items appear in their cart.

### Out

See §2.

## 4. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Browser (Next.js client components, MUI)                  │
│  - Store-select modal / navbar                             │
│  - Search box + results grid                               │
│  - Cart drawer (reads/writes localStorage)                 │
│  - "Checkout" button → calls /api/checkout                 │
└──────────────┬─────────────────────────────────────────────┘
               │ fetch (same-origin)
               ▼
┌────────────────────────────────────────────────────────────┐
│  Next.js Route Handlers (server)                           │
│  GET  /api/search?store=&q=                                │
│  POST /api/checkout  body: { store, items:[{skuId, qty}] } │
│       → { redirectUrl }                                    │
└──────────────┬─────────────────────────────────────────────┘
               │ server-side fetch (no CORS, no Cloudflare on us)
               ▼
┌────────────────────────────────────────────────────────────┐
│  VTEX public APIs on jumbo.com.ar / carrefour.com.ar       │
│  GET /api/io/_v/api/intelligent-search/product_search      │
│  (cart hand-off does NOT call VTEX server-side; it builds  │
│   a redirect URL the user's browser hits directly — see §5)│
└────────────────────────────────────────────────────────────┘
```

### Why a backend at all

VTEX's public endpoints set `Access-Control-Allow-Origin` for their own origins only; cross-origin browser fetches from our app are blocked by CORS preflight. A server-side proxy is required regardless. We adopt a "thick backend" — Route Handlers expose clean app-level endpoints (`/api/search`, `/api/checkout`) rather than dumb pass-throughs — so the VTEX integration is reusable as a headless API later.

### Module layout

```
src/
  app/
    layout.tsx, page.tsx            # existing boilerplate
    api/
      search/route.ts               # GET search proxy
      checkout/route.ts             # POST cart→orderForm→redirectUrl
  lib/
    vtex/
      client.ts                     # fetch wrapper for search calls (headers, error mapping)
      search.ts                     # productSearch(store, query)
      cart.ts                       # buildAddToCartUrl(store, items) — pure string builder
      stores.ts                     # STORES table (jumbo, carrefour)
      types.ts                      # VTEX response types + app domain types
  hooks/
    useStore.ts                     # current store + switch w/ confirm
    useCart.ts                      # localStorage cart CRUD
  containers/
    StoreSelectModal.tsx
    SearchPage.tsx
    CartDrawer.tsx
```

The `lib/vtex/*` modules are plain async functions that take a `Store` config object. They have no dependency on Next.js, React, or `localStorage` — they are pure data/network code so they can be reused from Jest tests, future LLM agents, or a CLI.

### Store config

```ts
type Store = {
  id: 'jumbo' | 'carrefour';
  name: string;
  vtexAccount: string;          // 'jumboargentina' | 'carrefourar'
  baseUrl: string;              // 'https://www.jumbo.com.ar' | 'https://www.carrefour.com.ar'
  defaultSalesChannel: string;  // '1' for both initially
  defaultSeller: string;        // '1' for both initially
};
```

Stores are statically defined in `lib/vtex/stores.ts`. No secrets, no environment variables required for v1. (`.env` will hold `OPENROUTER_API_KEY` in a later milestone, but the PoC needs nothing.)

## 5. Data flow — happy path

1. User lands on `/`. `useStore` hook reads `localStorage`. No store selected → `<StoreSelectModal>` opens.
2. User picks "Jumbo". Hook writes `{ store: 'jumbo' }` to `localStorage`. Modal closes.
3. User types "leche" in search box. Client calls `GET /api/search?store=jumbo&q=leche`.
4. Route Handler imports `lib/vtex/search.ts`, calls Jumbo's intelligent-search endpoint server-side, normalizes results into `Product[]`, returns JSON.
5. UI renders results grid. User clicks "Add" on a product. `useCart` appends `{ skuId, qty: 1, name, image, price }` to the `cart:jumbo` localStorage key.
6. User opens cart drawer, reviews items, clicks "Send to Jumbo".
7. Client calls `POST /api/checkout` with `{ store: 'jumbo', items: [...] }`.
8. Route Handler calls `buildAddToCartUrl('jumbo', items)` and returns `{ redirectUrl }`. The URL is a stateless VTEX add-to-cart deep link of the form:

   ```
   https://www.jumbo.com.ar/checkout/cart/add?sku=<id1>&qty=<n1>&seller=1
       &sku=<id2>&qty=<n2>&seller=1
       &sc=1&redirect=true
   ```

   No VTEX API calls are made server-side for the hand-off — the URL is just string-built. This avoids cross-origin cookie issues (the user's browser hits the supermarket directly, the supermarket creates the cart in *their* session and sets its own cookies).

9. Client redirects: `window.location.href = redirectUrl`. The user's browser hits Jumbo's `/checkout/cart/add` handler, which iterates the repeated `sku/qty/seller` triples, adds each item to a fresh or existing cart in that browser's Jumbo session, and redirects to the cart/checkout page.
10. User signs in to their existing Jumbo account on Jumbo's site, picks slot, pays. Outside our system.

### Why approach B (URL trick) over approach A (server-side orderForm)

Research (see `docs/superpowers/research/` notes from 2026-05-04 brainstorming) compared two patterns:

- **A.** Server-side `POST /api/checkout/pub/orderForm` + `addItems` + redirect with `?orderFormId=...`. Requires the supermarket's checkout to adopt our orderForm via URL parameter, which can fail with third-party cookie blockers, private browsing, or cross-eTLD+1 quirks.
- **B.** Stateless URL with repeated `sku/qty/seller` params. The supermarket creates the cart in the user's own browser session — no cookie/session transfer needed. Recommended by research as "most reliable in 2026".

Approach B is dramatically simpler (zero server-side VTEX checkout calls) and more reliable. We adopt it for the PoC. If the v2 LLM milestone needs server-side cart validation (stock check, price resolution before redirect), we can add approach A back as a pre-flight step on top of B.

## 6. Switching stores

- Navbar component reads `useStore()`.
- Click "Change store" → MUI confirm dialog: "Switching will clear your current cart. Continue?"
- On confirm: clear `cart:<oldStore>` localStorage key, write new store id, reload UI.
- The current orderFormId (if one was created mid-session) is discarded — orderForms are per-tenant and not transferable.

## 7. Error handling

- VTEX 4xx/5xx on search → surface a non-blocking toast ("Search failed, try again"). Local cart unaffected.
- `/api/checkout` is a pure URL builder so it has no network failure modes. It returns 400 if items are empty or store id is invalid.
- Empty search results → friendly empty state ("No results for '{query}' on {store}").
- localStorage unavailable (private mode quirks) → fall back to in-memory cart with a banner warning that the cart won't persist across reloads.
- Cloudflare 403 on Carrefour search from server egress (likely surface) → return a structured `{ error: 'CF_BLOCKED' }` so we know to add header tweaks. Carrefour search may need explicit `User-Agent` and `Accept-Language: es-AR` headers.
- Items unavailable / out of stock at the supermarket after redirect → outside our control in the PoC; the supermarket's UI will surface this. A future milestone can add a server-side stock pre-check via the orderForm API.

## 8. Testing

| Layer | Tool | Scope |
|---|---|---|
| Unit | Jest | `lib/vtex/cart.ts`: redirect URL is built correctly for 0, 1, N items; per-store base URL; param escaping. Pure function, no mocks needed. |
| Unit | Jest | `lib/vtex/search.ts`: response normalization. `fetch` mocked. |
| Live integration | Jest (`*.live.test.ts`, opt-in via `pnpm test:live`) | Real network calls to Jumbo + Carrefour search endpoints. Asserts: search returns ≥1 product with valid SKU and price for "leche". Skipped in CI by default. |
| E2E | Playwright | Store-select modal → search → add → cart → click "Send to {store}" → assert outgoing request payload and redirect URL host. Does not navigate to the supermarket. |
| Manual smoke | Browser | Click through the redirect, log in to Jumbo / Carrefour, confirm items appear. |

The live integration test is the one most likely to catch surprises (CORS, Cloudflare, regional gating). It must pass on both stores before we declare the PoC successful.

## 9. Tech choices

- **Next.js 15 App Router** (from boilerplate).
- **MUI v6** (from boilerplate) — already wired, gives us Modal, Drawer, AppBar, TextField, Snackbar with no design effort. Aligns with "responsive, clean, not overcomplicated."
- **pnpm** (from boilerplate).
- **Jest + Playwright** (from boilerplate).
- **No state library** — `useStore` and `useCart` hooks wrap localStorage directly. Keep it dumb.
- **Hardcoded shipping**: postal code `1425` (Arenales 3569). Future milestone can ask the user.

## 10. Acceptance criteria

The PoC is "done" when, with the dev server running:

1. First visit shows the store-select modal; selection persists across reload.
2. After picking Jumbo, searching "leche" returns real products with images and prices.
3. Adding two products to the cart shows them in the drawer with correct totals.
4. Clicking "Send to Jumbo" redirects to a `jumbo.com.ar/checkout/cart/add?sku=...` URL with both items' SKUs in the query string.
5. The supermarket processes the URL and the user lands on Jumbo's cart/checkout page with both items present. Logging into Jumbo associates the cart with their account.
6. Steps 2–5 also work on Carrefour after switching stores.
7. Live integration test (`pnpm test:live`) passes for both stores.
8. Unit tests pass.
9. Playwright E2E passes (with VTEX endpoints mocked).

## 11. Risks and open questions

- **Carrefour Cloudflare on search**: research suggests Vercel egress IPs may occasionally get 403'd on `/api/io/...` calls. Mitigation: explicit `User-Agent`, `Accept-Language: es-AR`, and `Referer` headers in `client.ts`. The cart hand-off itself runs in the user's browser, so it bypasses our egress entirely — Cloudflare only affects search.
- **Region propagation on search**: Cencosud stores can return `price: 0` if `vtex_segment` cookie isn't seeded. Mitigation: server-side, before search, hit `GET /api/checkout/pub/regions?country=ARG&postalCode=1425` to obtain the region id, then call intelligent-search with `regionId` as a query param (avoids cookie juggling).
- **Multi-item URL trick**: VTEX's `/checkout/cart/add` accepts repeated `sku/qty/seller` triples per common storefront convention. This is widely used but not crisply documented; the live integration test must verify both stores actually add all items from a multi-SKU URL.
- **SKU stability**: VTEX SKU IDs can be re-issued. For the PoC this is irrelevant (we always search fresh), but worth noting for later milestones that cache SKUs.

## 12. Out-of-scope-but-worth-noting

After this PoC ships, the natural next milestones are:

1. Add LLM-based recipe ingredient extraction (URL → JSON-LD or LLM fallback; image → vision LLM via OpenRouter).
2. Add LLM-driven SKU selection (fetch top 5–8 search candidates, ask LLM to pick best match per ingredient).
3. Add Día / Disco / Vea (same VTEX pattern, just config additions).

These are explicitly NOT in this PoC.
