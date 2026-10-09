import type { SyncConflictRecord, SyncQueueItem } from '@shopdesk/shared';
import { ENTITY_TABLES, db } from '../db/business';
import { syncEngine } from '../sync/engine';
import { enqueue, mutate } from '../sync/outbox';
import { toPayload } from './base';

/** Retry failed operations. CREATE operations are refreshed with the record's current local data. */
export async function retryFailed(ids?: number[]): Promise<void> {
  const database = db();
  const failed = (await database.sync_queue.where('status').equals('failed').toArray()).filter((op) => !ids || ids.includes(op.id!));
  const tables = [...new Set(Object.values(ENTITY_TABLES))].map((name) => database.table(name));
  await database.transaction('rw', [database.sync_queue, ...tables], async () => {
    for (const op of failed) {
      let payload = op.payload;
      const tableName = ENTITY_TABLES[op.entity_type as keyof typeof ENTITY_TABLES];
      if (op.operation.startsWith('CREATE_') && REFRESHABLE.has(op.entity_type) && tableName) {
        // The user may have corrected the record since it was rejected: send its current data.
        const current = (await database.table(tableName).get(op.entity_id)) as Record<string, unknown> | undefined;
        if (current) payload = { ...op.payload, ...toPayload(current, ['image_url']) };
      }
      await database.sync_queue.update(op.id!, { status: 'pending', payload, retry_count: 0, next_attempt_at: null, last_error: null });
    }
  });
  await syncEngine.syncNow();
}

const REFRESHABLE = new Set(['category', 'brand', 'unit', 'tax_rate', 'product', 'customer', 'supplier', 'expense_category', 'restaurant_table', 'coupon']);

/**
 * Discard an operation that can never succeed. Financial operations cannot be discarded
 * (the UI only offers this for master data such as a product with invalid data).
 */
export async function discardOperation(op: SyncQueueItem): Promise<void> {
  await db().sync_queue.delete(op.id!);
}

/**
 * Resolve a conflict.
 *  keep_local  → re-send the local values as a forced update (server applies them)
 *  keep_server → accept the server values (already applied locally by the last pull)
 *  reviewed    → acknowledge (e.g. IMEI sold twice — handled outside the app)
 */
export async function resolveConflict(conflict: SyncConflictRecord, resolution: 'keep_local' | 'keep_server' | 'reviewed'): Promise<void> {
  const database = db();
  const tableName = ENTITY_TABLES[conflict.entity_type as keyof typeof ENTITY_TABLES];
  const table = tableName ? database.table(tableName) : null;
  await mutate(table ? [table, database.sync_conflicts] : [database.sync_conflicts], async () => {
    if (resolution === 'keep_local' && conflict.conflict_type === 'field' && table) {
      const current = (await table.get(conflict.entity_id)) as Record<string, unknown> | undefined;
      const changes = Object.fromEntries(conflict.fields.map((f) => [f.field, f.local]));
      const base = Object.fromEntries(conflict.fields.map((f) => [f.field, f.server]));
      if (current) await table.put({ ...current, ...changes, _pending: 1 });
      const entity = conflict.entity_type.toUpperCase();
      const operation = conflict.entity_type === 'setting' ? 'UPDATE_SETTING' : `UPDATE_${entity}`;
      await enqueue({
        operation: operation as never,
        entity_id: conflict.entity_id,
        payload: conflict.entity_type === 'setting'
          ? { key: (current?.key as string) ?? (conflict.server_data?.key as string), changes, base, force: true }
          : { changes, base, force: true },
        base_version: (current?.version as number | undefined) ?? null,
      });
    }
    if (resolution === 'keep_local' && conflict.conflict_type === 'deleted' && table) {
      const current = (await table.get(conflict.entity_id)) as Record<string, unknown> | undefined;
      if (current) {
        const entity = conflict.entity_type.toUpperCase();
        await enqueue({ operation: `UPDATE_${entity}` as never, entity_id: conflict.entity_id, payload: { changes: toPayload(current), base: {}, force: true } });
      }
    }
    await database.sync_conflicts.put({ ...conflict, status: 'resolved', resolution, resolved_at: new Date().toISOString() });
    await enqueue({ operation: 'RESOLVE_CONFLICT', entity_id: conflict.id, payload: { resolution } });
  });
}
