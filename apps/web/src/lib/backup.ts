import { db, type BusinessDb } from './db/business';
import { runtime } from './runtime';
import { downloadBlob } from './export';

const FORMAT = 'shopdesk-device-backup';
const VERSION = 1;
/** Local-only tables that are not useful in a backup. */
const SKIP = new Set(['attachments']);

export interface DeviceBackup {
  format: typeof FORMAT;
  version: number;
  business_id: string;
  device_id: string;
  created_at: string;
  tables: Record<string, unknown[]>;
}

/** Full snapshot of this device's IndexedDB for the open business (including unsynced changes). */
export async function createDeviceBackup(database: BusinessDb = db()): Promise<DeviceBackup> {
  const rt = runtime();
  const tables: Record<string, unknown[]> = {};
  for (const table of database.tables) {
    if (SKIP.has(table.name)) continue;
    tables[table.name] = await table.toArray();
  }
  return { format: FORMAT, version: VERSION, business_id: rt.businessId, device_id: rt.deviceId, created_at: new Date().toISOString(), tables };
}

export async function downloadDeviceBackup(): Promise<void> {
  const backup = await createDeviceBackup();
  const stamp = backup.created_at.replace(/[:.]/g, '-').slice(0, 19);
  downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `shopdesk-backup-${stamp}.json`);
}

export interface RestoreSummary {
  records: number;
  pendingOperations: number;
}

/**
 * Restore a device backup into this browser (e.g. after browser data was cleared before changes
 * synced). Records are merged by id; unsynced operations are queued again. The server deduplicates
 * operations by operation_id, so restoring twice or on the original device never duplicates data.
 */
export async function restoreDeviceBackup(file: File): Promise<RestoreSummary> {
  const rt = runtime();
  let backup: DeviceBackup;
  try {
    backup = JSON.parse(await file.text()) as DeviceBackup;
  } catch {
    throw new Error('This is not a valid backup file.');
  }
  if (backup.format !== FORMAT || typeof backup.tables !== 'object') throw new Error('This is not a ShopDesk device backup.');
  if (backup.version > VERSION) throw new Error('This backup was made by a newer version of the app.');
  if (backup.business_id !== rt.businessId) throw new Error('This backup belongs to a different business.');

  const database = db();
  let records = 0;
  let pendingOperations = 0;
  const restorable = database.tables.filter((t) => !SKIP.has(t.name) && t.name !== 'meta' && Array.isArray(backup.tables[t.name]));
  await database.transaction('rw', restorable, async () => {
    for (const table of restorable) {
      const rows = backup.tables[table.name] as Array<Record<string, unknown>>;
      if (table.name === 'sync_queue') {
        for (const op of rows) {
          if (op.status === 'synced') continue;
          const exists = await table.where('operation_id').equals(op.operation_id as string).count();
          if (exists) continue;
          const { id: _id, ...rest } = op;
          await table.add({ ...rest, status: 'pending', retry_count: 0, next_attempt_at: null });
          pendingOperations++;
        }
        continue;
      }
      // Keep newer local copies: only add records missing locally or older than the backup.
      for (const row of rows) {
        const key = table.schema.primKey.keyPath as string;
        const current = (await table.get(row[key] as string)) as Record<string, unknown> | undefined;
        if (current && typeof current.version === 'number' && typeof row.version === 'number' && current.version > row.version) continue;
        await table.put(row);
        records++;
      }
    }
  });
  return { records, pendingOperations };
}
