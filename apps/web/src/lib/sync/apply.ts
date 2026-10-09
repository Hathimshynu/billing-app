import { addQty, roundQty, stockKey, type SyncChange, type SyncEntityType, type StockLevel } from '@shopdesk/shared';
import type { BusinessDb } from '../db/business';
import { ENTITY_TABLES } from '../db/business';
import { deriveCustomer, deriveMovement, deriveProduct, deriveSale } from '../db/derive';

const MASTER_ENTITIES = new Set<SyncEntityType>([
  'category',
  'brand',
  'unit',
  'tax_rate',
  'product',
  'product_batch',
  'customer',
  'supplier',
  'expense_category',
  'restaurant_table',
  'jewellery_order',
  'coupon',
  'setting',
]);

/**
 * Local stock = last quantity confirmed by the server + local movements not yet confirmed.
 * This is what makes offline sales from several devices converge: the server sums movements,
 * the device never overwrites its own unsynced movements with a stale server figure.
 */
export async function recalcStock(database: BusinessDb, keys: Iterable<string>): Promise<void> {
  for (const key of new Set(keys)) {
    const level = await database.stock_levels.get(key);
    if (!level) continue;
    const pending = await database.inventory_movements
      .where('stock_key')
      .equals(key)
      .filter((m) => m.synced !== 1)
      .toArray();
    const delta = pending.reduce((sum, m) => addQty(sum, m.qty_in, -m.qty_out), 0);
    const qty = roundQty(addQty(level.server_qty, delta));
    if (qty !== level.qty) await database.stock_levels.put({ ...level, qty });
  }
}

/** Re-apply local edits that the server has not acknowledged yet on top of a server snapshot. */
async function overlayPending(database: BusinessDb, entityType: SyncEntityType, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!MASTER_ENTITIES.has(entityType)) return data;
  const id = String(data.id);
  const pending = await database.sync_queue
    .where('entity_id')
    .equals(id)
    .filter((op) => op.status === 'pending' || op.status === 'syncing')
    .sortBy('id');
  if (pending.length === 0) return data;
  let merged: Record<string, unknown> = { ...data, _pending: 1 };
  for (const op of pending) {
    if (op.operation.startsWith('UPDATE_')) {
      merged = { ...merged, ...((op.payload.changes as Record<string, unknown>) ?? {}) };
    } else if (op.operation.startsWith('DELETE_')) {
      merged = { ...merged, deleted_at: op.created_at };
    }
  }
  return merged;
}

/**
 * Apply a page of server changes atomically. Pulled entities replace local copies (same ids), so
 * records created offline are seamlessly "confirmed" without duplicates.
 */
export async function applyChanges(database: BusinessDb, changes: SyncChange[]): Promise<void> {
  if (changes.length === 0) return;
  const tables = [...new Set(Object.values(ENTITY_TABLES))].map((name) => database.table(name));
  await database.transaction('rw', [...tables, database.sync_queue, database.meta], async () => {
    const stockKeys = new Set<string>();
    for (const change of changes) {
      const tableName = ENTITY_TABLES[change.entity_type as keyof typeof ENTITY_TABLES];
      if (!tableName) continue;
      const table = database.table(tableName);

      if (change.action === 'delete' || !change.data) {
        if (change.entity_type !== 'stock_level') await table.delete(change.entity_id);
        continue;
      }

      let data: Record<string, unknown> = change.data;
      switch (change.entity_type) {
        case 'product':
          data = deriveProduct(data as never) as never;
          break;
        case 'customer':
          data = deriveCustomer(data as never) as never;
          break;
        case 'sale':
          data = deriveSale(data as never) as never;
          break;
        case 'inventory_movement': {
          const movement = deriveMovement(data as never);
          data = { ...movement, synced: 1 };
          stockKeys.add(movement.stock_key);
          break;
        }
        case 'stock_level': {
          const level = data as unknown as StockLevel;
          const key = level.stock_key || stockKey(level.store_id, level.product_id, level.variant_id, level.batch_id);
          data = { ...level, stock_key: key, server_qty: Number(level.qty) };
          stockKeys.add(key);
          break;
        }
        default:
          break;
      }
      data = await overlayPending(database, change.entity_type, data);
      await table.put(data);
    }
    await recalcStock(database, stockKeys);
  });
}
