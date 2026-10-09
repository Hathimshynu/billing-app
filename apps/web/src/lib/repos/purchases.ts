import {
  calculatePricing,
  fromScaled,
  mulDivRound,
  QTY_SCALE,
  roundTo,
  toScaled,
  uuidv7,
  type DiscountType,
  type PaymentMethod,
  type Purchase,
  type PurchaseItem,
  type PurchaseReturn,
  type PurchaseReturnItem,
  type SupplyType,
  type TaxSnapshot,
} from '@shopdesk/shared';
import { db } from '../db/business';
import { runtime } from '../runtime';
import { allocateNumber } from '../sync/numbers';
import { enqueue, mutate } from '../sync/outbox';
import { newEntityBase, nowIso, recordMovement } from './base';
import { supplierLedgerEntry, today } from './parties';

export interface PurchaseLineInput {
  product_id: string;
  variant_id: string | null;
  name: string;
  quantity: number;
  unit_cost: number;
  mrp: number | null;
  selling_price: number | null;
  discount_type: DiscountType | null;
  discount_value: number | null;
  tax_rate_id: string | null;
  tax: TaxSnapshot | null;
  batch_no: string | null;
  expiry_date: string | null;
  mfg_date: string | null;
  serial_numbers: string[];
}

export interface PurchaseInput {
  supplier_id: string;
  doc_type: 'order' | 'invoice';
  purchase_date: string;
  expected_date: string | null;
  supplier_invoice_no: string | null;
  supply_type: SupplyType;
  lines: PurchaseLineInput[];
  charges: Array<{ key: string; name: string; amount: number }>;
  bill_discount_type: DiscountType | null;
  bill_discount_value: number | null;
  payment: { method: PaymentMethod; amount: number; reference: string | null } | null;
  notes: string | null;
}

export function pricePurchase(input: Pick<PurchaseInput, 'lines' | 'charges' | 'bill_discount_type' | 'bill_discount_value' | 'supply_type'>) {
  return calculatePricing({
    lines: input.lines.map((l, i) => ({
      key: String(i),
      quantity: l.quantity,
      unit_price: l.unit_cost,
      price_includes_tax: false,
      discount_type: l.discount_type,
      discount_value: l.discount_value,
      tax: l.tax,
    })),
    charges: input.charges.map((c) => ({ key: c.key, name: c.name, amount: c.amount, tax: null })),
    bill_discount_type: input.bill_discount_type,
    bill_discount_value: input.bill_discount_value,
    supply_type: input.supply_type,
  });
}

/** Find (or create locally) the batch a received line belongs to. */
async function resolveBatch(productId: string, variantId: string | null, line: Pick<PurchaseLineInput, 'batch_no' | 'expiry_date' | 'mfg_date' | 'mrp' | 'unit_cost' | 'selling_price'>): Promise<string | null> {
  if (!line.batch_no) return null;
  const database = db();
  const existing = await database.product_batches
    .where('product_id')
    .equals(productId)
    .filter((b) => b.batch_no === line.batch_no && (b.expiry_date ?? null) === (line.expiry_date ?? null))
    .first();
  if (existing) return existing.id;
  const batch = {
    ...newEntityBase(),
    product_id: productId,
    variant_id: variantId,
    batch_no: line.batch_no,
    expiry_date: line.expiry_date,
    mfg_date: line.mfg_date,
    mrp: line.mrp,
    purchase_price: line.unit_cost,
    selling_price: line.selling_price,
  };
  await database.product_batches.put(batch);
  return batch.id;
}

export async function createPurchase(input: PurchaseInput): Promise<Purchase> {
  const rt = runtime();
  const database = db();
  const pricing = pricePurchase(input);
  const isInvoice = input.doc_type === 'invoice';
  return mutate(
    [database.purchases, database.suppliers, database.supplier_ledger, database.inventory_movements, database.stock_levels, database.product_batches, database.product_serials, database.number_blocks],
    async () => {
      const supplier = await database.suppliers.get(input.supplier_id);
      if (!supplier) throw new Error('Choose a supplier.');
      const number = await allocateNumber(isInvoice ? 'purchase' : 'purchase_order', input.purchase_date);
      const purchaseId = uuidv7();
      const items: PurchaseItem[] = [];
      const payloadItems: Array<Record<string, unknown>> = [];

      for (const [i, line] of input.lines.entries()) {
        const calc = pricing.lines[i]!;
        const itemId = uuidv7();
        let batchId: string | null = null;
        let movementId: string | null = null;
        const serialIds: string[] = [];
        if (isInvoice) {
          batchId = await resolveBatch(line.product_id, line.variant_id, line);
          const unitCost = line.quantity ? roundTo(calc.taxable / line.quantity) : line.unit_cost;
          const movement = await recordMovement({
            product_id: line.product_id,
            variant_id: line.variant_id,
            batch_id: batchId,
            type: 'PURCHASE',
            qty_in: line.quantity,
            unit_cost: unitCost,
            reference_type: 'purchase',
            reference_id: purchaseId,
            reference_no: number.number,
          });
          movementId = movement.id;
          for (const serialNo of line.serial_numbers.map((s) => s.trim()).filter(Boolean)) {
            const serialId = uuidv7();
            serialIds.push(serialId);
            await database.product_serials.put({
              ...newEntityBase(serialId),
              product_id: line.product_id,
              variant_id: line.variant_id,
              store_id: rt.storeId,
              serial_no: serialNo,
              imei1: /^\d{15}$/.test(serialNo) ? serialNo : null,
              imei2: null,
              status: 'in_stock',
              cost_price: line.unit_cost,
              purchase_id: purchaseId,
              sale_id: null,
              customer_id: null,
              warranty_months: null,
              sold_at: null,
              warranty_expires_at: null,
            });
          }
        }
        const item: PurchaseItem = {
          id: itemId,
          product_id: line.product_id,
          variant_id: line.variant_id,
          name: line.name,
          quantity: line.quantity,
          received_qty: isInvoice ? line.quantity : 0,
          returned_qty: 0,
          unit_cost: line.unit_cost,
          mrp: line.mrp,
          selling_price: line.selling_price,
          discount_type: line.discount_type,
          discount_value: line.discount_value,
          tax_rate_id: line.tax_rate_id,
          tax: line.tax,
          price_includes_tax: false,
          batch_id: batchId,
          batch_no: line.batch_no,
          expiry_date: line.expiry_date,
          mfg_date: line.mfg_date,
          serial_numbers: line.serial_numbers,
          taxable: calc.taxable,
          tax_total: calc.tax_total,
          total: calc.total,
        };
        items.push(item);
        payloadItems.push({ ...item, serial_ids: serialIds, movement_id: movementId });
      }

      const paid = input.payment && input.payment.amount > 0 ? roundTo(input.payment.amount) : 0;
      const payments = paid > 0 ? [{ id: uuidv7(), method: input.payment!.method, amount: paid, reference: input.payment!.reference, occurred_at: nowIso() }] : [];
      const ledgerIds: Record<string, string | null> = { purchase: null, payment: null };
      if (isInvoice) {
        const credit = supplierLedgerEntry({ supplier_id: supplier.id, type: 'purchase', credit: pricing.grand_total, reference_type: 'purchase', reference_id: purchaseId, reference_no: number.number });
        await database.supplier_ledger.put(credit);
        ledgerIds.purchase = credit.id;
      }
      if (paid > 0) {
        const debit = supplierLedgerEntry({ supplier_id: supplier.id, type: 'purchase_payment', debit: paid, reference_type: 'purchase', reference_id: purchaseId, reference_no: number.number });
        await database.supplier_ledger.put(debit);
        ledgerIds.payment = debit.id;
      }
      const balance = isInvoice ? roundTo(Math.max(pricing.grand_total - paid, 0)) : 0;
      const purchase: Purchase = {
        ...newEntityBase(purchaseId),
        store_id: rt.storeId,
        device_id: rt.deviceId,
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        doc_type: input.doc_type,
        status: isInvoice ? 'received' : 'ordered',
        purchase_number: number.number,
        number_status: number.status,
        supplier_invoice_no: input.supplier_invoice_no,
        purchase_date: input.purchase_date,
        expected_date: input.expected_date,
        supply_type: input.supply_type,
        items,
        charges: input.charges.map((c, i) => ({ key: c.key, name: c.name, amount: c.amount, tax_rate_id: null, tax: null, taxable: pricing.charges[i]?.taxable ?? c.amount, tax_total: 0, total: pricing.charges[i]?.total ?? c.amount })),
        bill_discount_type: input.bill_discount_type,
        bill_discount_value: input.bill_discount_value,
        gross_total: pricing.gross_total,
        discount_total: pricing.discount_total,
        taxable_total: pricing.taxable_total,
        tax_total: pricing.tax_total,
        charges_total: pricing.charges_total,
        round_off: pricing.round_off,
        grand_total: pricing.grand_total,
        paid_total: paid,
        balance_due: balance,
        returned_total: 0,
        payment_status: paid >= pricing.grand_total ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
        payments,
        notes: input.notes,
        created_by: rt.userId,
        received_at: isInvoice ? nowIso() : null,
      };
      await database.purchases.put({ ...purchase, _pending: 1 });
      await enqueue({
        operation: 'CREATE_PURCHASE',
        entity_id: purchaseId,
        payload: {
          store_id: rt.storeId,
          supplier_id: supplier.id,
          doc_type: input.doc_type,
          purchase_number: number.number,
          number_status: number.status,
          number_block_id: number.block_id,
          number_sequence: number.sequence,
          supplier_invoice_no: input.supplier_invoice_no,
          purchase_date: input.purchase_date,
          expected_date: input.expected_date,
          supply_type: input.supply_type,
          items: payloadItems,
          charges: input.charges,
          bill_discount_type: input.bill_discount_type,
          bill_discount_value: input.bill_discount_value,
          payments,
          notes: input.notes,
          ledger_ids: ledgerIds,
        },
      });
      return purchase;
    },
  );
}

export interface ReceiveLineInput {
  purchase_item_id: string;
  quantity: number;
  batch_no: string | null;
  expiry_date: string | null;
  serial_numbers: string[];
}

/** Receive (part of) a purchase order. */
export async function receivePurchase(purchaseId: string, lines: ReceiveLineInput[]): Promise<void> {
  const rt = runtime();
  const database = db();
  await mutate([database.purchases, database.supplier_ledger, database.inventory_movements, database.stock_levels, database.product_batches, database.product_serials], async () => {
    const purchase = await database.purchases.get(purchaseId);
    if (!purchase || purchase.status === 'cancelled') throw new Error('Purchase order not found.');
    const items = purchase.items.map((i) => ({ ...i }));
    const payloadItems: Array<Record<string, unknown>> = [];
    let value = 0;
    for (const line of lines.filter((l) => l.quantity > 0)) {
      const item = items.find((i) => i.id === line.purchase_item_id);
      if (!item) continue;
      const batchId = await resolveBatch(item.product_id, item.variant_id, { ...item, batch_no: line.batch_no ?? item.batch_no, expiry_date: line.expiry_date ?? item.expiry_date });
      const movement = await recordMovement({
        product_id: item.product_id,
        variant_id: item.variant_id,
        batch_id: batchId,
        type: 'PURCHASE',
        qty_in: line.quantity,
        unit_cost: item.quantity ? roundTo(item.taxable / item.quantity) : item.unit_cost,
        reference_type: 'purchase',
        reference_id: purchase.id,
        reference_no: purchase.purchase_number,
      });
      const serialIds: string[] = [];
      for (const serialNo of line.serial_numbers.map((s) => s.trim()).filter(Boolean)) {
        const serialId = uuidv7();
        serialIds.push(serialId);
        await database.product_serials.put({
          ...newEntityBase(serialId),
          product_id: item.product_id,
          variant_id: item.variant_id,
          store_id: rt.storeId,
          serial_no: serialNo,
          imei1: /^\d{15}$/.test(serialNo) ? serialNo : null,
          imei2: null,
          status: 'in_stock',
          cost_price: item.unit_cost,
          purchase_id: purchase.id,
          sale_id: null,
          customer_id: null,
          warranty_months: null,
          sold_at: null,
          warranty_expires_at: null,
        });
      }
      item.received_qty = roundTo(item.received_qty + line.quantity, 3);
      item.batch_id = item.batch_id ?? batchId;
      const ordered = toScaled(item.quantity, QTY_SCALE);
      value += ordered ? mulDivRound(toScaled(item.total, 2), toScaled(line.quantity, QTY_SCALE), ordered) : 0;
      payloadItems.push({ purchase_item_id: item.id, quantity: line.quantity, batch_id: batchId, batch_no: line.batch_no ?? item.batch_no, expiry_date: line.expiry_date ?? item.expiry_date, serial_numbers: line.serial_numbers, serial_ids: serialIds, movement_id: movement.id });
    }
    if (payloadItems.length === 0) throw new Error('Enter quantities to receive.');
    const allReceived = items.every((i) => i.received_qty + 0.0005 >= i.quantity);
    const entry = supplierLedgerEntry({ supplier_id: purchase.supplier_id, type: 'purchase', credit: fromScaled(value, 2), reference_type: 'purchase', reference_id: purchase.id, reference_no: purchase.purchase_number, notes: 'Goods received' });
    await database.supplier_ledger.put(entry);
    await database.purchases.put({ ...purchase, items, status: allReceived ? 'received' : 'partially_received', received_at: nowIso(), _pending: 1 });
    await enqueue({ operation: 'RECEIVE_PURCHASE', entity_id: purchase.id, payload: { items: payloadItems, ledger_id: entry.id } });
  });
}

export async function cancelPurchase(purchaseId: string): Promise<void> {
  const database = db();
  await mutate([database.purchases, database.supplier_ledger, database.inventory_movements, database.stock_levels], async () => {
    const purchase = await database.purchases.get(purchaseId);
    if (!purchase || purchase.status === 'cancelled') return;
    const movementIds: Record<string, string> = {};
    for (const item of purchase.items) {
      const received = roundTo(item.received_qty - item.returned_qty, 3);
      if (received > 0) {
        const movement = await recordMovement({
          store_id: purchase.store_id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          batch_id: item.batch_id,
          type: 'PURCHASE_RETURN',
          qty_out: received,
          unit_cost: item.unit_cost,
          reference_type: 'purchase_cancel',
          reference_id: purchase.id,
          reference_no: purchase.purchase_number,
          notes: 'Purchase cancelled',
        });
        movementIds[item.id] = movement.id;
      }
    }
    if (purchase.status !== 'ordered') {
      await database.supplier_ledger.put(supplierLedgerEntry({ supplier_id: purchase.supplier_id, type: 'adjustment', debit: roundTo(purchase.grand_total - purchase.returned_total), reference_type: 'purchase_cancel', reference_id: purchase.id, reference_no: purchase.purchase_number, notes: 'Purchase cancelled' }));
    }
    await database.purchases.put({ ...purchase, status: 'cancelled', _pending: 1 });
    await enqueue({ operation: 'CANCEL_PURCHASE', entity_id: purchase.id, payload: { movement_ids: movementIds } });
  });
}

export async function createPurchaseReturn(purchaseId: string, lines: Array<{ purchase_item_id: string; quantity: number }>, reason: string | null): Promise<PurchaseReturn> {
  const rt = runtime();
  const database = db();
  return mutate([database.purchases, database.purchase_returns, database.supplier_ledger, database.inventory_movements, database.stock_levels, database.number_blocks], async () => {
    const purchase = await database.purchases.get(purchaseId);
    if (!purchase) throw new Error('Purchase not found.');
    const date = today();
    const number = await allocateNumber('purchase_return', date);
    const returnId = uuidv7();
    const items: PurchaseReturnItem[] = [];
    const payloadItems: Array<Record<string, unknown>> = [];
    const updated = purchase.items.map((i) => ({ ...i }));
    for (const line of lines.filter((l) => l.quantity > 0)) {
      const item = updated.find((i) => i.id === line.purchase_item_id);
      if (!item) continue;
      const ordered = toScaled(item.quantity, QTY_SCALE);
      const qty = toScaled(line.quantity, QTY_SCALE);
      const taxable = ordered ? mulDivRound(toScaled(item.taxable, 2), qty, ordered) : 0;
      const total = ordered ? mulDivRound(toScaled(item.total, 2), qty, ordered) : 0;
      const movement = await recordMovement({
        store_id: purchase.store_id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        batch_id: item.batch_id,
        type: 'PURCHASE_RETURN',
        qty_out: line.quantity,
        unit_cost: item.unit_cost,
        reference_type: 'purchase_return',
        reference_id: returnId,
        reference_no: number.number,
      });
      const returnItem: PurchaseReturnItem = {
        id: uuidv7(),
        purchase_item_id: item.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        batch_id: item.batch_id,
        name: item.name,
        quantity: line.quantity,
        unit_cost: item.unit_cost,
        taxable: fromScaled(taxable, 2),
        tax_total: fromScaled(total - taxable, 2),
        total: fromScaled(total, 2),
      };
      items.push(returnItem);
      item.returned_qty = roundTo(item.returned_qty + line.quantity, 3);
      payloadItems.push({ id: returnItem.id, purchase_item_id: item.id, quantity: line.quantity, movement_id: movement.id });
    }
    if (items.length === 0) throw new Error('Enter quantities to return.');
    const total = roundTo(items.reduce((s, i) => s + i.total, 0));
    const taxable = roundTo(items.reduce((s, i) => s + i.taxable, 0));
    const record: PurchaseReturn = {
      ...newEntityBase(returnId),
      store_id: purchase.store_id,
      device_id: rt.deviceId,
      purchase_id: purchase.id,
      supplier_id: purchase.supplier_id,
      return_number: number.number,
      number_status: number.status,
      return_date: date,
      occurred_at: nowIso(),
      items,
      taxable_total: taxable,
      tax_total: roundTo(total - taxable),
      total,
      reason,
      created_by: rt.userId,
    };
    await database.purchase_returns.put({ ...record, _pending: 1 });
    await database.purchases.put({ ...purchase, items: updated, returned_total: roundTo(purchase.returned_total + total), _pending: 1 });
    const entry = supplierLedgerEntry({ supplier_id: purchase.supplier_id, type: 'purchase_return', debit: total, reference_type: 'purchase_return', reference_id: returnId, reference_no: number.number });
    await database.supplier_ledger.put(entry);
    await enqueue({
      operation: 'CREATE_PURCHASE_RETURN',
      entity_id: returnId,
      payload: {
        purchase_id: purchase.id,
        return_number: number.number,
        number_status: number.status,
        number_block_id: number.block_id,
        number_sequence: number.sequence,
        return_date: date,
        occurred_at: record.occurred_at,
        reason,
        items: payloadItems,
        ledger_id: entry.id,
      },
    });
    return record;
  });
}
