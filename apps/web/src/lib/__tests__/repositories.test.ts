import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stockKey, uuidv7, type SyncConflictRecord } from '@shopdesk/shared';
import { setupBusiness, makeProduct, type TestBusiness } from '@/test/helpers';
import { taxSnapshot } from '@/lib/pos/cart';
import { createPurchase, cancelPurchase, createPurchaseReturn, receivePurchase, type PurchaseLineInput } from '@/lib/repos/purchases';
import { createSupplier, paySupplier, supplierBalance, createCustomer, receiveCustomerPayment, customerBalance } from '@/lib/repos/parties';
import { createExpense, voidExpense, openRegister, cashMovement, closeRegister, registerTotals, createExpenseCategory } from '@/lib/repos/finance';
import { createTransfer, receiveTransfer, setCountedStock } from '@/lib/repos/inventory';
import { sendKot, setKotStatus, setMetalRate, createJewelleryOrder, updateSetting, createTable } from '@/lib/repos/industry';
import { createCoupon, createBatch } from '@/lib/repos/catalog';
import { holdSale, takeHeldSale } from '@/lib/repos/sales';
import { emptyCart } from '@/lib/pos/cart';
import { resolveConflict, retryFailed, discardOperation } from '@/lib/repos/sync-center';
import { createDeviceBackup, restoreDeviceBackup } from '@/lib/backup';
import { validateRows, importRows, parseXlsx, type RawRow } from '@/lib/import';
import { toXlsx } from '@/lib/export';
import { getSetting } from '@/lib/settings';
import { syncEngine } from '@/lib/sync/engine';

let env: TestBusiness;
beforeEach(async () => {
  env = await setupBusiness();
  vi.spyOn(syncEngine, 'syncNow').mockResolvedValue();
});

const qty = async (productId: string, batchId: string | null = null, storeId = env.storeId) => (await env.database.stock_levels.get(stockKey(storeId, productId, null, batchId)))?.qty ?? 0;
const ops = async (operation: string) => (await env.database.sync_queue.toArray()).filter((o) => o.operation === operation);

function line(productId: string, quantity: number, extra: Partial<PurchaseLineInput> = {}): PurchaseLineInput {
  return { product_id: productId, variant_id: null, name: 'Item', quantity, unit_cost: 100, mrp: null, selling_price: null, discount_type: null, discount_value: null, tax_rate_id: env.gst18.id, tax: taxSnapshot(env.gst18), batch_no: null, expiry_date: null, mfg_date: null, serial_numbers: [], ...extra };
}

const supplierInput = { name: 'ABC Traders', phone: null, email: null, address: null, city: null, state_code: '32', gstin: null, opening_balance: 0, credit_days: 30, notes: null, active: true };

describe('purchases', () => {
  it('purchase bill adds stock, batch, serials and supplier balance; return and cancel reverse them', async () => {
    const supplier = await createSupplier(supplierInput);
    const med = await makeProduct(env, { name: 'Paracetamol', track_batch: true, track_expiry: true });
    const phone = await makeProduct(env, { name: 'Phone X', track_serial: true });
    const purchase = await createPurchase({
      supplier_id: supplier.id,
      doc_type: 'invoice',
      purchase_date: '2026-10-09',
      expected_date: null,
      supplier_invoice_no: 'B-1',
      supply_type: 'intra',
      lines: [line(med.id, 10, { batch_no: 'B1', expiry_date: '2027-10-01' }), line(phone.id, 2, { serial_numbers: ['IMEI1', 'IMEI2'] })],
      charges: [],
      bill_discount_type: null,
      bill_discount_value: null,
      payment: { method: 'cash', amount: 500, reference: null },
      notes: null,
    });
    expect(purchase.grand_total).toBe(1416);
    const batch = (await env.database.product_batches.where('product_id').equals(med.id).first())!;
    expect(await qty(med.id, batch.id)).toBe(10);
    expect(await env.database.product_serials.where('product_id').equals(phone.id).count()).toBe(2);
    expect(supplierBalance(await env.database.supplier_ledger.where('supplier_id').equals(supplier.id).toArray())).toBe(916);

    await createPurchaseReturn(purchase.id, [{ purchase_item_id: purchase.items[0]!.id, quantity: 4 }], 'damaged');
    expect(await qty(med.id, batch.id)).toBe(6);

    await paySupplier(supplier.id, { amount: 100, method: 'upi', reference: null, payment_date: '2026-10-09', notes: null, purchase_id: purchase.id });
    expect((await env.database.purchases.get(purchase.id))!.paid_total).toBe(600);

    await cancelPurchase(purchase.id);
    expect((await env.database.purchases.get(purchase.id))!.status).toBe('cancelled');
    expect(await qty(med.id, batch.id)).toBe(0);
  });

  it('purchase order adds stock only when received', async () => {
    const supplier = await createSupplier(supplierInput);
    const product = await makeProduct(env);
    const order = await createPurchase({ supplier_id: supplier.id, doc_type: 'order', purchase_date: '2026-10-09', expected_date: null, supplier_invoice_no: null, supply_type: 'intra', lines: [line(product.id, 5)], charges: [], bill_discount_type: null, bill_discount_value: null, payment: null, notes: null });
    expect(await qty(product.id)).toBe(0);
    await receivePurchase(order.id, [{ purchase_item_id: order.items[0]!.id, quantity: 3, batch_no: null, expiry_date: null, serial_numbers: [] }]);
    expect(await qty(product.id)).toBe(3);
    expect((await env.database.purchases.get(order.id))!.status).toBe('partially_received');
    expect(await ops('RECEIVE_PURCHASE')).toHaveLength(1);
  });
});

describe('finance, parties, inventory', () => {
  it('cash register expected cash includes sales cash, cash in/out and cash expenses', async () => {
    const register = await openRegister(1000, null);
    await cashMovement(register.id, 'cash_in', 200, 'Change');
    await cashMovement(register.id, 'cash_out', 50, 'Tea');
    const category = await createExpenseCategory('Rent');
    const expense = await createExpense({ category_id: category.id, amount: 300, payment_method: 'cash', expense_date: '2026-10-09', reference: null, notes: null, register_id: register.id });
    expect((await registerTotals(register)).expected_cash).toBe(850);
    await voidExpense(expense.id);
    const closed = await closeRegister(register.id, 1140, { '100': 11, '20': 2 }, null);
    expect(closed.expected_cash).toBe(1150);
    expect(closed.difference).toBe(-10);
  });

  it('customer payments reduce the balance', async () => {
    const customer = await createCustomer({ name: 'Ravi', phone: null, email: null, address: null, city: null, state_code: null, pincode: null, gstin: null, credit_limit: 0, opening_balance: 500, tier: null, notes: null, date_of_birth: null, active: true });
    expect(await customerBalance(customer.id)).toBe(500);
    await receiveCustomerPayment(customer.id, { amount: 200, method: 'cash', reference: null, payment_date: '2026-10-09', notes: null });
    expect(await customerBalance(customer.id)).toBe(300);
  });

  it('stock count, transfers out and transfers in', async () => {
    const product = await makeProduct(env);
    await setCountedStock(product.id, null, null, 12, 'Count');
    expect(await qty(product.id)).toBe(12);
    const other = uuidv7();
    await env.database.stores.put({ id: other, business_id: env.businessId, name: 'Branch', code: 'BR', address: null, phone: null, gstin: null, state_code: '32', is_default: false, active: true, version: 1, created_at: '', updated_at: '', deleted_at: null });
    const transfer = await createTransfer(other, [{ product_id: product.id, variant_id: null, batch_id: null, quantity: 5, unit_cost: 30 }], null);
    expect(await qty(product.id)).toBe(7);
    await receiveTransfer(transfer.id);
    expect(await qty(product.id, null, other)).toBe(5);
  });

  it('batches and coupons are created as syncable records', async () => {
    const product = await makeProduct(env, { track_batch: true });
    await createBatch({ product_id: product.id, variant_id: null, batch_no: 'X1', expiry_date: null, mfg_date: null, mrp: null, purchase_price: null, selling_price: null });
    await createCoupon({ code: 'DIWALI', description: null, discount_type: 'percent', discount_value: 10, min_amount: 0, max_discount: null, valid_from: null, valid_to: null, usage_limit: null, active: true });
    await expect(createCoupon({ code: 'DIWALI', description: null, discount_type: 'percent', discount_value: 5, min_amount: 0, max_discount: null, valid_from: null, valid_to: null, usage_limit: null, active: true })).rejects.toThrow();
    expect(await ops('CREATE_PRODUCT_BATCH')).toHaveLength(1);
    expect(await ops('CREATE_COUPON')).toHaveLength(1);
  });
});

describe('industry & settings', () => {
  it('KOT, metal rate, jewellery order, table and settings operations', async () => {
    const table = await createTable({ name: 'T1', area: null, capacity: 4, sort_order: 0, active: true });
    const kot = await sendKot({ table_id: table.id, order_type: 'dine_in', items: [{ product_id: uuidv7(), variant_id: null, name: 'Biryani', quantity: 2, unit_price: 180, modifiers: [], notes: null }] });
    expect(kot.kot_number).toBe('C1-0001');
    await setKotStatus(kot.id, 'ready');
    expect((await env.database.kitchen_orders.get(kot.id))!.status).toBe('ready');
    await setMetalRate('gold', '22K', 6500);
    const order = await createJewelleryOrder({ type: 'repair', customer_id: null, customer_name: 'Meena', customer_phone: null, description: 'Chain repair', metal: 'gold', purity: '22K', weight: 8, estimated_amount: 500, advance_paid: 100, advance_method: 'cash', due_date: null, status: 'received', notes: null });
    expect(order.order_number).toBe('JO-C1-0001');
    await updateSetting('pos', { allow_negative_stock: false });
    expect((await getSetting('pos')).allow_negative_stock).toBe(false);
    const settingOp = (await ops('UPDATE_SETTING'))[0]!;
    expect(settingOp.payload).toMatchObject({ key: 'pos', changes: { allow_negative_stock: false }, base: { allow_negative_stock: null } });
  });

  it('held bills stay local and come back intact', async () => {
    await holdSale({ ...emptyCart(), notes: 'table 4' }, 100, 'Hold A');
    const held = (await env.database.held_sales.toArray())[0]!;
    expect(await env.database.sync_queue.count()).toBe(0);
    expect((await takeHeldSale(held.id))?.notes).toBe('table 4');
    expect(await env.database.held_sales.count()).toBe(0);
  });
});

describe('sync center', () => {
  it('retry re-queues failed operations; discard removes them', async () => {
    await makeProduct(env);
    const op = (await env.database.sync_queue.toArray())[0]!;
    await env.database.sync_queue.update(op.id!, { status: 'failed', last_error: 'Invalid', retry_count: 12 });
    await retryFailed();
    expect(await env.database.sync_queue.get(op.id!)).toMatchObject({ status: 'pending', retry_count: 0, last_error: null });
    await discardOperation(op);
    expect(await env.database.sync_queue.count()).toBe(0);
  });

  it('keep_local resolution sends a forced update with the local values', async () => {
    const product = await makeProduct(env);
    const conflict: SyncConflictRecord = { id: uuidv7(), business_id: env.businessId, operation_id: uuidv7(), entity_type: 'product', entity_id: product.id, conflict_type: 'field', fields: [{ field: 'selling_price', base: 59, local: 65, server: 62 }], server_data: null, local_payload: null, message: 'Price changed on two devices', status: 'open', resolution: null, created_at: '', resolved_at: null, version: 1, updated_at: '' };
    await env.database.sync_conflicts.put(conflict);
    await resolveConflict(conflict, 'keep_local');
    const forced = (await ops('UPDATE_PRODUCT'))[0]!;
    expect(forced.payload).toMatchObject({ changes: { selling_price: 65 }, base: { selling_price: 62 }, force: true });
    expect((await env.database.products.get(product.id))!.selling_price).toBe(65);
    expect(await ops('RESOLVE_CONFLICT')).toHaveLength(1);
  });
});

describe('backup & import', () => {
  it('device backup restores unsynced work after browser data is lost', async () => {
    await makeProduct(env, { name: 'Lost Soap' });
    const backup = await createDeviceBackup();
    await env.database.products.clear();
    await env.database.sync_queue.clear();
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    const summary = await restoreDeviceBackup(file);
    expect(summary.pendingOperations).toBe(1);
    expect((await env.database.products.toArray())[0]!.name).toBe('Lost Soap');
    // Restoring twice never duplicates queued operations.
    expect((await restoreDeviceBackup(file)).pendingOperations).toBe(0);
  });

  it('validates rows, reports errors and imports valid products with opening stock', async () => {
    const rows = [
      { name: 'Rice 1kg', sku: 'R1', barcode: '', category: 'Groceries', unit: 'PCS', purchase_price: '50', selling_price: '60', mrp: '65', gst_rate: '18', opening_stock: '20' },
      { name: '', sku: 'R2', selling_price: '10' },
      { name: 'Dup', sku: 'R1', selling_price: '10' },
      { name: 'Bad price', sku: 'R3', selling_price: 'abc' },
    ];
    const validated = await validateRows('products', rows as RawRow[]);
    expect(validated.filter((r) => r.data)).toHaveLength(1);
    expect(validated[1]!.errors.join()).toMatch(/name/i);
    expect(validated[2]!.errors.join()).toMatch(/repeated/);
    const count = await importRows('products', validated);
    expect(count).toBe(1);
    const product = (await env.database.products.toArray())[0]!;
    expect(product.tax_rate_id).toBe(env.gst18.id);
    expect(await env.database.categories.count()).toBe(1);
    expect(await qty(product.id)).toBe(20);
  });

  it('reads back the XLSX files it writes', () => {
    const bytes = toXlsx('Sheet1', [{ key: 'name', header: 'Name' }, { key: 'price', header: 'Selling Price', numeric: true }], [{ name: 'Tea', price: 12.5 }]);
    expect(parseXlsx(bytes)).toEqual([{ name: 'Tea', selling_price: '12.5' }]);
  });
});
