import { beforeEach, describe, expect, it } from 'vitest';
import { stockKey, uuidv7 } from '@shopdesk/shared';
import { setupBusiness, makeProduct, type TestBusiness } from '@/test/helpers';
import { emptyCart, lineFromProduct, priceCart, taxSnapshot } from '@/lib/pos/cart';
import { adjustStock } from '@/lib/repos/inventory';
import { cancelSale, completeSale, createSaleReturn } from '@/lib/repos/sales';
import { createCustomer, customerBalance } from '@/lib/repos/parties';
import { updateProduct } from '@/lib/repos/catalog';
import { mutate, enqueue } from '@/lib/sync/outbox';
import { applyChanges } from '@/lib/sync/apply';
import { allocateNumber } from '@/lib/sync/numbers';

let env: TestBusiness;

beforeEach(async () => {
  env = await setupBusiness();
});

async function stock(productId: string) {
  return (await env.database.stock_levels.get(stockKey(env.storeId, productId, null, null)))?.qty ?? 0;
}

async function sell(productId: string, quantity: number, opts: { customerId?: string | null; payments?: 'cash' | 'credit' } = {}) {
  const product = (await env.database.products.get(productId))!;
  const cart = { ...emptyCart(), customer_id: opts.customerId ?? null, customer_name: opts.customerId ? 'Anil' : null, lines: [lineFromProduct({ product, tax: env.gst18, quantity, unitCode: 'PCS' })] };
  const pricing = priceCart(cart, { supplyType: 'intra', roundOff: '1.00' });
  return completeSale({
    cart,
    pricing,
    payments: [{ method: opts.payments ?? 'cash', amount: pricing.grand_total, tendered: opts.payments === 'credit' ? null : pricing.grand_total, change: 0 }],
    supplyType: 'intra',
    roundOff: '1.00',
    registerId: null,
  });
}

describe('outbox', () => {
  it('writes the record and its sync operation in the same transaction', async () => {
    const product = await makeProduct(env);
    const ops = await env.database.sync_queue.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ operation: 'CREATE_PRODUCT', entity_id: product.id, status: 'pending', device_id: env.deviceId, user_id: env.userId });
    expect(ops[0]!.operation_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rolls back data and operation together when the work fails', async () => {
    await expect(
      mutate([env.database.categories], async () => {
        await env.database.categories.put({ id: uuidv7(), business_id: env.businessId, name: 'Ghost', parent_id: null, color: null, sort_order: 0, active: true, version: 0, created_at: '', updated_at: '', deleted_at: null });
        await enqueue({ operation: 'CREATE_CATEGORY', entity_id: uuidv7(), payload: {} });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await env.database.categories.count()).toBe(0);
    expect(await env.database.sync_queue.count()).toBe(0);
  });

  it('sends only changed fields with their base values for updates', async () => {
    const product = await makeProduct(env);
    await updateProduct(product.id, { selling_price: 65, name: 'Test Soap' });
    const update = (await env.database.sync_queue.toArray()).find((o) => o.operation === 'UPDATE_PRODUCT')!;
    expect(update.payload).toEqual({ changes: { selling_price: 65 }, base: { selling_price: 59 } });
  });
});

describe('offline sale', () => {
  it('records sale, stock movement, outbox operation and provisional number atomically', async () => {
    const product = await makeProduct(env);
    await adjustStock('opening_stock', [{ product_id: product.id, variant_id: null, batch_id: null, quantity: 10, unit_cost: 30 }], 'Opening');
    expect(await stock(product.id)).toBe(10);

    const sale = await sell(product.id, 3);
    expect(sale.number_status).toBe('provisional');
    expect(sale.invoice_number).toMatch(/^TMP-C1-/);
    expect(sale.grand_total).toBe(177);
    expect(await stock(product.id)).toBe(7);

    const op = (await env.database.sync_queue.toArray()).find((o) => o.operation === 'CREATE_SALE')!;
    expect(op.entity_id).toBe(sale.id);
    const items = op.payload.items as Array<{ movement_id: string | null }>;
    const movement = await env.database.inventory_movements.get(items[0]!.movement_id!);
    expect(movement).toMatchObject({ type: 'SALE', qty_out: 3, reference_id: sale.id });
    expect(movement!.synced).not.toBe(1);
  });

  it('uses a reserved number block for final numbers while offline', async () => {
    await env.database.number_blocks.put({ id: uuidv7(), document_type: 'sale', period: new Date().toISOString().slice(0, 4), format: 'INV-{YYYY}-{SEQ:6}', start_number: 41, end_number: 42, next_number: 41, device_code: 'C1' });
    const numbers = [];
    for (let i = 0; i < 3; i++) numbers.push(await env.database.transaction('rw', [env.database.number_blocks, env.database.meta], () => allocateNumber('sale')));
    const year = new Date().getFullYear();
    expect(numbers.map((n) => n.number)).toEqual([`INV-${year}-000041`, `INV-${year}-000042`, 'TMP-C1-00001']);
    expect(numbers.map((n) => n.status)).toEqual(['final', 'final', 'provisional']);
  });

  it('credit sale updates the customer balance; cancellation reverses stock and balance', async () => {
    const product = await makeProduct(env);
    const customer = await createCustomer({ name: 'Anil', phone: '9876543210', email: null, address: null, city: null, state_code: '32', pincode: null, gstin: null, credit_limit: 0, opening_balance: 0, tier: null, notes: null, date_of_birth: null, active: true });
    const sale = await sell(product.id, 2, { customerId: customer.id, payments: 'credit' });
    expect(sale.balance_due).toBe(sale.grand_total);
    expect(await customerBalance(customer.id)).toBe(sale.grand_total);
    expect(await stock(product.id)).toBe(-2);

    await cancelSale(sale.id, 'Wrong item');
    expect(await customerBalance(customer.id)).toBe(0);
    expect(await stock(product.id)).toBe(0);
    expect((await env.database.sales.get(sale.id))!.status).toBe('cancelled');
  });

  it('returns refund pro-rata and restock', async () => {
    const product = await makeProduct(env);
    const sale = await sell(product.id, 3);
    const ret = await createSaleReturn(sale.id, [{ sale_item_id: sale.items[0]!.id, quantity: 1, restock: true }], 'cash', null, null);
    expect(ret.total).toBe(59);
    expect(await stock(product.id)).toBe(-2);
    expect((await env.database.sales.get(sale.id))!.items[0]!.returned_qty).toBe(1);
  });
});

describe('pull / convergence', () => {
  it('server stock replaces local stock while unsynced movements stay applied', async () => {
    const product = await makeProduct(env);
    await sell(product.id, 2);
    const key = stockKey(env.storeId, product.id, null, null);
    // Another device sold 5; the server reports 20 received earlier − 5 = 15 (our sale is not included yet).
    await applyChanges(env.database, [{ seq: 1, entity_type: 'stock_level', entity_id: key, action: 'upsert', data: { stock_key: key, business_id: env.businessId, store_id: env.storeId, product_id: product.id, variant_id: null, batch_id: null, qty: 15, avg_cost: 30 } }]);
    expect(await stock(product.id)).toBe(13);
  });

  it('pulled master data keeps local edits that are still pending', async () => {
    const product = await makeProduct(env);
    await updateProduct(product.id, { selling_price: 70 });
    const server = { ...(await env.database.products.get(product.id))!, selling_price: 59, name: 'Renamed on server', version: 2 };
    await applyChanges(env.database, [{ seq: 2, entity_type: 'product', entity_id: product.id, action: 'upsert', data: server as never }]);
    const local = (await env.database.products.get(product.id))!;
    expect(local.name).toBe('Renamed on server');
    expect(local.selling_price).toBe(70);
  });
});

describe('pricing parity helpers', () => {
  it('inclusive GST back-calculation matches the receipt', () => {
    const cart = { ...emptyCart(), lines: [{ ...lineFromProduct({ product: { id: 'p', name: 'X', product_type: 'standard', selling_price: 118, purchase_price: 0, mrp: null, price_includes_tax: true, tax_rate_id: 't', track_inventory: false, attributes: {}, variants: [], price_tiers: [], sku: null, hsn_code: null, warranty_months: null } as never, tax: { ...env.gst18, id: 't' } }), tax: taxSnapshot({ ...env.gst18, id: 't' }) }] };
    const p = priceCart(cart, { supplyType: 'intra', roundOff: 'none' });
    expect(p.taxable_total).toBe(100);
    expect(p.tax_total).toBe(18);
    expect(p.tax_breakup.map((r) => [r.code, r.amount])).toEqual([
      ['CGST', 9],
      ['SGST', 9],
    ]);
  });
});
