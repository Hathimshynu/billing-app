import { roundTo, sumDecimals, uuidv7, type CashRegister, type CashTransaction, type Expense, type ExpenseCategory, type ExpenseInput } from '@shopdesk/shared';
import { db } from '../db/business';
import { runtime } from '../runtime';
import { allocateNumber } from '../sync/numbers';
import { enqueue, mutate } from '../sync/outbox';
import { createEntity, deleteEntity, newEntityBase, nowIso, updateEntity } from './base';

export async function createExpense(input: ExpenseInput & { register_id?: string | null }, file?: File | null): Promise<Expense> {
  const rt = runtime();
  const database = db();
  return mutate([database.expenses, database.expense_categories, database.attachments, database.number_blocks], async () => {
    const category = input.category_id ? await database.expense_categories.get(input.category_id) : undefined;
    const number = await allocateNumber('expense', input.expense_date);
    const expense: Expense = {
      ...newEntityBase(),
      store_id: rt.storeId,
      device_id: rt.deviceId,
      register_id: input.register_id ?? null,
      category_id: input.category_id,
      category_name: category?.name ?? null,
      expense_number: number.number,
      amount: roundTo(input.amount),
      payment_method: input.payment_method,
      expense_date: input.expense_date,
      reference: input.reference,
      notes: input.notes,
      attachment_url: null,
      status: 'active',
      created_by: rt.userId,
    };
    await database.expenses.put({ ...expense, _pending: 1 });
    if (file) {
      // Kept in IndexedDB and uploaded by the sync engine once the expense reaches the server.
      await database.attachments.put({ id: uuidv7(), entity_type: 'expense', entity_id: expense.id, blob: file, filename: file.name, mime: file.type, uploaded: 0, created_at: nowIso() });
    }
    await enqueue({
      operation: 'CREATE_EXPENSE',
      entity_id: expense.id,
      payload: {
        store_id: rt.storeId,
        register_id: expense.register_id,
        category_id: expense.category_id,
        category_name: expense.category_name,
        expense_number: number.number,
        number_status: number.status,
        number_block_id: number.block_id,
        number_sequence: number.sequence,
        amount: expense.amount,
        payment_method: expense.payment_method,
        expense_date: expense.expense_date,
        reference: expense.reference,
        notes: expense.notes,
      },
    });
    return expense;
  });
}

export async function voidExpense(id: string): Promise<void> {
  const database = db();
  await mutate([database.expenses], async () => {
    const expense = await database.expenses.get(id);
    if (!expense || expense.status === 'void') return;
    await database.expenses.put({ ...expense, status: 'void', _pending: 1 });
    await enqueue({ operation: 'VOID_EXPENSE', entity_id: id, payload: {} });
  });
}

export const createExpenseCategory = (name: string) =>
  createEntity(db().expense_categories, 'CREATE_EXPENSE_CATEGORY', { ...newEntityBase(), name, active: true });
export const updateExpenseCategory = (id: string, patch: Partial<ExpenseCategory>) =>
  updateEntity<ExpenseCategory>(db().expense_categories, 'UPDATE_EXPENSE_CATEGORY', id, patch, ['name', 'active']);
export const deleteExpenseCategory = (id: string) => deleteEntity(db().expense_categories, 'DELETE_EXPENSE_CATEGORY', id);

/* -------------------------------- Cash register -------------------------------- */

export async function currentRegister(): Promise<CashRegister | undefined> {
  const rt = runtime();
  return db().cash_registers.where('device_id').equals(rt.deviceId).filter((r) => r.status === 'open').first();
}

export async function openRegister(openingCash: number, notes: string | null): Promise<CashRegister> {
  const rt = runtime();
  const database = db();
  return mutate([database.cash_registers], async () => {
    const existing = await database.cash_registers.where('device_id').equals(rt.deviceId).filter((r) => r.status === 'open').first();
    if (existing) return existing;
    const register: CashRegister = {
      ...newEntityBase(),
      store_id: rt.storeId,
      device_id: rt.deviceId,
      status: 'open',
      opened_by: rt.userId,
      opened_at: nowIso(),
      opening_cash: roundTo(openingCash),
      closed_by: null,
      closed_at: null,
      cash_sales: 0,
      cash_refunds: 0,
      cash_in: 0,
      cash_out: 0,
      cash_expenses: 0,
      expected_cash: null,
      closing_cash: null,
      difference: null,
      denominations: null,
      notes,
    };
    await database.cash_registers.put({ ...register, _pending: 1 });
    await enqueue({ operation: 'OPEN_CASH_REGISTER', entity_id: register.id, payload: { store_id: rt.storeId, opening_cash: register.opening_cash, opened_at: register.opened_at, notes } });
    return register;
  });
}

export async function cashMovement(registerId: string, type: 'cash_in' | 'cash_out', amount: number, reason: string | null): Promise<CashTransaction> {
  const rt = runtime();
  const database = db();
  const transaction: CashTransaction = {
    ...newEntityBase(),
    register_id: registerId,
    store_id: rt.storeId,
    type,
    amount: roundTo(amount),
    reason,
    occurred_at: nowIso(),
    created_by: rt.userId,
  };
  await mutate([database.cash_transactions], async () => {
    await database.cash_transactions.put({ ...transaction, _pending: 1 });
    await enqueue({ operation: 'CREATE_CASH_TRANSACTION', entity_id: transaction.id, payload: { register_id: registerId, type, amount: transaction.amount, reason, occurred_at: transaction.occurred_at } });
  });
  return transaction;
}

export interface RegisterTotals {
  opening_cash: number;
  cash_sales: number;
  cash_refunds: number;
  cash_in: number;
  cash_out: number;
  cash_expenses: number;
  expected_cash: number;
}

/** Same formula as the server (FinanceService::registerTotals). */
export async function registerTotals(register: CashRegister): Promise<RegisterTotals> {
  const database = db();
  const sales = await database.sales.where('register_id').equals(register.id).filter((s) => s.doc_type === 'invoice' && s.status === 'completed').toArray();
  const cashSales = sumDecimals(sales.flatMap((s) => s.payments.filter((p) => p.method === 'cash').map((p) => p.amount)));
  const refunds = sumDecimals((await database.sale_returns.where('register_id').equals(register.id).toArray()).filter((r) => r.refund_method === 'cash').map((r) => r.total));
  const collections = sumDecimals((await database.customer_payments.where('register_id').equals(register.id).toArray()).filter((p) => p.method === 'cash').map((p) => p.amount));
  const supplierCash = sumDecimals((await database.supplier_payments.where('register_id').equals(register.id).toArray()).filter((p) => p.method === 'cash').map((p) => p.amount));
  const txns = await database.cash_transactions.where('register_id').equals(register.id).toArray();
  const cashIn = roundTo(sumDecimals(txns.filter((t) => t.type === 'cash_in').map((t) => t.amount)) + collections);
  const cashOut = roundTo(sumDecimals(txns.filter((t) => t.type === 'cash_out').map((t) => t.amount)) + supplierCash);
  const expenses = sumDecimals((await database.expenses.where('register_id').equals(register.id).toArray()).filter((e) => e.payment_method === 'cash' && e.status === 'active').map((e) => e.amount));
  return {
    opening_cash: register.opening_cash,
    cash_sales: cashSales,
    cash_refunds: refunds,
    cash_in: cashIn,
    cash_out: cashOut,
    cash_expenses: expenses,
    expected_cash: roundTo(register.opening_cash + cashSales - refunds + cashIn - cashOut - expenses),
  };
}

export async function closeRegister(registerId: string, closingCash: number, denominations: Record<string, number> | null, notes: string | null): Promise<CashRegister> {
  const rt = runtime();
  const database = db();
  const register = await database.cash_registers.get(registerId);
  if (!register || register.status === 'closed') throw new Error('Register is not open.');
  const totals = await registerTotals(register);
  const closed: CashRegister = {
    ...register,
    ...totals,
    status: 'closed',
    closed_by: rt.userId,
    closed_at: nowIso(),
    closing_cash: roundTo(closingCash),
    difference: roundTo(closingCash - totals.expected_cash),
    denominations,
    notes: notes ?? register.notes,
  };
  await mutate([database.cash_registers], async () => {
    await database.cash_registers.put({ ...closed, _pending: 1 });
    await enqueue({ operation: 'CLOSE_CASH_REGISTER', entity_id: registerId, payload: { closing_cash: closed.closing_cash, closed_at: closed.closed_at, denominations, notes, expected_cash: totals.expected_cash } });
  });
  return closed;
}
