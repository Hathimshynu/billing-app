import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRITICAL: the full offline workflow.
 * login → download data → go offline → create product & customer → sell → pay → print → reload
 * offline → data still there → reconnect → sync → server has the records exactly once.
 */

const OWNER = { email: 'owner@shopdesk.test', password: 'Password123' };
const BUSINESS = 'FreshMart Supermarket';
const API = `http://127.0.0.1:${process.env.E2E_API_PORT || '8010'}/api/v1`;

async function serverSession(request: APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, { data: OWNER, headers: { Accept: 'application/json' } });
  expect(login.ok()).toBeTruthy();
  const body = (await login.json()) as { data: { token: string; businesses: Array<{ business: { id: string; name: string } }> } };
  const business = body.data.businesses.find((b) => b.business.name === BUSINESS)!;
  const headers = { Authorization: `Bearer ${body.data.token}`, 'X-Business-Id': business.business.id, Accept: 'application/json' };
  return {
    get: async <T>(path: string, params: Record<string, string> = {}) => {
      const response = await request.get(`${API}${path}`, { headers, params });
      expect(response.ok(), `${path} → ${response.status()}`).toBeTruthy();
      return ((await response.json()) as { data: T }).data;
    },
  };
}

async function pendingCount(page: Page): Promise<number> {
  return Number(await page.getByTestId('pending-count').textContent());
}

test('works fully offline and syncs exactly once when back online', async ({ page, context, request }) => {
  const stamp = Date.now().toString().slice(-6);
  const productName = `E2E Offline Tea ${stamp}`;
  const barcode = `29${stamp}0000`.slice(0, 12);
  const customerName = `E2E Customer ${stamp}`;
  const customerPhone = `98${stamp}12`.slice(0, 10);
  const printed: string[] = [];
  await page.exposeFunction('__e2ePrinted', (html: string) => printed.push(html));
  await page.addInitScript(() => {
    (window as unknown as { __shopdeskPrintHook: (html: string) => void }).__shopdeskPrintHook = (html) => void (window as unknown as { __e2ePrinted: (h: string) => Promise<void> }).__e2ePrinted(html);
  });

  // 1. Login online and open the business (downloads all data to IndexedDB).
  await page.goto('/login');
  await page.locator('#email').fill(OWNER.email);
  await page.locator('#password').fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('button', { name: new RegExp(BUSINESS) }).click();
  await expect(page.getByRole('link', { name: /new sale/i })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'idle', { timeout: 120_000 });

  // The service worker must control the page so the app shell loads with no network.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);

  // 2. Go offline.
  await context.setOffline(true);
  await page.goto('/products/new');
  await expect(page.getByTestId('offline-banner')).toBeVisible();

  // 3. Create a product offline (with opening stock).
  await page.getByTestId('product-name').fill(productName);
  await page.getByTestId('product-barcode').fill(barcode);
  await page.locator('#selling_price').fill('120');
  await page.locator('#purchase_price').fill('80');
  await page.getByTestId('product-opening').fill('25');
  await page.getByTestId('product-save').click();
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByText(productName)).toBeVisible();

  // 4. Create a customer offline.
  await page.goto('/customers');
  await page.getByTestId('new-customer').click();
  await page.locator('#cf-name').fill(customerName);
  await page.locator('#cf-phone').fill(customerPhone);
  await page.getByTestId('customer-form-save').click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/);

  // 5. Sell offline: scan barcode, pick the customer, pay cash, print.
  await page.goto('/pos');
  await page.getByTestId('pos-search').fill(barcode);
  await page.getByTestId('pos-search').press('Enter');
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await page.getByTestId('line-qty').first().waitFor();
  await page.getByRole('button', { name: /increase quantity/i }).click();
  await expect(page.getByTestId('line-qty').first()).toHaveText('2');
  await page.getByTestId('customer-button').click();
  await page.getByTestId('customer-search').fill(customerPhone);
  await page.getByTestId('customer-option').first().click();
  await page.getByTestId('pay-button').click();
  await page.getByTestId('pay-cash').click();
  await page.getByTestId('complete-sale').click();
  await expect(page.getByTestId('new-sale')).toBeVisible();
  await expect.poll(() => printed.length).toBeGreaterThan(0);
  expect(printed[0]).toContain(productName);
  await page.getByTestId('new-sale').click();

  // 6. The sale is stored locally and waits for sync.
  await page.goto('/sales');
  const saleRow = page.getByRole('row', { name: new RegExp(customerName) });
  await expect(saleRow).toBeVisible();
  const invoiceCell = (await saleRow.getByRole('cell').first().locator('span span').first().textContent())!.trim();
  await page.goto('/sync');
  await expect.poll(() => pendingCount(page)).toBeGreaterThanOrEqual(4);

  // 7. Reload while offline: the app opens from the service worker and the data is still there.
  await page.reload();
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await page.goto('/sales');
  await expect(page.getByRole('row', { name: new RegExp(customerName) })).toBeVisible();

  // 8. Reconnect and sync.
  await context.setOffline(false);
  await page.goto('/sync');
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('pending-count')).toHaveText('0', { timeout: 60_000 });

  // 9. The server has every record exactly once (no duplicates, even after another sync).
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('pending-count')).toHaveText('0');
  const server = await serverSession(request);
  const products = await server.get<Array<{ name: string; barcode: string }>>('/products', { search: productName });
  expect(products.filter((p) => p.name === productName)).toHaveLength(1);
  const customers = await server.get<Array<{ name: string }>>('/customers', { search: customerPhone });
  expect(customers).toHaveLength(1);
  const sales = await server.get<Array<{ customer_name: string; grand_total: number; invoice_number: string; items: Array<{ quantity: number }> }>>('/sales', { search: customerName });
  expect(sales).toHaveLength(1);
  expect(Number(sales[0]!.grand_total)).toBe(240);
  expect(Number(sales[0]!.items[0]!.quantity)).toBe(2);
  // Offline numbers are either reserved (final) or temporary and replaced by the server.
  expect(sales[0]!.invoice_number).not.toMatch(/^TMP-/);
  if (!invoiceCell.startsWith('TMP-')) expect(sales[0]!.invoice_number).toBe(invoiceCell);

  // 10. Stock on the server: opening 25 − 2 sold = 23.
  const productId = (await server.get<Array<{ id: string; name: string }>>('/products', { search: productName }))[0]!.id;
  const levels = await server.get<Array<{ qty: number }>>('/inventory', { product_id: productId });
  expect(levels.reduce((sum, l) => sum + Number(l.qty), 0)).toBe(23);
});
