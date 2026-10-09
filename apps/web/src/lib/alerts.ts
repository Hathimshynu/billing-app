import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, businessDate, expiryStatus } from '@shopdesk/shared';
import { db, hasDb } from './db/business';
import { maybeRuntime } from './runtime';
import { getSetting } from './settings';
import { ledgerBalance, supplierBalance } from './repos/parties';

export interface Alert {
  id: string;
  kind: 'low_stock' | 'out_of_stock' | 'expired' | 'near_expiry' | 'customer_due' | 'supplier_due' | 'sync_failed' | 'conflict' | 'server';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link: string;
}

/**
 * Alerts computed on the device from local data (work offline) plus notifications produced by the
 * server (register mismatch, credit limit exceeded offline, IMEI sold twice...).
 */
export async function computeAlerts(): Promise<Alert[]> {
  const rt = maybeRuntime();
  if (!rt || !hasDb()) return [];
  const database = db();
  const settings = await getSetting('notifications');
  const today = businessDate(new Date(), rt.timezone);
  const alerts: Alert[] = [];

  if (settings.low_stock) {
    const products = await database.products.filter((p) => p.active && !p.deleted_at && p.track_inventory && p.product_type !== 'service').toArray();
    const levels = await database.stock_levels.where('store_id').equals(rt.storeId).toArray();
    const stockByProduct = new Map<string, number>();
    for (const l of levels) stockByProduct.set(l.product_id, (stockByProduct.get(l.product_id) ?? 0) + l.qty);
    for (const p of products) {
      const qty = stockByProduct.get(p.id) ?? 0;
      if (qty <= 0) alerts.push({ id: `oos-${p.id}`, kind: 'out_of_stock', severity: 'critical', title: p.name, body: 'Out of stock', link: `/inventory?product=${p.id}` });
      else if (p.reorder_level > 0 && qty <= p.reorder_level) alerts.push({ id: `low-${p.id}`, kind: 'low_stock', severity: 'warning', title: p.name, body: `Low stock: ${qty} left (reorder at ${p.reorder_level})`, link: `/inventory?product=${p.id}` });
    }
  }

  if (settings.expiry) {
    const horizon = addDays(today, settings.near_expiry_days || 90);
    const batches = await database.product_batches.where('expiry_date').belowOrEqual(horizon).toArray();
    for (const b of batches) {
      const levels = await database.stock_levels.where('batch_id').equals(b.id).toArray();
      const qty = levels.filter((l) => l.store_id === rt.storeId).reduce((s, l) => s + l.qty, 0);
      if (qty <= 0) continue;
      const product = await database.products.get(b.product_id);
      const status = expiryStatus(b.expiry_date, today, settings.near_expiry_days);
      if (status === 'expired') alerts.push({ id: `exp-${b.id}`, kind: 'expired', severity: 'critical', title: product?.name ?? 'Batch', body: `Batch ${b.batch_no} expired on ${b.expiry_date} (${qty} in stock)`, link: '/inventory/expiry' });
      else if (status === 'near_expiry') alerts.push({ id: `nexp-${b.id}`, kind: 'near_expiry', severity: 'warning', title: product?.name ?? 'Batch', body: `Batch ${b.batch_no} expires on ${b.expiry_date} (${qty} in stock)`, link: '/inventory/expiry' });
    }
  }

  if (settings.customer_dues) {
    const entries = await database.customer_ledger.toArray();
    const byCustomer = new Map<string, typeof entries>();
    for (const e of entries) byCustomer.set(e.customer_id, [...(byCustomer.get(e.customer_id) ?? []), e]);
    for (const [customerId, list] of byCustomer) {
      const balance = ledgerBalance(list);
      if (balance <= 0) continue;
      const customer = await database.customers.get(customerId);
      if (customer && customer.credit_limit > 0 && balance > customer.credit_limit) {
        alerts.push({ id: `due-${customerId}`, kind: 'customer_due', severity: 'warning', title: customer.name, body: `Outstanding ${balance.toFixed(2)} exceeds credit limit ${customer.credit_limit.toFixed(2)}`, link: `/customers/${customerId}` });
      }
    }
  }

  if (settings.supplier_dues) {
    const suppliers = await database.suppliers.toArray();
    for (const s of suppliers) {
      if (!s.credit_days) continue;
      const purchases = await database.purchases.where('supplier_id').equals(s.id).filter((p) => p.balance_due > 0 && p.status !== 'cancelled').toArray();
      const overdue = purchases.filter((p) => addDays(p.purchase_date, s.credit_days) < today);
      if (overdue.length) {
        const ledger = await database.supplier_ledger.where('supplier_id').equals(s.id).toArray();
        alerts.push({ id: `sdue-${s.id}`, kind: 'supplier_due', severity: 'warning', title: s.name, body: `${overdue.length} purchase(s) past ${s.credit_days} day credit · payable ${supplierBalance(ledger).toFixed(2)}`, link: `/suppliers/${s.id}` });
      }
    }
  }

  if (settings.sync_failed) {
    const failed = await database.sync_queue.where('status').equals('failed').count();
    if (failed) alerts.push({ id: 'sync-failed', kind: 'sync_failed', severity: 'critical', title: 'Sync failed', body: `${failed} change(s) could not be synced`, link: '/sync' });
    const conflicts = await database.sync_conflicts.where('status').equals('open').count();
    if (conflicts) alerts.push({ id: 'sync-conflicts', kind: 'conflict', severity: 'warning', title: 'Sync conflicts', body: `${conflicts} conflict(s) need review`, link: '/sync/conflicts' });
  }

  const server = await database.notifications.orderBy('created_at').reverse().limit(30).toArray();
  for (const n of server) {
    if (n.read_at) continue;
    alerts.push({ id: `srv-${n.id}`, kind: 'server', severity: n.severity, title: n.title, body: n.body ?? '', link: n.entity_type === 'sale' && n.entity_id ? `/sales/${n.entity_id}` : '/sync' });
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function useAlerts(): Alert[] | undefined {
  return useLiveQuery(() => computeAlerts(), []);
}
