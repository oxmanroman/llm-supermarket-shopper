import { expect, Route, test } from '@playwright/test';

const sampleExtractURL = {
  label: 'Empanadas de pollo',
  ingredients: [
    { name: 'pollo', qty: 200, unit: 'g' },
    { name: 'cebolla', qty: 1, unit: null },
  ],
  isLoose: false,
};
const sampleExtractText = {
  label: 'Tarta de espinaca',
  ingredients: [
    { name: 'espinaca', qty: 1, unit: 'paquete' },
    { name: 'cebolla', qty: 1, unit: null },
  ],
  isLoose: false,
};
const sampleExtractLoose = {
  label: 'yerba',
  ingredients: [{ name: 'yerba', qty: null, unit: null }],
  isLoose: true,
};
const sampleResolve = {
  matched: [
    {
      aggregatedId: 'a-onion',
      ingredient: {
        id: 'a-onion',
        name: 'cebolla',
        qty: 2,
        unit: null,
        sources: [{ recipeId: 'r1', recipeLabel: 'Empanadas de pollo', originalText: '1 cebolla' }],
      },
      picked: { skuId: 'sku-onion', productId: 'p', name: 'Cebolla por kg', price: 1500, available: true },
      confidence: 'high',
      cartQty: 1,
    },
  ],
  unmatched: [
    {
      id: 'a-flour',
      name: 'harina',
      qty: 500,
      unit: 'g',
      sources: [{ recipeId: 'r1', recipeLabel: 'Empanadas de pollo', originalText: '500 g harina' }],
    },
  ],
  skipped: [{ name: 'sal', reason: 'pantry staple' }],
  candidates: {
    'a-onion': [{ skuId: 'sku-onion', productId: 'p', name: 'Cebolla por kg', price: 1500, available: true }],
    'a-flour': [],
  },
  redirectUrl: 'https://www.jumbo.com.ar/checkout/cart/add?sku=sku-onion&qty=1&seller=1&sc=32&redirect=true',
};

const mockApi = async (route: Route) => {
  const url = route.request().url();
  if (url.includes('/api/recipe/extract')) {
    const body = JSON.parse(route.request().postData() ?? '{}') as { url?: string; text?: string };
    if (body.url) {
      await route.fulfill({ status: 200, body: JSON.stringify(sampleExtractURL) });
    } else if (body.text === 'yerba') {
      await route.fulfill({ status: 200, body: JSON.stringify(sampleExtractLoose) });
    } else {
      await route.fulfill({ status: 200, body: JSON.stringify(sampleExtractText) });
    }
  } else if (url.includes('/api/checkout/resolve')) {
    await route.fulfill({ status: 200, body: JSON.stringify(sampleResolve) });
  } else if (url.includes('/api/search')) {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        products: [{ skuId: 'sku-flour', productId: 'pf', name: 'Harina 000 1kg', price: 2200, available: true }],
      }),
    });
  } else {
    await route.continue();
  }
};

test.beforeEach(async ({ context }) => {
  await context.route('**/api/**', mockApi);
});

test('paste URL → recipe card with label and ingredients', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-input').fill('https://example.test/empanadas');
  await page.getByTestId('add-submit').click();
  await expect(page.getByText('Empanadas de pollo')).toBeVisible();
  // Scope ingredient text matches to the ingredient rows so they don't
  // collide with the recipe label "Empanadas de pollo".
  await expect(page.getByText('pollo', { exact: true })).toBeVisible();
  await expect(page.getByText('cebolla', { exact: true })).toBeVisible();
});

test('paste text → manual recipe card', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-input').fill('Tarta de espinaca\n- espinaca\n- cebolla');
  await page.getByTestId('add-submit').click();
  await expect(page.getByText('Tarta de espinaca')).toBeVisible();
});

test('single short phrase → Otros card', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-input').fill('yerba');
  await page.getByTestId('add-submit').click();
  await expect(page.getByText('Otros')).toBeVisible();
  await expect(page.getByText('yerba')).toBeVisible();
});

test('checkout → resolution screen → send opens new tab', async ({ page, context }) => {
  await page.goto('/');
  await page.getByTestId('add-input').fill('https://example.test/empanadas');
  await page.getByTestId('add-submit').click();
  await expect(page.getByText('Empanadas de pollo')).toBeVisible();

  await page.getByTestId('checkout-button').click();
  await expect(page).toHaveURL(/\/checkout$/);
  await page.getByTestId('store-tile-jumbo').click();
  await page.getByTestId('store-continue').click();

  // Resolution screen
  await expect(page.getByTestId('matched-a-onion')).toBeVisible();
  await expect(page.getByTestId('unmatched-a-flour')).toBeVisible();

  const popupPromise = context.waitForEvent('page');
  await page.getByTestId('send-to-store').click();
  const popup = await popupPromise;
  // The popup may land on the redirect URL (/checkout/cart/add?...) and then
  // the store redirects to its own cart page — assert that the popup landed
  // on jumbo.com.ar at all.
  await popup.waitForURL(/jumbo\.com\.ar/, { timeout: 10_000 });
  expect(popup.url()).toMatch(/jumbo\.com\.ar/);
  await popup.close();
});

test('checkout with COTO: alert + per-product PDP open + send opens first PDP', async ({ page, context }) => {
  // Use COTO-flavored mock data: each picked product has a productUrl, and
  // the resolve API returns the first PDP as the redirectUrl.
  const cotoSampleResolve = {
    matched: [
      {
        aggregatedId: 'a-onion',
        ingredient: {
          id: 'a-onion',
          name: 'cebolla',
          qty: 2,
          unit: null,
          sources: [{ recipeId: 'r1', recipeLabel: 'Empanadas de pollo', originalText: '1 cebolla' }],
        },
        picked: {
          skuId: '00012345',
          productId: 'prod00012345',
          name: 'Cebolla Por Kg',
          price: 1500,
          available: true,
          productUrl: 'https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-00012345-00012345-200',
        },
        confidence: 'high',
        cartQty: 1,
      },
    ],
    unmatched: [],
    skipped: [],
    candidates: { 'a-onion': [] },
    redirectUrl: 'https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-00012345-00012345-200',
  };
  await context.unroute('**/api/**');
  await context.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/recipe/extract')) {
      await route.fulfill({ status: 200, body: JSON.stringify(sampleExtractURL) });
    } else if (url.includes('/api/checkout/resolve')) {
      await route.fulfill({ status: 200, body: JSON.stringify(cotoSampleResolve) });
    } else {
      await route.continue();
    }
  });

  await page.goto('/');
  await page.getByTestId('add-input').fill('https://example.test/empanadas');
  await page.getByTestId('add-submit').click();
  await expect(page.getByText('Empanadas de pollo')).toBeVisible();

  await page.getByTestId('checkout-button').click();
  await expect(page).toHaveURL(/\/checkout$/);
  await page.getByTestId('store-tile-coto').click();
  await page.getByTestId('store-continue').click();

  await expect(page.getByTestId('matched-a-onion')).toBeVisible();
  // COTO-only alert + per-product PDP link
  await expect(page.getByText(/Coto no permite cargar el carrito/)).toBeVisible();
  await expect(page.getByTestId('open-pdp-a-onion')).toHaveAttribute(
    'href',
    'https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-00012345-00012345-200',
  );

  const popupPromise = context.waitForEvent('page');
  await page.getByTestId('send-to-store').click();
  const popup = await popupPromise;
  await popup.waitForURL(/cotodigital\.com\.ar/, { timeout: 10_000 });
  expect(popup.url()).toMatch(/cotodigital\.com\.ar\/sitios\/cdigi\/productos\//);
  await popup.close();
});

test('preferences dialog persists value across reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-preferences-button').click();
  await page.getByTestId('preferences-input').fill('prefer lactose-free dairy');
  await page.getByTestId('preferences-save').click();
  await page.getByTestId('open-preferences-button').click();
  await expect(page.getByTestId('preferences-input')).toHaveValue('prefer lactose-free dairy');
});
