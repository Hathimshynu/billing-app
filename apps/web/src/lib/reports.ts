import { addDays, roundTo, sumDecimals, type Expense, type PaymentMethod, type Purchase, type SaleReturn } from '@shopdesk/shared';
import { db, type LocalSale } from './db/business';
import { ledgerBalance, supplierBalance } from './repos/parties';

/**
 * Reports computed on this device from IndexedDB, so they work offline. They include every record
 * this device has (its own sales plus everything pulled from the server for its store).
 */

export interface DateRange {
  from: string;
  to: string;
}

const isRevenue = (s: LocalSale) => s.doc_type === 'invoice' && s.status === 'completed' && !s.deleted_at;

export async function salesInRange({ from, to }: DateRange): Promise<LocalSale[]> {
  return db().sales.where('invoice_date').between(from, to, true, true).filter(isRevenue).toArray();
}

export async function returnsInRange({ from, to }: DateRange): Promise<SaleReturn[]> {
  return db().sale_returns.where('return_date').between(from, to, true, true).toArray();
}

export interface SalesSummary {
  count: number;
  gross: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
  returns: number;
  net: number;
  paid: number;
  due: number;
  average: number;
  items: number;
}

export function summarize(sales: LocalSale[], returns: SaleReturn[] = []): SalesSummary {
  const total = sumDecimals(sales.map((s) => s.grand_total));
  const returned = sumDecimals(returns.map((r) => r.total));
  return {
    count: sales.length,
    gross: sumDecimals(sales.map((s) => s.gross_total)),
    discount: sumDecimals(sales.map((s) => s.discount_total)),
    taxable: sumDecimals(sales.map((s) => s.taxable_total)),
    tax: sumDecimals(sales.map((s) => s.tax_total)),
    total,
    returns: returned,
    net: roundTo(total - returned),
    paid: sumDecimals(sales.map((s) => s.paid_total)),
    due: sumDecimals(sales.map((s) => s.balance_due)),
    average: sales.length ? roundTo(total / sales.length) : 0,
    items: roundTo(sales.reduce((s, sale) => s + sale.items.reduce((q, i) => q + i.quantity, 0), 0), 3),
  };
}

export function dailySeries(sales: LocalSale[], { from, to }: DateRange): Array<{ date: string; total: number; count: number }> {
  const byDay = new Map<string, { total: number; count: number }>();
  for (const s of sales) {
    const row = byDay.get(s.invoice_date) ?? { total: 0, count: 0 };
    row.total = roundTo(row.total + s.grand_total);
    row.count += 1;
    byDay.set(s.invoice_date, row);
  }
  const out: Array<{ date: string; total: number; count: number }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, ...(byDay.get(d) ?? { total: 0, count: 0 }) });
  return out;
}

export function hourlySeries(sales: LocalSale[], timeZone: string): Array<{ hour: number; total: number; count: number }> {
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone });
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, count: 0 }));
  for (const s of sales) {
    const hour = Number(fmt.format(new Date(s.occurred_at))) % 24;
    rows[hour]!.total = roundTo(rows[hour]!.total + s.grand_total);
    rows[hour]!.count += 1;
  }
  return rows;
}

export interface ProductRow {
  key: string;
  product_id: string | null;
  name: string;
  quantity: number;
  taxable: number;
  total: number;
  cost: number;
  profit: number;
  margin: number;
}

export function byProduct(sales: LocalSale[]): ProductRow[] {
  const map = new Map<string, ProductRow>();
  for (const s of sales) {
    for (const i of s.items) {
      const key = `${i.product_id ?? i.name}|${i.variant_id ?? ''}`;
      const qty = roundTo(i.quantity - i.returned_qty, 3);
      const share = i.quantity ? qty / i.quantity : 0;
      const row = map.get(key) ?? { key, product_id: i.product_id, name: i.name, quantity: 0, taxable: 0, total: 0, cost: 0, profit: 0, margin: 0 };
      row.quantity = roundTo(row.quantity + qty, 3);
      row.taxable = roundTo(row.taxable + i.taxable * share);
      row.total = roundTo(row.total + i.total * share);
      row.cost = roundTo(row.cost + i.cost_price * qty);
      map.set(key, row);
    }
  }
  return [...map.values()].map((r) => ({ ...r, profit: roundTo(r.taxable - r.cost), margin: r.taxable ? roundTo(((r.taxable - r.cost) / r.taxable) * 100, 1) : 0 }));
}

export async function byCategory(sales: LocalSale[]): Promise<Array<{ key: string; name: string; quantity: number; total: number; profit: number }>> {
  const [products, categories] = await Promise.all([db().products.toArray(), db().categories.toArray()]);
  const productCategory = new Map(products.map((p) => [p.id, p.category_id]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const map = new Map<string, { key: string; name: string; quantity: number; total: number; profit: number }>();
  for (const row of byProduct(sales)) {
    const categoryId = (row.product_id && productCategory.get(row.product_id)) || 'none';
    const entry = map.get(categoryId) ?? { key: categoryId, name: categoryName.get(categoryId) ?? 'Uncategorised', quantity: 0, total: 0, profit: 0 };
    entry.quantity = roundTo(entry.quantity + row.quantity, 3);
    entry.total = roundTo(entry.total + row.total);
    entry.profit = roundTo(entry.profit + row.profit);
    map.set(categoryId, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function byCustomer(sales: LocalSale[]): Array<{ key: string; name: string; phone: string | null; count: number; total: number; due: number }> {
  const map = new Map<string, { key: string; name: string; phone: string | null; count: number; total: number; due: number }>();
  for (const s of sales) {
    const key = s.customer_id ?? 'walk-in';
    const row = map.get(key) ?? { key, name: s.customer_name ?? 'Walk-in customers', phone: s.customer_phone, count: 0, total: 0, due: 0 };
    row.count += 1;
    row.total = roundTo(row.total + s.grand_total);
    row.due = roundTo(row.due + s.balance_due);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function byCashier(sales: LocalSale[]): Array<{ key: string; name: string; count: number; total: number; cash: number }> {
  const map = new Map<string, { key: string; name: string; count: number; total: number; cash: number }>();
  for (const s of sales) {
    const key = s.created_by ?? 'unknown';
    const row = map.get(key) ?? { key, name: s.created_by_name ?? 'Unknown', count: 0, total: 0, cash: 0 };
    row.count += 1;
    row.total = roundTo(row.total + s.grand_total);
    row.cash = roundTo(row.cash + s.payments.filter((p) => p.method === 'cash').reduce((sum, p) => sum + p.amount, 0));
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function byPaymentMethod(sales: LocalSale[]): Array<{ method: PaymentMethod; count: number; amount: number }> {
  const map = new Map<PaymentMethod, { method: PaymentMethod; count: number; amount: number }>();
  for (const s of sales) {
    for (const p of s.payments) {
      const row = map.get(p.method) ?? { method: p.method, count: 0, amount: 0 };
      row.count += 1;
      row.amount = roundTo(row.amount + p.amount);
      map.set(p.method, row);
    }
    if (s.balance_due > 0 && !s.payments.some((p) => p.method === 'credit')) {
      const row = map.get('credit') ?? { method: 'credit' as const, count: 0, amount: 0 };
      row.count += 1;
      row.amount = roundTo(row.amount + s.balance_due);
      map.set('credit', row);
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export interface TaxRow {
  key: string;
  hsn: string;
  rate: number;
  quantity: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  other: number;
  total_tax: number;
}

/** HSN-wise tax summary (GSTR-1 table 12 style), net of returns. */
export function hsnSummary(sales: LocalSale[], returns: SaleReturn[] = []): TaxRow[] {
  const map = new Map<string, TaxRow>();
  const add = (hsn: string, rate: number, qty: number, taxable: number, taxes: Array<{ code: string; amount: number }>, sign: 1 | -1) => {
    const key = `${hsn}|${rate}`;
    const row = map.get(key) ?? { key, hsn, rate, quantity: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, other: 0, total_tax: 0 };
    row.quantity = roundTo(row.quantity + sign * qty, 3);
    row.taxable = roundTo(row.taxable + sign * taxable);
    for (const t of taxes) {
      const amount = sign * t.amount;
      if (t.code === 'CGST') row.cgst = roundTo(row.cgst + amount);
      else if (t.code === 'SGST' || t.code === 'UTGST') row.sgst = roundTo(row.sgst + amount);
      else if (t.code === 'IGST') row.igst = roundTo(row.igst + amount);
      else if (t.code === 'CESS') row.cess = roundTo(row.cess + amount);
      else row.other = roundTo(row.other + amount);
      row.total_tax = roundTo(row.total_tax + amount);
    }
    map.set(key, row);
  };
  const itemIndex = new Map<string, { hsn: string; rate: number; taxes: Array<{ code: string; amount: number }>; tax_total: number }>();
  for (const s of sales) {
    for (const i of s.items) {
      const rate = i.taxes.filter((t) => t.code !== 'CESS').reduce((sum, t) => sum + t.rate, 0);
      itemIndex.set(i.id, { hsn: i.hsn_code ?? '—', rate, taxes: i.taxes, tax_total: i.tax_total });
      add(i.hsn_code ?? '—', rate, i.quantity, i.taxable, i.taxes, 1);
    }
  }
  for (const r of returns) {
    for (const ri of r.items) {
      const source = itemIndex.get(ri.sale_item_id);
      if (!source) continue;
      // Split the returned tax across components in the same proportion as the original line.
      const taxes = source.taxes.map((t) => ({ code: t.code, amount: source.tax_total ? roundTo((t.amount / source.tax_total) * ri.tax_total) : 0 }));
      add(source.hsn, source.rate, ri.quantity, ri.taxable, taxes, -1);
    }
  }
  return [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
}

export async function expensesInRange({ from, to }: DateRange): Promise<Expense[]> {
  return db().expenses.where('expense_date').between(from, to, true, true).filter((e) => e.status === 'active' && !e.deleted_at).toArray();
}

export async function purchasesInRange({ from, to }: DateRange): Promise<Purchase[]> {
  return db().purchases.where('purchase_date').between(from, to, true, true).filter((p) => p.doc_type === 'invoice' && p.status !== 'cancelled' && !p.deleted_at).toArray();
}

export interface ProfitLoss {
  revenue: number;
  returns: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  expenseByCategory: Array<{ name: string; amount: number }>;
}

/** Profit & loss on taxable values (taxes collected are not income). COGS uses the cost at time of sale. */
export async function profitAndLoss(range: DateRange): Promise<ProfitLoss> {
  const [sales, returns, expenses] = await Promise.all([salesInRange(range), returnsInRange(range), expensesInRange(range)]);
  const revenue = sumDecimals(sales.map((s) => roundTo(s.taxable_total + s.charges_total - s.charges.reduce((t, c) => t + (c.tax_total ?? 0), 0))));
  const returned = sumDecimals(returns.map((r) => r.taxable_total));
  const saleItems = new Map(sales.flatMap((s) => s.items.map((i) => [i.id, i] as const)));
  const soldCost = sumDecimals(sales.flatMap((s) => s.items.map((i) => roundTo(i.cost_price * i.quantity))));
  const returnedCost = sumDecimals(returns.flatMap((r) => r.items.filter((ri) => ri.restock).map((ri) => roundTo((saleItems.get(ri.sale_item_id)?.cost_price ?? 0) * ri.quantity))));
  const cogs = roundTo(soldCost - returnedCost);
  const netRevenue = roundTo(revenue - returned);
  const expenseTotal = sumDecimals(expenses.map((e) => e.amount));
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.category_name ?? 'Other', roundTo((byCat.get(e.category_name ?? 'Other') ?? 0) + e.amount));
  return {
    revenue,
    returns: returned,
    netRevenue,
    cogs,
    grossProfit: roundTo(netRevenue - cogs),
    expenses: expenseTotal,
    netProfit: roundTo(netRevenue - cogs - expenseTotal),
    expenseByCategory: [...byCat.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}

export interface StockRow {
  product_id: string;
  name: string;
  sku: string | null;
  category: string;
  quantity: number;
  unit_cost: number;
  value: number;
  retail_value: number;
  reorder_level: number;
}

/** Stock valuation for a store at purchase cost and at selling price. */
export async function stockValuation(storeId: string): Promise<StockRow[]> {
  const [levels, products, categories] = await Promise.all([db().stock_levels.where('store_id').equals(storeId).toArray(), db().products.toArray(), db().categories.toArray()]);
  const qty = new Map<string, number>();
  for (const l of levels) qty.set(l.product_id, roundTo((qty.get(l.product_id) ?? 0) + l.qty, 3));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  return products
    .filter((p) => p.track_inventory && p.product_type !== 'service' && !p.deleted_at)
    .map((p) => {
      const quantity = qty.get(p.id) ?? 0;
      return {
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        category: (p.category_id && categoryName.get(p.category_id)) || '—',
        quantity,
        unit_cost: p.purchase_price,
        value: roundTo(Math.max(quantity, 0) * p.purchase_price),
        retail_value: roundTo(Math.max(quantity, 0) * p.selling_price),
        reorder_level: p.reorder_level,
      };
    })
    .sort((a, b) => b.value - a.value);
}

export async function customerDues(): Promise<Array<{ id: string; name: string; phone: string | null; balance: number; credit_limit: number; last_activity: string | null }>> {
  const [customers, entries] = await Promise.all([db().customers.filter((c) => !c.deleted_at).toArray(), db().customer_ledger.toArray()]);
  const grouped = new Map<string, typeof entries>();
  for (const e of entries) grouped.set(e.customer_id, [...(grouped.get(e.customer_id) ?? []), e]);
  return customers
    .map((c) => {
      const list = grouped.get(c.id) ?? [];
      return { id: c.id, name: c.name, phone: c.phone, balance: ledgerBalance(list), credit_limit: c.credit_limit, last_activity: list.map((e) => e.occurred_at).sort().at(-1) ?? null };
    })
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}

export async function supplierDues(): Promise<Array<{ id: string; name: string; phone: string | null; balance: number }>> {
  const [suppliers, entries] = await Promise.all([db().suppliers.filter((s) => !s.deleted_at).toArray(), db().supplier_ledger.toArray()]);
  const grouped = new Map<string, typeof entries>();
  for (const e of entries) grouped.set(e.supplier_id, [...(grouped.get(e.supplier_id) ?? []), e]);
  return suppliers
    .map((s) => ({ id: s.id, name: s.name, phone: s.phone, balance: supplierBalance(grouped.get(s.id) ?? []) }))
    .filter((s) => s.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}
