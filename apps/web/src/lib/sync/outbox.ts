import { uuidv7, type SyncEntityType, type SyncOperationName, type SyncQueueItem, SYNC_OPERATIONS } from '@shopdesk/shared';
import type { Table } from 'dexie';
import { db } from '../db/business';
import { runtime } from '../runtime';

type ChangeListener = () => void;
const listeners = new Set<ChangeListener>();

/** The sync engine subscribes to be told about new local operations. */
export function onLocalChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface EnqueueInput {
  operation: SyncOperationName;
  entity_id: string;
  payload: Record<string, unknown>;
  base_version?: number | null;
}

/**
 * Append an operation to the outbox. MUST be called inside a Dexie transaction that also writes the
 * local data, so data and operation commit (or fail) together — an invoice can never exist locally
 * without the operation that will sync it.
 */
export async function enqueue(input: EnqueueInput): Promise<SyncQueueItem> {
  const rt = runtime();
  const now = new Date().toISOString();
  const item: SyncQueueItem = {
    operation_id: uuidv7(),
    entity_type: SYNC_OPERATIONS[input.operation] as SyncEntityType,
    entity_id: input.entity_id,
    operation: input.operation,
    payload: input.payload,
    base_version: input.base_version ?? null,
    created_at: now,
    updated_at: now,
    retry_count: 0,
    status: 'pending',
    device_id: rt.deviceId,
    user_id: rt.userId,
    last_error: null,
    next_attempt_at: null,
  };
  const id = await db().sync_queue.add(item);
  return { ...item, id };
}

/**
 * Run a local write transaction that includes the outbox, then wake the sync engine.
 */
export async function mutate<T>(tables: Array<Table>, work: () => Promise<T>): Promise<T> {
  const database = db();
  const result = await database.transaction('rw', [...tables, database.sync_queue, database.meta], work);
  listeners.forEach((l) => l());
  return result;
}

/** Field-level diff used for UPDATE operations: changed values + the values they replaced. */
export function diffEntity<T extends Record<string, unknown>>(
  current: T,
  next: Partial<T>,
  fields: readonly string[],
): { changes: Record<string, unknown>; base: Record<string, unknown> } {
  const changes: Record<string, unknown> = {};
  const base: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in next)) continue;
    const before = current[field];
    const after = (next as Record<string, unknown>)[field];
    if (JSON.stringify(normalize(before)) !== JSON.stringify(normalize(after))) {
      changes[field] = after;
      base[field] = before ?? null;
    }
  }
  return { changes, base };
}

function normalize(value: unknown): unknown {
  if (value === '' || value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]));
  }
  return value;
}
