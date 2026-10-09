import { stockKey, uuidv7, type AdjustmentType, type StockAdjustment, type StockTransfer } from '@shopdesk/shared';
import { db } from '../db/business';
import { runtime } from '../runtime';
import { enqueue, mutate } from '../sync/outbox';
import { newEntityBase, nowIso, recordMovement } from './base';

export interface AdjustmentLine {
  product_id: string;
  variant_id: string | null;
  batch_id: string | null;
  /** Positive adds stock, negative removes stock. */
  quantity: number;
  unit_cost: number;
}

const MOVEMENT_FOR: Record<AdjustmentType, 'ADJUSTMENT' | 'OPENING_STOCK' | 'DAMAGE' | 'EXPIRED'> = {
  adjustment: 'ADJUSTMENT',
  opening_stock: 'OPENING_STOCK',
  damage: 'DAMAGE',
  expired: 'EXPIRED',
};

/** Stock adjustment (count correction, opening stock, damage, expiry write-off). */
export async function adjustStock(type: AdjustmentType, lines: AdjustmentLine[], reason: string | null): Promise<StockAdjustment> {
  const rt = runtime();
  const database = db();
  const valid = lines.filter((l) => l.quantity !== 0);
  if (valid.length === 0) throw new Error('Enter at least one quantity.');
  return mutate([database.stock_adjustments, database.inventory_movements, database.stock_levels], async () => {
    const id = uuidv7();
    const occurredAt = nowIso();
    const items = valid.map((l) => ({ id: uuidv7(), ...l }));
    const payloadItems: Array<Record<string, unknown>> = [];
    for (const item of items) {
      const movement = await recordMovement({
        product_id: item.product_id,
        variant_id: item.variant_id,
        batch_id: item.batch_id,
        type: MOVEMENT_FOR[type],
        qty_in: item.quantity > 0 ? item.quantity : 0,
        qty_out: item.quantity < 0 ? -item.quantity : 0,
        unit_cost: item.unit_cost,
        reference_type: 'stock_adjustment',
        reference_id: id,
        notes: reason,
        occurred_at: occurredAt,
      });
      payloadItems.push({ ...item, movement_id: movement.id });
    }
    const adjustment: StockAdjustment = { ...newEntityBase(id), store_id: rt.storeId, device_id: rt.deviceId, type, reason, items, occurred_at: occurredAt, created_by: rt.userId };
    await database.stock_adjustments.put({ ...adjustment, _pending: 1 });
    await enqueue({ operation: 'CREATE_STOCK_ADJUSTMENT', entity_id: id, payload: { store_id: rt.storeId, type, reason, occurred_at: occurredAt, items: payloadItems } });
    return adjustment;
  });
}

/** Set the counted quantity for a stock row (computes the adjustment delta). */
export async function setCountedStock(productId: string, variantId: string | null, batchId: string | null, counted: number, reason: string | null): Promise<void> {
  const rt = runtime();
  const level = await db().stock_levels.get(stockKey(rt.storeId, productId, variantId, batchId));
  const current = level?.qty ?? 0;
  const delta = Math.round((counted - current) * 1000) / 1000;
  if (delta === 0) return;
  const product = await db().products.get(productId);
  await adjustStock('adjustment', [{ product_id: productId, variant_id: variantId, batch_id: batchId, quantity: delta, unit_cost: level?.avg_cost || product?.purchase_price || 0 }], reason ?? 'Stock count');
}

export async function createTransfer(toStoreId: string, lines: Array<Omit<AdjustmentLine, 'unit_cost'> & { unit_cost?: number }>, notes: string | null): Promise<StockTransfer> {
  const rt = runtime();
  const database = db();
  if (toStoreId === rt.storeId) throw new Error('Choose a different destination store.');
  return mutate([database.stock_transfers, database.inventory_movements, database.stock_levels], async () => {
    const id = uuidv7();
    const sentAt = nowIso();
    const items = lines.filter((l) => l.quantity > 0).map((l) => ({ id: uuidv7(), product_id: l.product_id, variant_id: l.variant_id, batch_id: l.batch_id, quantity: l.quantity, unit_cost: l.unit_cost ?? 0 }));
    if (items.length === 0) throw new Error('Add items to transfer.');
    const payloadItems: Array<Record<string, unknown>> = [];
    for (const item of items) {
      const movement = await recordMovement({ ...item, type: 'TRANSFER_OUT', qty_out: item.quantity, reference_type: 'stock_transfer', reference_id: id, occurred_at: sentAt });
      payloadItems.push({ ...item, movement_id: movement.id });
    }
    const transfer: StockTransfer = {
      ...newEntityBase(id),
      from_store_id: rt.storeId,
      to_store_id: toStoreId,
      transfer_number: 'Pending',
      status: 'in_transit',
      items,
      notes,
      created_by: rt.userId,
      sent_at: sentAt,
      received_at: null,
      received_by: null,
    };
    await database.stock_transfers.put({ ...transfer, _pending: 1 });
    await enqueue({ operation: 'CREATE_STOCK_TRANSFER', entity_id: id, payload: { from_store_id: rt.storeId, to_store_id: toStoreId, notes, sent_at: sentAt, items: payloadItems } });
    return transfer;
  });
}

export async function receiveTransfer(transferId: string): Promise<void> {
  const rt = runtime();
  const database = db();
  await mutate([database.stock_transfers, database.inventory_movements, database.stock_levels], async () => {
    const transfer = await database.stock_transfers.get(transferId);
    if (!transfer || transfer.status !== 'in_transit') return;
    const movementIds: Record<string, string> = {};
    for (const item of transfer.items) {
      const movement = await recordMovement({
        store_id: transfer.to_store_id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        batch_id: item.batch_id,
        type: 'TRANSFER_IN',
        qty_in: item.quantity,
        unit_cost: item.unit_cost,
        reference_type: 'stock_transfer',
        reference_id: transfer.id,
        reference_no: transfer.transfer_number,
      });
      movementIds[item.id] = movement.id;
    }
    await database.stock_transfers.put({ ...transfer, status: 'received', received_at: nowIso(), received_by: rt.userId, _pending: 1 });
    await enqueue({ operation: 'RECEIVE_STOCK_TRANSFER', entity_id: transfer.id, payload: { movement_ids: movementIds } });
  });
}
