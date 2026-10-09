import {
  addQty,
  businessDate,
  roundTo,
  sumDecimals,
  uuidv7,
  type Customer,
  type CustomerInput,
  type CustomerLedgerEntry,
  type CustomerPayment,
  type PaymentEntryInput,
  type Supplier,
  type SupplierInput,
  type SupplierLedgerEntry,
  type SupplierPayment,
} from '@shopdesk/shared';
import { db } from '../db/business';
import { deriveCustomer } from '../db/derive';
import { runtime } from '../runtime';
import { allocateNumber } from '../sync/numbers';
import { diffEntity, enqueue, mutate } from '../sync/outbox';
import { deleteEntity, newEntityBase, nowIso, toPayload, updateEntity } from './base';

export const CUSTOMER_FIELDS = ['name', 'phone', 'email', 'address', 'city', 'state_code', 'pincode', 'gstin', 'credit_limit', 'opening_balance', 'tier', 'notes', 'date_of_birth', 'active'] as const;
export const SUPPLIER_FIELDS = ['name', 'phone', 'email', 'address', 'city', 'state_code', 'gstin', 'opening_balance', 'credit_days', 'notes', 'active'] as const;

function customerLedgerEntry(partial: Partial<CustomerLedgerEntry> & Pick<CustomerLedgerEntry, 'customer_id' | 'type'>): CustomerLedgerEntry {
  const rt = runtime();
  return {
    id: uuidv7(),
    business_id: rt.businessId,
    reference_type: null,
    reference_id: null,
    reference_no: null,
    debit: 0,
    credit: 0,
    points: 0,
    notes: null,
    occurred_at: nowIso(),
    created_by: rt.userId,
    ...partial,
  };
}

function supplierLedgerEntry(partial: Partial<SupplierLedgerEntry> & Pick<SupplierLedgerEntry, 'supplier_id' | 'type'>): SupplierLedgerEntry {
  const rt = runtime();
  return {
    id: uuidv7(),
    business_id: rt.businessId,
    reference_type: null,
    reference_id: null,
    reference_no: null,
    debit: 0,
    credit: 0,
    notes: null,
    occurred_at: nowIso(),
    created_by: rt.userId,
    ...partial,
  };
}

export { customerLedgerEntry, supplierLedgerEntry };

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const customer = deriveCustomer({ ...newEntityBase(), ...input } as Customer);
  await mutate([db().customers, db().customer_ledger], async () => {
    await db().customers.put({ ...customer, _pending: 1 });
    let openingEntryId: string | null = null;
    if (input.opening_balance) {
      const entry = customerLedgerEntry({
        customer_id: customer.id,
        type: 'opening_balance',
        debit: input.opening_balance > 0 ? input.opening_balance : 0,
        credit: input.opening_balance < 0 ? -input.opening_balance : 0,
        notes: 'Opening balance',
      });
      openingEntryId = entry.id;
      await db().customer_ledger.put(entry);
    }
    await enqueue({ operation: 'CREATE_CUSTOMER', entity_id: customer.id, payload: { ...toPayload(input as Record<string, unknown>), opening_entry_id: openingEntryId } });
  });
  return customer;
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>): Promise<void> {
  await mutate([db().customers, db().customer_ledger], async () => {
    const current = await db().customers.get(id);
    if (!current) throw new Error('Customer not found');
    const { changes, base } = diffEntity(current as unknown as Record<string, unknown>, input as Record<string, unknown>, CUSTOMER_FIELDS);
    if (Object.keys(changes).length === 0) return;
    await db().customers.put({ ...deriveCustomer({ ...current, ...changes } as Customer), updated_at: nowIso(), _pending: 1 });
    if ('opening_balance' in changes) {
      const amount = Number(changes.opening_balance) || 0;
      const existing = await db().customer_ledger.where('customer_id').equals(id).filter((e) => e.type === 'opening_balance').first();
      if (existing) {
        await db().customer_ledger.put({ ...existing, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0 });
      } else if (amount !== 0) {
        await db().customer_ledger.put(customerLedgerEntry({ customer_id: id, type: 'opening_balance', debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, notes: 'Opening balance' }));
      }
    }
    await enqueue({ operation: 'UPDATE_CUSTOMER', entity_id: id, payload: { changes, base }, base_version: current.version });
  });
}

export const deleteCustomer = (id: string) => deleteEntity(db().customers, 'DELETE_CUSTOMER', id);

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const supplier = { ...newEntityBase(), ...input } as Supplier;
  await mutate([db().suppliers, db().supplier_ledger], async () => {
    await db().suppliers.put({ ...supplier, _pending: 1 });
    let openingEntryId: string | null = null;
    if (input.opening_balance) {
      const entry = supplierLedgerEntry({
        supplier_id: supplier.id,
        type: 'opening_balance',
        credit: input.opening_balance > 0 ? input.opening_balance : 0,
        debit: input.opening_balance < 0 ? -input.opening_balance : 0,
        notes: 'Opening balance',
      });
      openingEntryId = entry.id;
      await db().supplier_ledger.put(entry);
    }
    await enqueue({ operation: 'CREATE_SUPPLIER', entity_id: supplier.id, payload: { ...toPayload(input as Record<string, unknown>), opening_entry_id: openingEntryId } });
  });
  return supplier;
}

export const updateSupplier = (id: string, input: Partial<SupplierInput>) =>
  updateEntity<Supplier>(db().suppliers, 'UPDATE_SUPPLIER', id, input as Partial<Supplier>, SUPPLIER_FIELDS);
export const deleteSupplier = (id: string) => deleteEntity(db().suppliers, 'DELETE_SUPPLIER', id);

/** Receivable = Σ debit − Σ credit (positive: customer owes the shop). */
export function ledgerBalance(entries: Array<Pick<CustomerLedgerEntry, 'debit' | 'credit'>>): number {
  return roundTo(sumDecimals(entries.map((e) => e.debit)) - sumDecimals(entries.map((e) => e.credit)));
}

/** Payable = Σ credit − Σ debit (positive: the shop owes the supplier). */
export function supplierBalance(entries: Array<Pick<SupplierLedgerEntry, 'debit' | 'credit'>>): number {
  return roundTo(sumDecimals(entries.map((e) => e.credit)) - sumDecimals(entries.map((e) => e.debit)));
}

export async function customerBalance(customerId: string): Promise<number> {
  return ledgerBalance(await db().customer_ledger.where('customer_id').equals(customerId).toArray());
}

export async function loyaltyPoints(customerId: string): Promise<number> {
  const entries = await db().customer_ledger.where('customer_id').equals(customerId).toArray();
  return entries.reduce((sum, e) => sum + (e.points || 0), 0);
}

/** Collect a payment from a customer (optionally against one invoice). */
export async function receiveCustomerPayment(customerId: string, input: PaymentEntryInput & { sale_id?: string | null; register_id?: string | null }): Promise<CustomerPayment> {
  const rt = runtime();
  const database = db();
  return mutate([database.customer_payments, database.customer_ledger, database.sales, database.number_blocks], async () => {
    const number = await allocateNumber('customer_payment', input.payment_date);
    const payment: CustomerPayment = {
      ...newEntityBase(),
      store_id: rt.storeId,
      device_id: rt.deviceId,
      register_id: input.register_id ?? null,
      customer_id: customerId,
      sale_id: input.sale_id ?? null,
      receipt_number: number.number,
      amount: input.amount,
      method: input.method,
      reference: input.reference,
      payment_date: input.payment_date,
      notes: input.notes,
      created_by: rt.userId,
    };
    await database.customer_payments.put(payment);
    const entry = customerLedgerEntry({ customer_id: customerId, type: 'payment', credit: input.amount, reference_type: 'customer_payment', reference_id: payment.id, reference_no: payment.receipt_number });
    await database.customer_ledger.put(entry);
    if (input.sale_id) {
      const sale = await database.sales.get(input.sale_id);
      if (sale) {
        const paid = Math.min(addQty(sale.paid_total, input.amount), sale.grand_total);
        const balance = roundTo(Math.max(sale.grand_total - paid, 0));
        await database.sales.put({ ...sale, paid_total: roundTo(paid), balance_due: balance, payment_status: balance <= 0 ? 'paid' : 'partial', _pending: 1 });
      }
    }
    await enqueue({
      operation: 'CREATE_CUSTOMER_PAYMENT',
      entity_id: payment.id,
      payload: {
        ...toPayload(payment as unknown as Record<string, unknown>),
        number_status: number.status,
        number_block_id: number.block_id,
        number_sequence: number.sequence,
        ledger_id: entry.id,
      },
    });
    return payment;
  });
}

export async function paySupplier(supplierId: string, input: PaymentEntryInput & { purchase_id?: string | null; register_id?: string | null }): Promise<SupplierPayment> {
  const rt = runtime();
  const database = db();
  return mutate([database.supplier_payments, database.supplier_ledger, database.purchases, database.number_blocks], async () => {
    const number = await allocateNumber('supplier_payment', input.payment_date);
    const payment: SupplierPayment = {
      ...newEntityBase(),
      store_id: rt.storeId,
      device_id: rt.deviceId,
      register_id: input.register_id ?? null,
      supplier_id: supplierId,
      purchase_id: input.purchase_id ?? null,
      payment_number: number.number,
      amount: input.amount,
      method: input.method,
      reference: input.reference,
      payment_date: input.payment_date,
      notes: input.notes,
      created_by: rt.userId,
    };
    await database.supplier_payments.put(payment);
    const entry = supplierLedgerEntry({ supplier_id: supplierId, type: 'payment', debit: input.amount, reference_type: 'supplier_payment', reference_id: payment.id, reference_no: payment.payment_number });
    await database.supplier_ledger.put(entry);
    if (input.purchase_id) {
      const purchase = await database.purchases.get(input.purchase_id);
      if (purchase) {
        const paid = Math.min(addQty(purchase.paid_total, input.amount), purchase.grand_total);
        const balance = roundTo(Math.max(purchase.grand_total - paid, 0));
        await database.purchases.put({ ...purchase, paid_total: roundTo(paid), balance_due: balance, payment_status: balance <= 0 ? 'paid' : 'partial', _pending: 1 });
      }
    }
    await enqueue({
      operation: 'CREATE_SUPPLIER_PAYMENT',
      entity_id: payment.id,
      payload: {
        ...toPayload(payment as unknown as Record<string, unknown>),
        number_status: number.status,
        number_block_id: number.block_id,
        number_sequence: number.sequence,
        ledger_id: entry.id,
      },
    });
    return payment;
  });
}

export function today(): string {
  return businessDate(new Date(), runtime().timezone);
}
