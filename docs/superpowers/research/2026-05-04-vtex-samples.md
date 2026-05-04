# VTEX Endpoint Reality Check — 2026-05-04

Verified during Plan Task 2 that Jumbo and Carrefour expose the assumed VTEX shapes and that the stateless add-to-cart URL pattern works.

## Search response shape (legacy `/api/catalog_system/pub/products/search`)

Both stores return a JSON array of products with the same shape:

```jsonc
[
  {
    "productId": "241361",
    "productName": "Oblea Leche 4 Fingers 41.5 Grs Kitkat®",
    "brand": "KIT E KAT",
    "items": [
      {
        "itemId": "238230",                      // ← SKU we feed to add-to-cart
        "images": [{ "imageUrl": "https://...vteximg.com.br/..." }],
        "sellers": [
          {
            "sellerId": "1",
            "commertialOffer": {
              "Price": 2600.0,
              "IsAvailable": true
            }
          }
        ]
      }
    ]
  },
  ...
]
```

Confirmed on:
- `https://www.jumbo.com.ar/api/catalog_system/pub/products/search/?ft=leche&_from=0&_to=2` → 3 products, first SKU `238230`, $2600.
- `https://www.carrefour.com.ar/api/catalog_system/pub/products/search/?ft=leche&_from=0&_to=2` → 3 products, first SKU `52726`, $12603.5.

Carrefour responded fine to a UA + `Accept-Language: es-AR` + `Referer: https://www.carrefour.com.ar/` from this machine's egress; no Cloudflare 403 observed in this run. If it bites later, drop the Referer and/or vary the UA.

## Search relevance note

The legacy endpoint has weak relevance — querying "leche" returns chocolate wafers and coffee capsules before actual milk. This is acceptable for the PoC (we just need to prove the path). Switching to Intelligent Search (`/api/io/_v/api/intelligent-search/product_search`) is a clean v2 swap.

## Add-to-cart URL trick (the hand-off pattern)

Both stores accept the stateless URL pattern. Following with curl `-L`:

- `https://www.jumbo.com.ar/checkout/cart/add?sku=238230&qty=1&seller=1&sc=1&redirect=true`
  → 302 → `https://www.jumbo.com.ar/checkout/#/cart` (status 200).
- `https://www.carrefour.com.ar/checkout/cart/add?sku=52726&qty=1&seller=1&sc=1&redirect=true`
  → 302 → `https://www.carrefour.com.ar/checkout/#/cart` (status 200).

The cart materializes in the browser session that follows the URL. Manual browser smoke (logging in and confirming the cart contents on the supermarket's UI) is part of the post-implementation manual checklist; not blocked.

## Multi-item URL form (assumed, not directly verified)

Per VTEX convention, multiple items are appended as repeated `sku/qty/seller` triples in order:

```
?sku=A&qty=1&seller=1&sku=B&qty=2&seller=1&sc=1&redirect=true
```

`buildAddToCartUrl` in `src/lib/vtex/cart.ts` produces this format. The Playwright E2E and the live integration test both build single-item URLs; the manual smoke checklist verifies the multi-item case end-to-end.
