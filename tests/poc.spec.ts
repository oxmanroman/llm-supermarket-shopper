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

test('paste recipe URL → cart populates and snackbar shows unmatched', async ({ page, context }) => {
  await context.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/recipe')) {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          items: [
            { skuId: '1001', qty: 1, name: 'Manteca 200g', price: 1500 },
            { skuId: '1002', qty: 1, name: 'Huevos x12', price: 2200 },
          ],
          unmatched: ['salvia'],
        }),
      });
    } else {
      await mockApi(route);
    }
  });

  await page.goto('/');
  await page.getByTestId('select-store-jumbo').click();

  await page.getByTestId('recipe-url-input').fill('https://example.test/recipe');
  await page.getByTestId('recipe-submit-button').click();

  await expect(page.getByTestId('cart-item-1001')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('cart-item-1002')).toBeVisible();
  await expect(page.getByTestId('recipe-snackbar')).toContainText('Added 2 items');
  await expect(page.getByTestId('recipe-snackbar')).toContainText("Couldn't match: salvia");
});

test('preferences dialog: open, save, persists across reopen', async ({ page, context }) => {
  await context.route('**/api/**', mockApi);
  await page.goto('/');
  await page.getByTestId('select-store-jumbo').click();

  await page.getByTestId('open-preferences-button').click();
  await page.getByTestId('preferences-input').fill('prefer lactose-free dairy');
  await page.getByTestId('preferences-save').click();

  await page.getByTestId('open-preferences-button').click();
  await expect(page.getByTestId('preferences-input')).toHaveValue('prefer lactose-free dairy');
});
