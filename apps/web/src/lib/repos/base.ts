import { addQty, roundQty, stockKey, uuidv7, type InventoryMovement, type MovementType, type SyncOperationName } from '@shopdesk/shared';
import type { Table } from 'dexie';
import { db } from '../db/business';
import { runtime } from '../runtime';
import { diffEntity, enqueue, mutate } from '../sync/outbox';

export const nowIso = () => new Date().toISOString();

/** Common fields of an entity created on this device (version 0 = not yet on the server). */
export function newEntityBase(id: string = uuidv7()) {
  const now = nowIso();
  return {
    id,
    business_id: runtime().businessId,
    version: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    _pending: 1 as const,
  };
}

/** Strip local-only fields before sending an entity to the server. */
export function toPayload<T extends Record<string, unknown>>(entity: T, omit: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (key.startsWith('_') || ['codes', 'search', 'product_ids', 'business_id', 'version', 'created_at', 'updated_at', 'deleted_at', ...omit].includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Generic create for master data: local write + CREATE_* operation in one transaction. */
export async function createEntity<T extends { id: string }>(
  table: Table,
  operation: SyncOperationName,
  entity: T,
  payload: Record<string, unknown> = toPayload(entity as unknown as Record<string, unknown>),
): Promise<T> {
  await mutate([table], async () => {
    await table.put(entity);
    await enqueue({ operation, entity_id: entity.id, payload });
  });
  return entity;
}

/**
 * Generic update: computes a field-level diff (changes + base values) so the server can detect
 * real conflicts instead of overwriting another device's edits.
 */
export async function updateEntity<T extends { id: string; version: number }>(
  table: Table,
  operation: SyncOperationName,
  id: string,
  patch: Partial<T>,
  fields: readonly string[],
  extraPayload: Record<string, unknown> = {},
): Promise<T | undefined> {
  return mutate([table], async () => {
    const current = (await table.get(id)) as T | undefined;
    if (!current) throw new Error('Record not found');
    const { changes, base } = diffEntity(current as unknown as Record<string, unknown>, patch as Record<string, unknown>, fields);
    if (Object.keys(changes).length === 0) return current;
    const next = { ...current, ...changes, updated_at: nowIso(), _pending: 1 } as T;
    await table.put(next);
    await enqueue({ operation, entity_id: id, payload: { changes, base, ...extraPayload }, base_version: current.version });
    return next;
  });
}

export async function deleteEntity(table: Table, operation: SyncOperationName, id: string): Promise<void> {
  await mutate([table], async () => {
    const current = await table.get(id);
    if (!current) return;
    await table.put({ ...current, deleted_at: nowIso(), _pending: 1 });
    await enqueue({ operation, entity_id: id, payload: {} });
  });
}

export interface LocalMovementInput {
  id?: string;
  store_id?: string;
  product_id: string;
  variant_id?: string | null;
  batch_id?: string | null;
  type: MovementType;
  qty_in?: number;
  qty_out?: number;
  unit_cost?: number;
  reference_type: string;
  reference_id: string;
  reference_no?: string | null;
  notes?: string | null;
  occurred_at?: string;
}

/**
 * Record an inventory movement locally (inside an open transaction including inventory_movements
 * and stock_levels) and apply it to the local stock figure. The movement id is sent to the server
 * so the server's copy replaces this one when pulled.
 */
export async function recordMovement(input: LocalMovementInput): Promise<InventoryMovement> {
  const rt = runtime();
  const database = db();
  const storeId = input.store_id ?? rt.storeId;
  const key = stockKey(storeId, input.product_id, input.variant_id, input.batch_id);
  const movement = {
    id: input.id ?? uuidv7(),
    business_id: rt.businessId,
    store_id: storeId,
    product_id: input.product_id,
    variant_id: input.variant_id ?? null,
    batch_id: input.batch_id ?? null,
    type: input.type,
    qty_in: roundQty(input.qty_in ?? 0),
    qty_out: roundQty(input.qty_out ?? 0),
    unit_cost: input.unit_cost ?? 0,
    reference_type: input.reference_type,
    reference_id: input.reference_id,
    reference_no: input.reference_no ?? null,
    notes: input.notes ?? null,
    created_by: rt.userId,
    device_id: rt.deviceId,
    occurred_at: input.occurred_at ?? nowIso(),
    synced: 0 as const,
    stock_key: key,
  };
  await database.inventory_movements.put(movement);
  const level = await database.stock_levels.get(key);
  const delta = addQty(movement.qty_in, -movement.qty_out);
  if (level) {
    await database.stock_levels.put({ ...level, qty: roundQty(addQty(level.qty, delta)), updated_at: nowIso() });
  } else {
    await database.stock_levels.put({
      stock_key: key,
      business_id: rt.businessId,
      store_id: storeId,
      product_id: input.product_id,
      variant_id: input.variant_id ?? null,
      batch_id: input.batch_id ?? null,
      qty: roundQty(delta),
      server_qty: 0,
      avg_cost: input.unit_cost ?? 0,
      updated_at: nowIso(),
    });
  }
  return movement;
}
