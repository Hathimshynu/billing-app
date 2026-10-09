import { uuidv7, type JewelleryOrder, type KitchenOrder, type KitchenOrderItem, type KitchenStatus, type MetalRate, type MetalType, type OrderType, type RestaurantTable } from '@shopdesk/shared';
import { db, getMeta, setMeta } from '../db/business';
import { runtime } from '../runtime';
import { enqueue, mutate } from '../sync/outbox';
import { createEntity, deleteEntity, newEntityBase, nowIso, toPayload, updateEntity } from './base';

/* ------------------------------- Restaurant ------------------------------- */

export const createTable = (input: Pick<RestaurantTable, 'name' | 'area' | 'capacity' | 'sort_order' | 'active'>) =>
  createEntity(db().restaurant_tables, 'CREATE_RESTAURANT_TABLE', { ...newEntityBase(), store_id: runtime().storeId, ...input } as RestaurantTable);
export const updateTable = (id: string, patch: Partial<RestaurantTable>) =>
  updateEntity<RestaurantTable>(db().restaurant_tables, 'UPDATE_RESTAURANT_TABLE', id, patch, ['name', 'area', 'capacity', 'sort_order', 'active']);
export const deleteTable = (id: string) => deleteEntity(db().restaurant_tables, 'DELETE_RESTAURANT_TABLE', id);

/**
 * Send items to the kitchen. KOTs are append-only (adding items creates a new KOT), so waiters on
 * different devices never conflict over the same table.
 */
export async function sendKot(input: { table_id: string | null; order_type: OrderType; items: Omit<KitchenOrderItem, 'id'>[]; guests?: number | null; notes?: string | null; is_void?: boolean }): Promise<KitchenOrder> {
  const rt = runtime();
  const database = db();
  return mutate([database.kitchen_orders], async () => {
    const counter = ((await getMeta<number>('kot_seq')) ?? 0) + 1;
    await setMeta('kot_seq', counter);
    const kot: KitchenOrder = {
      ...newEntityBase(),
      store_id: rt.storeId,
      device_id: rt.deviceId,
      table_id: input.table_id,
      order_type: input.order_type,
      kot_number: `${rt.deviceCode}-${String(counter).padStart(4, '0')}`,
      items: input.items.map((i) => ({ ...i, id: uuidv7() })),
      status: 'pending',
      is_void: input.is_void ?? false,
      guests: input.guests ?? null,
      notes: input.notes ?? null,
      sale_id: null,
      created_by: rt.userId,
      occurred_at: nowIso(),
    };
    await database.kitchen_orders.put({ ...kot, _pending: 1 });
    await enqueue({ operation: 'CREATE_KITCHEN_ORDER', entity_id: kot.id, payload: toPayload(kot as unknown as Record<string, unknown>, ['status', 'sale_id', 'device_id', 'created_by']) });
    return kot;
  });
}

export async function setKotStatus(id: string, status: KitchenStatus): Promise<void> {
  const database = db();
  await mutate([database.kitchen_orders], async () => {
    const kot = await database.kitchen_orders.get(id);
    if (!kot) return;
    await database.kitchen_orders.put({ ...kot, status, _pending: 1 });
    await enqueue({ operation: 'UPDATE_KITCHEN_ORDER_STATUS', entity_id: id, payload: { status } });
  });
}

/* -------------------------------- Jewellery -------------------------------- */

export async function setMetalRate(metal: MetalType, purity: string, ratePerGram: number): Promise<MetalRate> {
  const rate: MetalRate = { ...newEntityBase(), metal, purity, rate_per_gram: ratePerGram, effective_from: nowIso(), created_by: runtime().userId };
  return createEntity(db().metal_rates, 'CREATE_METAL_RATE', rate, { metal, purity, rate_per_gram: ratePerGram, effective_from: rate.effective_from });
}

export const JEWELLERY_ORDER_FIELDS = ['order_number', 'type', 'customer_id', 'customer_name', 'customer_phone', 'description', 'metal', 'purity', 'weight', 'estimated_amount', 'advance_paid', 'advance_method', 'due_date', 'status', 'delivered_at', 'sale_id', 'notes'] as const;

export async function createJewelleryOrder(input: Omit<JewelleryOrder, 'id' | 'business_id' | 'version' | 'created_at' | 'updated_at' | 'deleted_at' | 'store_id' | 'order_number' | 'created_by' | 'delivered_at' | 'sale_id'>): Promise<JewelleryOrder> {
  const rt = runtime();
  const counter = ((await getMeta<number>('jo_seq')) ?? 0) + 1;
  await setMeta('jo_seq', counter);
  const order: JewelleryOrder = {
    ...newEntityBase(),
    ...input,
    store_id: rt.storeId,
    order_number: `JO-${rt.deviceCode}-${String(counter).padStart(4, '0')}`,
    delivered_at: null,
    sale_id: null,
    created_by: rt.userId,
  };
  return createEntity(db().jewellery_orders, 'CREATE_JEWELLERY_ORDER', order, toPayload(order as unknown as Record<string, unknown>, ['created_by']));
}

export const updateJewelleryOrder = (id: string, patch: Partial<JewelleryOrder>) =>
  updateEntity<JewelleryOrder>(db().jewellery_orders, 'UPDATE_JEWELLERY_ORDER', id, patch, JEWELLERY_ORDER_FIELDS);

/* --------------------------------- Settings --------------------------------- */

export async function updateSetting(key: string, changes: Record<string, unknown>): Promise<void> {
  const database = db();
  await mutate([database.settings], async () => {
    const current = await database.settings.where('key').equals(key).first();
    const value = (current?.value ?? {}) as Record<string, unknown>;
    const base: Record<string, unknown> = {};
    for (const field of Object.keys(changes)) base[field] = value[field] ?? null;
    const id = current?.id ?? uuidv7();
    await database.settings.put({ id, business_id: runtime().businessId, key, value: { ...value, ...changes }, version: current?.version ?? 0, updated_at: nowIso() });
    await enqueue({ operation: 'UPDATE_SETTING', entity_id: id, payload: { key, changes, base }, base_version: current?.version ?? null });
  });
}
