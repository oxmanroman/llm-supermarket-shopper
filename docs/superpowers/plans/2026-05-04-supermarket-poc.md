# Supermarket Cart PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove end-to-end that we can search Jumbo and Carrefour catalogs, build a local cart, and hand the user off to the supermarket's checkout with all items already in their cart.

**Architecture:** Next.js 15 App Router. UI is thin (MUI components, hooks reading/writing localStorage). All VTEX integration lives in `src/lib/vtex/*` as plain async functions, called by `/api/search` and `/api/checkout` Route Handlers. Cart hand-off uses VTEX's stateless `/checkout/cart/add?sku=...` URL pattern — no server-side cart creation, no cookie juggling.

**Tech Stack:** Next.js 15, React 19, MUI v6, TypeScript, Jest (unit), Playwright (E2E), pnpm.

**Spec:** `docs/superpowers/specs/2026-05-04-supermarket-poc-design.md`

---

## File Map

**New files:**
- `src/lib/vtex/types.ts` — domain types (`Store`, `Product`, `CartItem`)
- `src/lib/vtex/stores.ts` — STORES table for Jumbo + Carrefour
- `src/lib/vtex/cart.ts` — `buildAddToCartUrl(store, items)` pure function
- `src/lib/vtex/client.ts` — server-side `vtexFetch(store, path)` with browser-like headers
- `src/lib/vtex/search.ts` — `productSearch(store, query)` calls VTEX legacy catalog search
- `src/lib/vtex/__tests__/cart.test.ts`
- `src/lib/vtex/__tests__/search.test.ts`
- `src/lib/vtex/__tests__/integration.live.test.ts`
- `src/app/api/search/route.ts` — `GET /api/search?store=&q=`
- `src/app/api/checkout/route.ts` — `POST /api/checkout`
- `src/hooks/useStore.ts` — current store + switch (with cart-clear)
- `src/hooks/useCart.ts` — localStorage cart CRUD
- `src/hooks/__tests__/cart-store.test.ts` — tests for the underlying cart/store storage helpers
- `src/lib/storage/cart.ts` — pure storage helpers `readCart/writeCart/clearCart` (so hooks stay thin)
- `src/lib/storage/store.ts` — pure storage helpers `readStore/writeStore/clearStore`
- `src/containers/StoreSelectModal.tsx`
- `src/containers/Navbar.tsx` — replaces `Header.tsx`
- `src/containers/SearchPage.tsx`
- `src/containers/CartDrawer.tsx`
- `tests/poc.spec.ts` — Playwright happy-path

**Modified files:**
- `src/app/page.tsx` — render `SearchPage` instead of `Landing`
- `src/app/layout.tsx` — update title to "Supermarket"
- `src/app/layout-content.tsx` — render new `Navbar`, mount `StoreSelectModal` and `CartDrawer`
- `src/containers/index.ts` — export new containers
- `src/hooks/index.ts` — export `useStore`, `useCart`
- `package.json` — add `test:live` script
- `jest.config.ts` — exclude `*.live.test.ts` by default

**Removed files:**
- `src/containers/Header.tsx` — replaced by `Navbar.tsx`
- `src/containers/Landing.tsx` — replaced by `SearchPage.tsx`

---

## Task 1: Verify boilerplate works

**Files:**
- No code changes; this task verifies the dev environment.

- [ ] **Step 1: Install dependencies**

Run from `/home/ubuntu/projects/others/supermarket`:

```bash
pnpm install
```

Expected: pnpm installs all packages from `pnpm-lock.yaml`. May take 1–2 minutes.

- [ ] **Step 2: Verify dev server boots**

```bash
pnpm dev
```

Expected: server starts on `http://localhost:3000`, no errors. Stop it with Ctrl-C after confirmation.

- [ ] **Step 3: Verify Jest runs**

```bash
pnpm test:unit
```

Expected: `passWithNoTests: true` is configured, so it passes with "No tests found".

- [ ] **Step 4: Verify Playwright is installable**

```bash
pnpm playwright:install
```

Expected: Playwright downloads browser binaries.

- [ ] **Step 5: Commit**

Nothing to commit — this is a verification task.

---

## Task 2: Reality-check VTEX search endpoints

**Files:**
- Create: `docs/superpowers/research/2026-05-04-vtex-samples.md`

This task confirms the VTEX endpoint shapes on Jumbo and Carrefour before we commit to types. Saves real response samples for reference.

- [ ] **Step 1: Curl Jumbo search**

```bash
curl -s -H 'User-Agent: Mozilla/5.0' -H 'Accept-Language: es-AR' \
  'https://www.jumbo.com.ar/api/catalog_system/pub/products/search/?ft=leche&_from=0&_to=2' \
  | head -c 4000
```

Expected: JSON array. Each element has `productId`, `productName`, `linkText`, `items[]`. Each `item` has `itemId` (the SKU we need), `images[]` with `imageUrl`, `sellers[]` with `commertialOffer.Price` (a number) and `commertialOffer.IsAvailable` (boolean).

- [ ] **Step 2: Curl Carrefour search**

```bash
curl -s -H 'User-Agent: Mozilla/5.0' -H 'Accept-Language: es-AR' \
  'https://www.carrefour.com.ar/api/catalog_system/pub/products/search/?ft=leche&_from=0&_to=2' \
  | head -c 4000
```

Expected: same JSON shape as Jumbo. If Carrefour returns 403 (Cloudflare), retry with a more complete header set:

```bash
curl -s \
  -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' \
  -H 'Accept: application/json, text/plain, */*' \
  -H 'Accept-Language: es-AR,es;q=0.9' \
  -H 'Referer: https://www.carrefour.com.ar/' \
  'https://www.carrefour.com.ar/api/catalog_system/pub/products/search/?ft=leche&_from=0&_to=2' \
  | head -c 4000
```

- [ ] **Step 3: Save samples**

Create `docs/superpowers/research/2026-05-04-vtex-samples.md` with both raw responses (truncated to ~50 lines each) and a one-paragraph summary of any differences observed between the two stores.

- [ ] **Step 4: Test add-to-cart URL pattern manually**

Take any `itemId` from the Jumbo response. Open in a browser:

```
https://www.jumbo.com.ar/checkout/cart/add?sku=<itemId>&qty=1&seller=1&sc=1&redirect=true
```

Expected: browser navigates to Jumbo's cart page with the item present. If logged in, item shows under your account. If not logged in, item shows in a guest cart. Note this in the samples doc.

Repeat for Carrefour with a Carrefour itemId.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/research/2026-05-04-vtex-samples.md
git commit -m "docs(research): add VTEX endpoint reality-check samples for Jumbo and Carrefour"
```

If either curl or the manual cart-add test fails, STOP and report. The plan assumes both work.

---

## Task 3: Domain types, stores, URL builder

**Files:**
- Create: `src/lib/vtex/types.ts`
- Create: `src/lib/vtex/stores.ts`
- Create: `src/lib/vtex/cart.ts`
- Test: `src/lib/vtex/__tests__/cart.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/vtex/__tests__/cart.test.ts`:

```ts
import { buildAddToCartUrl } from '../cart';
import { STORES } from '../stores';

describe('buildAddToCartUrl', () => {
  it('builds a single-item URL for Jumbo', () => {
    const url = buildAddToCartUrl(STORES.jumbo, [{ skuId: '12345', qty: 1 }]);
    expect(url).toBe(
      'https://www.jumbo.com.ar/checkout/cart/add?sku=12345&qty=1&seller=1&sc=1&redirect=true',
    );
  });

  it('builds a multi-item URL for Carrefour with repeated triples', () => {
    const url = buildAddToCartUrl(STORES.carrefour, [
      { skuId: 'A', qty: 1 },
      { skuId: 'B', qty: 2 },
    ]);
    expect(url).toBe(
      'https://www.carrefour.com.ar/checkout/cart/add?sku=A&qty=1&seller=1&sku=B&qty=2&seller=1&sc=1&redirect=true',
    );
  });

  it('throws on empty items', () => {
    expect(() => buildAddToCartUrl(STORES.jumbo, [])).toThrow('items is empty');
  });

  it('escapes special characters in skuId', () => {
    const url = buildAddToCartUrl(STORES.jumbo, [{ skuId: 'a b&c', qty: 1 }]);
    expect(url).toContain('sku=a%20b%26c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/lib/vtex/__tests__/cart.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement types**

Create `src/lib/vtex/types.ts`:

```ts
export type StoreId = 'jumbo' | 'carrefour';

export type Store = {
  id: StoreId;
  name: string;
  baseUrl: string;
  defaultSalesChannel: string;
  defaultSeller: string;
};

export type Product = {
  skuId: string;
  productId: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  price: number;
  available: boolean;
};

export type CartItem = {
  skuId: string;
  qty: number;
  name: string;
  imageUrl?: string;
  price: number;
};
```

- [ ] **Step 4: Implement stores**

Create `src/lib/vtex/stores.ts`:

```ts
import type { Store, StoreId } from './types';

export const STORES: Record<StoreId, Store> = {
  jumbo: {
    id: 'jumbo',
    name: 'Jumbo',
    baseUrl: 'https://www.jumbo.com.ar',
    defaultSalesChannel: '1',
    defaultSeller: '1',
  },
  carrefour: {
    id: 'carrefour',
    name: 'Carrefour',
    baseUrl: 'https://www.carrefour.com.ar',
    defaultSalesChannel: '1',
    defaultSeller: '1',
  },
};

export const STORE_IDS = Object.keys(STORES) as StoreId[];

export function isStoreId(value: unknown): value is StoreId {
  return typeof value === 'string' && value in STORES;
}
```

- [ ] **Step 5: Implement URL builder**

Create `src/lib/vtex/cart.ts`:

```ts
import type { Store } from './types';

export type AddToCartItem = { skuId: string; qty: number };

export function buildAddToCartUrl(store: Store, items: AddToCartItem[]): string {
  if (items.length === 0) {
    throw new Error('items is empty');
  }
  const params = new URLSearchParams();
  for (const item of items) {
    params.append('sku', item.skuId);
    params.append('qty', String(item.qty));
    params.append('seller', store.defaultSeller);
  }
  params.append('sc', store.defaultSalesChannel);
  params.append('redirect', 'true');
  return `${store.baseUrl}/checkout/cart/add?${params.toString()}`;
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm test:unit src/lib/vtex/__tests__/cart.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/vtex/
git commit -m "feat(vtex): add types, stores table, and add-to-cart URL builder"
```

---

## Task 4: VTEX search

**Files:**
- Create: `src/lib/vtex/client.ts`
- Create: `src/lib/vtex/search.ts`
- Test: `src/lib/vtex/__tests__/search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/vtex/__tests__/search.test.ts`:

```ts
import { productSearch } from '../search';
import { STORES } from '../stores';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const sampleVtexResponse = [
  {
    productId: '111',
    productName: 'La Serenísima Leche Entera 1L',
    brand: 'La Serenísima',
    items: [
      {
        itemId: '1001',
        name: 'La Serenísima Leche Entera 1L',
        images: [{ imageUrl: 'https://cdn/img.jpg', imageText: 'leche' }],
        sellers: [
          {
            sellerId: '1',
            commertialOffer: { Price: 850, ListPrice: 850, IsAvailable: true },
          },
        ],
      },
    ],
  },
];

describe('productSearch', () => {
  beforeEach(() => mockFetch.mockReset());

  it('normalizes a Jumbo response into Product[]', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleVtexResponse), { status: 200 }),
    );

    const products = await productSearch(STORES.jumbo, 'leche');

    expect(products).toEqual([
      {
        skuId: '1001',
        productId: '111',
        name: 'La Serenísima Leche Entera 1L',
        brand: 'La Serenísima',
        imageUrl: 'https://cdn/img.jpg',
        price: 850,
        available: true,
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.jumbo.com.ar/api/catalog_system/pub/products/search/?ft=leche&_from=0&_to=11',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Language': 'es-AR,es;q=0.9',
          'User-Agent': expect.any(String),
        }),
      }),
    );
  });

  it('returns [] when VTEX returns empty array', async () => {
    mockFetch.mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const products = await productSearch(STORES.jumbo, 'xyzzz');
    expect(products).toEqual([]);
  });

  it('throws when VTEX returns non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('blocked', { status: 403 }));
    await expect(productSearch(STORES.carrefour, 'leche')).rejects.toThrow(/403/);
  });

  it('skips products with no usable item/seller', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { productId: '1', productName: 'broken', items: [] },
          ...sampleVtexResponse,
        ]),
        { status: 200 },
      ),
    );
    const products = await productSearch(STORES.jumbo, 'leche');
    expect(products).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/lib/vtex/__tests__/search.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement client**

Create `src/lib/vtex/client.ts`:

```ts
import type { Store } from './types';

const HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9',
};

export async function vtexFetch(store: Store, path: string): Promise<Response> {
  const url = `${store.baseUrl}${path}`;
  const response = await fetch(url, {
    headers: { ...HEADERS, Referer: `${store.baseUrl}/` },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`VTEX ${store.id} ${response.status} on ${path}`);
  }
  return response;
}
```

- [ ] **Step 4: Implement search**

Create `src/lib/vtex/search.ts`:

```ts
import { vtexFetch } from './client';
import type { Product, Store } from './types';

type VtexItem = {
  itemId: string;
  name: string;
  images?: { imageUrl?: string }[];
  sellers?: {
    sellerId: string;
    commertialOffer: { Price: number; IsAvailable: boolean };
  }[];
};

type VtexProduct = {
  productId: string;
  productName: string;
  brand?: string;
  items?: VtexItem[];
};

const PAGE_SIZE = 12;

export async function productSearch(store: Store, query: string): Promise<Product[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const path = `/api/catalog_system/pub/products/search/?ft=${encodeURIComponent(trimmed)}&_from=0&_to=${PAGE_SIZE - 1}`;
  const response = await vtexFetch(store, path);
  const data = (await response.json()) as VtexProduct[];
  const products: Product[] = [];
  for (const p of data) {
    const item = p.items?.[0];
    const seller = item?.sellers?.[0];
    if (!item || !seller) continue;
    products.push({
      skuId: item.itemId,
      productId: p.productId,
      name: p.productName,
      brand: p.brand,
      imageUrl: item.images?.[0]?.imageUrl,
      price: seller.commertialOffer.Price,
      available: seller.commertialOffer.IsAvailable,
    });
  }
  return products;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test:unit src/lib/vtex/__tests__/search.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/vtex/
git commit -m "feat(vtex): add server-side search client and product normalization"
```

---

## Task 5: API route handlers

**Files:**
- Create: `src/app/api/search/route.ts`
- Create: `src/app/api/checkout/route.ts`

The Next.js App Router runs Route Handlers in Node.js by default. We'll keep them tiny — they just adapt HTTP requests to the `lib/vtex/*` functions.

- [ ] **Step 1: Implement search route**

Create `src/app/api/search/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { productSearch } from '~/lib/vtex/search';
import { STORES, isStoreId } from '~/lib/vtex/stores';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const storeParam = searchParams.get('store');
  const q = searchParams.get('q')?.trim() ?? '';

  if (!isStoreId(storeParam)) {
    return NextResponse.json({ error: 'invalid store' }, { status: 400 });
  }
  if (!q) {
    return NextResponse.json({ products: [] });
  }

  try {
    const products = await productSearch(STORES[storeParam], q);
    return NextResponse.json({ products });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[api/search]', message);
    const upstreamBlocked = /403/.test(message);
    return NextResponse.json(
      { error: upstreamBlocked ? 'CF_BLOCKED' : 'UPSTREAM_ERROR', detail: message },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Implement checkout route**

Create `src/app/api/checkout/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { buildAddToCartUrl } from '~/lib/vtex/cart';
import { STORES, isStoreId } from '~/lib/vtex/stores';

type CheckoutBody = {
  store?: string;
  items?: { skuId?: string; qty?: number }[];
};

export async function POST(request: Request) {
  let body: CheckoutBody;
  try {
    body = (await request.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!isStoreId(body.store)) {
    return NextResponse.json({ error: 'invalid store' }, { status: 400 });
  }
  const items = (body.items ?? [])
    .filter((i) => typeof i.skuId === 'string' && Number.isInteger(i.qty) && (i.qty as number) > 0)
    .map((i) => ({ skuId: i.skuId as string, qty: i.qty as number }));

  if (items.length === 0) {
    return NextResponse.json({ error: 'no items' }, { status: 400 });
  }

  const redirectUrl = buildAddToCartUrl(STORES[body.store], items);
  return NextResponse.json({ redirectUrl });
}
```

- [ ] **Step 3: Manual smoke — start dev server**

```bash
pnpm dev
```

In another terminal:

- [ ] **Step 4: Hit /api/search**

```bash
curl -s 'http://localhost:3000/api/search?store=jumbo&q=leche' | head -c 1000
```

Expected: `{"products":[{"skuId":"...", ...}, ...]}` with several products.

- [ ] **Step 5: Hit /api/checkout**

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"store":"jumbo","items":[{"skuId":"1001","qty":1}]}' \
  http://localhost:3000/api/checkout
```

Expected: `{"redirectUrl":"https://www.jumbo.com.ar/checkout/cart/add?sku=1001&qty=1&seller=1&sc=1&redirect=true"}`

- [ ] **Step 6: Verify validation**

```bash
curl -s 'http://localhost:3000/api/search?store=foo&q=leche'
# expect: {"error":"invalid store"} status 400

curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"store":"jumbo","items":[]}' \
  http://localhost:3000/api/checkout
# expect: {"error":"no items"} status 400
```

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/
git commit -m "feat(api): add /api/search and /api/checkout route handlers"
```

---

## Task 6: Live integration tests (opt-in)

**Files:**
- Create: `src/lib/vtex/__tests__/integration.live.test.ts`
- Modify: `package.json`

These tests hit the real Jumbo and Carrefour APIs. Skipped by default; run with `pnpm test:live`.

- [ ] **Step 1: Add test:live script to package.json**

In the `scripts` section of `package.json`, add (after the existing `test:unit` line):

```json
"test:live": "LIVE_TESTS=1 jest --testPathPattern=live.test"
```

- [ ] **Step 2: Write the live test**

Create `src/lib/vtex/__tests__/integration.live.test.ts`:

```ts
import { productSearch } from '../search';
import { STORES, STORE_IDS } from '../stores';
import { buildAddToCartUrl } from '../cart';

jest.setTimeout(20_000);

const liveDescribe = process.env.LIVE_TESTS === '1' ? describe : describe.skip;

liveDescribe.each(STORE_IDS)('live VTEX integration: %s', (storeId) => {
  const store = STORES[storeId];

  it('returns products for "leche"', async () => {
    const products = await productSearch(store, 'leche');
    expect(products.length).toBeGreaterThan(0);
    const first = products[0];
    expect(first.skuId).toMatch(/^\d+$/);
    expect(first.name).toBeTruthy();
    expect(first.price).toBeGreaterThan(0);
  });

  it('builds a syntactically valid add-to-cart URL', async () => {
    const products = await productSearch(store, 'leche');
    const url = buildAddToCartUrl(store, [{ skuId: products[0].skuId, qty: 1 }]);
    const parsed = new URL(url);
    expect(parsed.host).toBe(new URL(store.baseUrl).host);
    expect(parsed.pathname).toBe('/checkout/cart/add');
    expect(parsed.searchParams.getAll('sku')).toEqual([products[0].skuId]);
  });
});
```

- [ ] **Step 3: Run live test**

```bash
pnpm test:live
```

Expected: 4 tests pass (2 stores × 2 cases). If Carrefour returns 403 from this machine's egress IP, log it and continue with the plan — adjust headers in `src/lib/vtex/client.ts` (remove `Referer`, swap User-Agent) until it passes. Document any deviation in `docs/superpowers/research/2026-05-04-vtex-samples.md`.

- [ ] **Step 4: Verify default unit run skips live tests**

```bash
pnpm test:unit
```

Expected: passes. The live test file is discovered but its `describe.skip` shorts it out — Jest will report the live cases as "skipped" without making any network calls.

- [ ] **Step 5: Commit**

```bash
git add package.json src/lib/vtex/__tests__/integration.live.test.ts
git commit -m "test(vtex): add opt-in live integration tests against Jumbo and Carrefour"
```

---

## Task 7: Storage helpers and hooks

**Files:**
- Create: `src/lib/storage/cart.ts`
- Create: `src/lib/storage/store.ts`
- Create: `src/lib/storage/__tests__/storage.test.ts`
- Create: `src/hooks/useStore.ts`
- Create: `src/hooks/useCart.ts`
- Modify: `src/hooks/index.ts`

Pure storage helpers are unit-testable; hooks just wrap them with React state.

- [ ] **Step 1: Write the failing test**

Create `src/lib/storage/__tests__/storage.test.ts`:

```ts
/** @jest-environment jsdom */
import { readCart, writeCart, clearCart } from '../cart';
import { readStore, writeStore, clearStore } from '../store';

beforeEach(() => localStorage.clear());

describe('cart storage', () => {
  it('returns [] when nothing stored', () => {
    expect(readCart('jumbo')).toEqual([]);
  });

  it('round-trips items per store', () => {
    writeCart('jumbo', [{ skuId: '1', qty: 2, name: 'milk', price: 100 }]);
    writeCart('carrefour', [{ skuId: '9', qty: 1, name: 'rice', price: 200 }]);
    expect(readCart('jumbo')).toEqual([{ skuId: '1', qty: 2, name: 'milk', price: 100 }]);
    expect(readCart('carrefour')).toEqual([{ skuId: '9', qty: 1, name: 'rice', price: 200 }]);
  });

  it('clearCart wipes only the given store', () => {
    writeCart('jumbo', [{ skuId: '1', qty: 1, name: 'a', price: 1 }]);
    writeCart('carrefour', [{ skuId: '2', qty: 1, name: 'b', price: 2 }]);
    clearCart('jumbo');
    expect(readCart('jumbo')).toEqual([]);
    expect(readCart('carrefour')).toHaveLength(1);
  });

  it('returns [] on corrupt JSON', () => {
    localStorage.setItem('cart:jumbo', '{not json');
    expect(readCart('jumbo')).toEqual([]);
  });
});

describe('store storage', () => {
  it('returns null when nothing stored', () => {
    expect(readStore()).toBeNull();
  });

  it('round-trips a store id', () => {
    writeStore('carrefour');
    expect(readStore()).toBe('carrefour');
  });

  it('returns null on invalid stored value', () => {
    localStorage.setItem('store', 'spar');
    expect(readStore()).toBeNull();
  });

  it('clearStore wipes the value', () => {
    writeStore('jumbo');
    clearStore();
    expect(readStore()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit src/lib/storage/__tests__/storage.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement cart storage**

Create `src/lib/storage/cart.ts`:

```ts
import type { CartItem } from '~/lib/vtex/types';
import type { StoreId } from '~/lib/vtex/types';

const KEY = (storeId: StoreId) => `cart:${storeId}`;

export function readCart(storeId: StoreId): CartItem[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(KEY(storeId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function writeCart(storeId: StoreId, items: CartItem[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY(storeId), JSON.stringify(items));
}

export function clearCart(storeId: StoreId): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY(storeId));
}
```

- [ ] **Step 4: Implement store storage**

Create `src/lib/storage/store.ts`:

```ts
import { isStoreId } from '~/lib/vtex/stores';
import type { StoreId } from '~/lib/vtex/types';

const KEY = 'store';

export function readStore(): StoreId | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  return isStoreId(raw) ? raw : null;
}

export function writeStore(storeId: StoreId): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, storeId);
}

export function clearStore(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test:unit src/lib/storage/__tests__/storage.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 6: Implement useStore hook**

Create `src/hooks/useStore.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { clearCart } from '~/lib/storage/cart';
import { clearStore, readStore, writeStore } from '~/lib/storage/store';
import { STORES } from '~/lib/vtex/stores';
import type { Store, StoreId } from '~/lib/vtex/types';

export function useStore() {
  const [storeId, setStoreId] = useState<StoreId | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setStoreId(readStore());
    setHydrated(true);
  }, []);

  const selectStore = useCallback((id: StoreId) => {
    writeStore(id);
    setStoreId(id);
  }, []);

  const switchStore = useCallback((newId: StoreId) => {
    const prev = readStore();
    if (prev) clearCart(prev);
    writeStore(newId);
    setStoreId(newId);
  }, []);

  const reset = useCallback(() => {
    const prev = readStore();
    if (prev) clearCart(prev);
    clearStore();
    setStoreId(null);
  }, []);

  const store: Store | null = storeId ? STORES[storeId] : null;
  return { store, storeId, hydrated, selectStore, switchStore, reset };
}
```

- [ ] **Step 7: Implement useCart hook**

Create `src/hooks/useCart.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { readCart, writeCart, clearCart } from '~/lib/storage/cart';
import type { CartItem, StoreId } from '~/lib/vtex/types';

export function useCart(storeId: StoreId | null) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    setItems(storeId ? readCart(storeId) : []);
  }, [storeId]);

  const persist = useCallback(
    (next: CartItem[]) => {
      setItems(next);
      if (storeId) writeCart(storeId, next);
    },
    [storeId],
  );

  const addItem = useCallback(
    (item: CartItem) => {
      const existing = items.find((i) => i.skuId === item.skuId);
      const next = existing
        ? items.map((i) => (i.skuId === item.skuId ? { ...i, qty: i.qty + item.qty } : i))
        : [...items, item];
      persist(next);
    },
    [items, persist],
  );

  const setQty = useCallback(
    (skuId: string, qty: number) => {
      if (qty <= 0) {
        persist(items.filter((i) => i.skuId !== skuId));
      } else {
        persist(items.map((i) => (i.skuId === skuId ? { ...i, qty } : i)));
      }
    },
    [items, persist],
  );

  const remove = useCallback(
    (skuId: string) => persist(items.filter((i) => i.skuId !== skuId)),
    [items, persist],
  );

  const clear = useCallback(() => {
    setItems([]);
    if (storeId) clearCart(storeId);
  }, [storeId]);

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  return { items, total, addItem, setQty, remove, clear };
}
```

- [ ] **Step 8: Update hooks index**

Modify `src/hooks/index.ts` — append:

```ts
export * from './useStore';
export * from './useCart';
```

(Keep the existing `useStateContext` export.)

- [ ] **Step 9: Run all unit tests**

```bash
pnpm test:unit
```

Expected: storage + cart + search tests all pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/storage/ src/hooks/useStore.ts src/hooks/useCart.ts src/hooks/index.ts
git commit -m "feat(state): add localStorage helpers and useStore/useCart hooks"
```

---

## Task 8: StoreSelectModal

**Files:**
- Create: `src/containers/StoreSelectModal.tsx`

- [ ] **Step 1: Implement the modal**

Create `src/containers/StoreSelectModal.tsx`:

```tsx
'use client';

import { Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { STORES, STORE_IDS } from '~/lib/vtex/stores';
import type { StoreId } from '~/lib/vtex/types';

type Props = {
  open: boolean;
  onSelect: (storeId: StoreId) => void;
};

export const StoreSelectModal = ({ open, onSelect }: Props) => {
  return (
    <Dialog open={open} disableEscapeKeyDown fullWidth maxWidth='xs'>
      <DialogTitle>Choose your supermarket</DialogTitle>
      <DialogContent>
        <Typography variant='body2' sx={{ mb: 2 }}>
          Pick where you'd like to shop. You can change it later from the navbar — switching will clear your cart.
        </Typography>
        <Stack spacing={1.5}>
          {STORE_IDS.map((id) => (
            <Button
              key={id}
              variant='contained'
              size='large'
              fullWidth
              onClick={() => onSelect(id)}
              data-testid={`select-store-${id}`}
            >
              {STORES[id].name}
            </Button>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/containers/StoreSelectModal.tsx
git commit -m "feat(ui): add store-select modal"
```

---

## Task 9: Navbar (lives alongside Header until Task 11)

**Files:**
- Create: `src/containers/Navbar.tsx`

Navbar is created here; Header.tsx and Landing.tsx are deleted in Task 11 along with the layout/page rewires, so the build stays green at every commit.

- [ ] **Step 1: Write the navbar**

Create `src/containers/Navbar.tsx`:

```tsx
'use client';

import { useState } from 'react';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
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
import { STORES } from '~/lib/vtex/stores';
import type { Store, StoreId } from '~/lib/vtex/types';

type Props = {
  store: Store | null;
  cartCount: number;
  onOpenCart: () => void;
  onSwitchStore: (id: StoreId) => void;
};

export const Navbar = ({ store, cartCount, onOpenCart, onSwitchStore }: Props) => {
  const { mode, setMode } = useColorScheme();
  const [picking, setPicking] = useState(false);

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
    </>
  );
};
```

- [ ] **Step 2: Verify it type-checks**

```bash
pnpm lint
```

Expected: passes (no unused-import or type errors). The Navbar isn't imported anywhere yet — that's fine; ESLint won't flag a file that simply exports something.

- [ ] **Step 3: Commit**

```bash
git add src/containers/Navbar.tsx
git commit -m "feat(ui): add Navbar component with store badge, cart, and theme toggle"
```

---

## Task 10: SearchPage and CartDrawer

**Files:**
- Create: `src/containers/SearchPage.tsx`
- Create: `src/containers/CartDrawer.tsx`

- [ ] **Step 1: Implement SearchPage**

Create `src/containers/SearchPage.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardMedia,
  CircularProgress,
  Container,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { CartItem, Product, Store } from '~/lib/vtex/types';

type Props = {
  store: Store;
  onAdd: (item: CartItem) => void;
};

export const SearchPage = ({ store, onAdd }: Props) => {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setTouched(true);
    try {
      const res = await fetch(`/api/search?store=${store.id}&q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { products: Product[] };
      setProducts(body.products);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth='lg' sx={{ py: 4 }}>
      <Box component='form' onSubmit={search} sx={{ display: 'flex', gap: 1, mb: 3 }}>
        <TextField
          fullWidth
          placeholder={`Search ${store.name}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputProps={{ 'data-testid': 'search-input' }}
        />
        <Button type='submit' variant='contained' disabled={!query.trim() || loading}>
          Search
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && touched && products.length === 0 && !error && (
        <Typography variant='body2' color='text.secondary'>
          No results for "{query}" on {store.name}.
        </Typography>
      )}

      <Stack
        direction='row'
        flexWrap='wrap'
        gap={2}
        data-testid='results-grid'
      >
        {products.map((p) => (
          <Card key={p.skuId} sx={{ width: { xs: '100%', sm: 220 } }} data-testid={`product-${p.skuId}`}>
            {p.imageUrl && (
              <CardMedia component='img' image={p.imageUrl} alt={p.name} sx={{ height: 140, objectFit: 'contain' }} />
            )}
            <CardContent>
              <Typography variant='body2' sx={{ minHeight: 40 }}>{p.name}</Typography>
              <Typography variant='subtitle1' sx={{ mt: 1 }}>${p.price.toLocaleString('es-AR')}</Typography>
            </CardContent>
            <CardActions>
              <Button
                fullWidth
                disabled={!p.available}
                onClick={() =>
                  onAdd({
                    skuId: p.skuId,
                    qty: 1,
                    name: p.name,
                    imageUrl: p.imageUrl,
                    price: p.price,
                  })
                }
                data-testid={`add-${p.skuId}`}
              >
                {p.available ? 'Add' : 'Unavailable'}
              </Button>
            </CardActions>
          </Card>
        ))}
      </Stack>
    </Container>
  );
};
```

- [ ] **Step 2: Implement CartDrawer**

Create `src/containers/CartDrawer.tsx`:

```tsx
'use client';

import { useState } from 'react';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { CartItem, Store } from '~/lib/vtex/types';

type Props = {
  open: boolean;
  onClose: () => void;
  store: Store;
  items: CartItem[];
  total: number;
  onSetQty: (skuId: string, qty: number) => void;
  onRemove: (skuId: string) => void;
};

export const CartDrawer = ({ open, onClose, store, items, total, onSetQty, onRemove }: Props) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkout = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: store.id,
          items: items.map((i) => ({ skuId: i.skuId, qty: i.qty })),
        }),
      });
      const body = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok || !body.redirectUrl) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.location.href = body.redirectUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
      setSubmitting(false);
    }
  };

  return (
    <Drawer anchor='right' open={open} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: 380 }, p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Typography variant='h6' sx={{ mb: 2 }}>Your cart · {store.name}</Typography>

        {items.length === 0 ? (
          <Typography variant='body2' color='text.secondary'>Cart is empty.</Typography>
        ) : (
          <Stack spacing={2} sx={{ flexGrow: 1, overflowY: 'auto' }} data-testid='cart-items'>
            {items.map((i) => (
              <Box
                key={i.skuId}
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                data-testid={`cart-item-${i.skuId}`}
              >
                {i.imageUrl && <Box component='img' src={i.imageUrl} alt='' sx={{ width: 48, height: 48, objectFit: 'contain' }} />}
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant='body2'>{i.name}</Typography>
                  <Typography variant='caption' color='text.secondary'>${i.price.toLocaleString('es-AR')}</Typography>
                </Box>
                <TextField
                  type='number'
                  size='small'
                  value={i.qty}
                  onChange={(e) => onSetQty(i.skuId, Number.parseInt(e.target.value, 10) || 0)}
                  inputProps={{ min: 0, style: { width: 48 }, 'data-testid': `qty-${i.skuId}` }}
                />
                <IconButton onClick={() => onRemove(i.skuId)} aria-label='Remove'>
                  <DeleteIcon />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}

        {error && <Alert severity='error' sx={{ mt: 2 }}>{error}</Alert>}

        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction='row' justifyContent='space-between' sx={{ mb: 2 }}>
            <Typography variant='subtitle1'>Total</Typography>
            <Typography variant='subtitle1'>${total.toLocaleString('es-AR')}</Typography>
          </Stack>
          <Button
            fullWidth
            variant='contained'
            disabled={items.length === 0 || submitting}
            onClick={checkout}
            data-testid='checkout-button'
          >
            {submitting ? 'Redirecting…' : `Send to ${store.name}`}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add src/containers/SearchPage.tsx src/containers/CartDrawer.tsx
git commit -m "feat(ui): add SearchPage and CartDrawer components"
```

---

## Task 11: Wire main page; remove Header & Landing

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout-content.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/containers/index.ts`
- Delete: `src/containers/Header.tsx`
- Delete: `src/containers/Landing.tsx`

- [ ] **Step 1: Replace `src/app/page.tsx`**

Replace the file with:

```tsx
'use client';

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { CartDrawer, Navbar, SearchPage, StoreSelectModal } from '~/containers';
import { useCart, useStore } from '~/hooks';

export default function Home() {
  const { store, storeId, hydrated, selectStore, switchStore } = useStore();
  const { items, total, addItem, setQty, remove } = useCart(storeId);
  const [cartOpen, setCartOpen] = useState(false);

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
          <SearchPage store={store} onAdd={addItem} />
        ) : (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography variant='body2' color='text.secondary'>Pick a supermarket to start.</Typography>
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
    </Box>
  );
}
```

- [ ] **Step 2: Simplify `src/app/layout-content.tsx`**

The Navbar is now rendered from `page.tsx` (so it can read app state). Replace the file with:

```tsx
'use client';

import { CssBaseline, styled } from '@mui/material';

export function LayoutContent({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CssBaseline />
      <MainContent>{children}</MainContent>
    </>
  );
}

const MainContent = styled('div')`
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100vh;
`;
```

- [ ] **Step 3: Update layout.tsx metadata**

In `src/app/layout.tsx`, change the `metadata` object's `title` and `description`:

```ts
export const metadata: Metadata = {
  title: 'Supermarket',
  description: 'Recipe-to-cart helper for Argentine supermarkets.',
  robots: 'noindex',
  icons: { icon: '/favicon.ico' },
};
```

(Drop the openGraph and twitter blocks; they're noise for a personal app.)

- [ ] **Step 4: Update containers index**

Replace `src/containers/index.ts` with:

```ts
export * from './CartDrawer';
export * from './Footer';
export * from './Navbar';
export * from './SearchPage';
export * from './StoreSelectModal';
```

- [ ] **Step 5: Delete Header and Landing**

```bash
rm src/containers/Header.tsx src/containers/Landing.tsx
```

- [ ] **Step 6: Verify build**

```bash
pnpm build
```

Expected: clean build, no type errors. If a leftover import of `Header` or `Landing` causes a failure, fix it (likely in `layout-content.tsx` if the changes weren't applied correctly).

- [ ] **Step 7: Smoke-test in browser**

```bash
pnpm dev
```

Open http://localhost:3000.

Verify manually:

1. Store-select modal blocks the page.
2. Pick "Jumbo" → modal closes, navbar shows "Jumbo".
3. Search "leche" → results render with images and prices.
4. Click "Add" on two products → cart icon badge shows "2".
5. Click cart icon → drawer opens, items listed, qty editable, total reflects sum.
6. Click "Send to Jumbo" → browser navigates to `jumbo.com.ar/checkout/cart/add?...` URL.
7. Back to localhost. Click navbar "Jumbo" button → confirm dialog → click "Carrefour" → cart cleared, store now Carrefour.
8. Repeat search + cart + checkout for Carrefour.

If everything works: stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): wire main page; remove placeholder Header and Landing"
```

---

## Task 12: Playwright E2E happy path

**Files:**
- Create: `tests/poc.spec.ts`

The boilerplate's `tests/` directory is empty (verified at plan-write time), so no cleanup needed.

- [ ] **Step 1: Write the spec**

Create `tests/poc.spec.ts`:

```ts
import { test, expect, Route } from '@playwright/test';

const sampleProducts = [
  {
    skuId: '1001',
    productId: '111',
    name: 'La Serenísima Leche Entera 1L',
    brand: 'La Serenísima',
    imageUrl: 'https://example.test/img.jpg',
    price: 850,
    available: true,
  },
  {
    skuId: '1002',
    productId: '112',
    name: 'Sancor Leche Descremada 1L',
    brand: 'Sancor',
    imageUrl: 'https://example.test/img2.jpg',
    price: 900,
    available: true,
  },
];

const mockApi = async (route: Route) => {
  const url = route.request().url();
  if (url.includes('/api/search')) {
    await route.fulfill({ status: 200, body: JSON.stringify({ products: sampleProducts }) });
  } else if (url.includes('/api/checkout')) {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      store: string;
      items: { skuId: string; qty: number }[];
    };
    const params = new URLSearchParams();
    for (const i of body.items) {
      params.append('sku', i.skuId);
      params.append('qty', String(i.qty));
      params.append('seller', '1');
    }
    params.append('sc', '1');
    params.append('redirect', 'true');
    const host = body.store === 'jumbo' ? 'www.jumbo.com.ar' : 'www.carrefour.com.ar';
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ redirectUrl: `https://${host}/checkout/cart/add?${params.toString()}` }),
    });
  } else {
    await route.continue();
  }
};

test('happy path: select store, search, add, checkout', async ({ page, context }) => {
  await context.route('**/api/**', mockApi);

  await page.goto('/');
  await page.getByTestId('select-store-jumbo').click();

  await page.getByTestId('search-input').fill('leche');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('product-1001')).toBeVisible();

  await page.getByTestId('add-1001').click();
  await page.getByTestId('add-1002').click();

  await page.getByTestId('open-cart-button').click();
  await expect(page.getByTestId('cart-item-1001')).toBeVisible();
  await expect(page.getByTestId('cart-item-1002')).toBeVisible();

  // Intercept the navigation that follows checkout — assert the URL host.
  const navigationPromise = page.waitForRequest((req) =>
    req.url().startsWith('https://www.jumbo.com.ar/checkout/cart/add'),
  );
  await page.getByTestId('checkout-button').click();
  const req = await navigationPromise;
  const url = new URL(req.url());
  expect(url.searchParams.getAll('sku')).toEqual(['1001', '1002']);
});

test('switching store clears the cart', async ({ page, context }) => {
  await context.route('**/api/**', mockApi);
  await page.goto('/');
  await page.getByTestId('select-store-jumbo').click();
  await page.getByTestId('search-input').fill('leche');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByTestId('add-1001').click();

  await page.getByTestId('switch-store-button').click();
  await page.getByTestId('switch-to-carrefour').click();

  // Cart icon badge should now be 0; opening cart shows empty state.
  await page.getByTestId('open-cart-button').click();
  await expect(page.getByText('Cart is empty.')).toBeVisible();
});
```

Note: the navigation-intercept assertion in the first test needs the page to attempt the actual navigation. Playwright will follow it and likely error because the supermarket domain is external — that's fine, the test only awaits the request being *issued*. If this is flaky, replace `window.location.href = body.redirectUrl` in `CartDrawer.tsx` with a window.location replacement guarded by a `data-redirect-url` attribute on the button so the test can read the URL synchronously. Document this in the test if you change it.

- [ ] **Step 2: Run E2E**

```bash
pnpm playwright:test --project=chromium
```

Expected: both tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/poc.spec.ts
git commit -m "test(e2e): add Playwright happy-path and switch-store specs"
```

---

## Task 13: README and smoke checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md`**

```markdown
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
```

- [ ] **Step 2: Final all-tests run**

```bash
pnpm test:unit && pnpm test:e2e
```

Expected: all green. (Skip `test:live` here unless you want to verify upstream is healthy.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: replace boilerplate README with PoC documentation"
```

- [ ] **Step 4: Tag the PoC**

```bash
git tag -a poc-v1 -m "PoC v1: store selection, search, cart, hand-off URL"
```

---

## Acceptance verification

The PoC is "done" (matches §10 of the spec) when, in order:

1. ✅ First visit shows store-select modal; selection persists across reload.
2. ✅ Searching "leche" on Jumbo returns real products with images and prices.
3. ✅ Adding two products shows them in the drawer with a correct total.
4. ✅ "Send to Jumbo" redirects to a `jumbo.com.ar/checkout/cart/add?sku=...` URL with both SKUs in the query string.
5. ✅ User lands on Jumbo's cart with both items present.
6. ✅ All of the above works on Carrefour after switching stores.
7. ✅ `pnpm test:live` passes for both stores.
8. ✅ `pnpm test:unit` passes.
9. ✅ `pnpm test:e2e` passes.
