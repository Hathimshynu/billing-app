import {
  backoffDelay,
  type ConflictOperation,
  type PullResponse,
  type PushOperation,
  type PushResponse,
  type SyncQueueItem,
} from '@shopdesk/shared';
import { ApiError, NetworkError, apiRequest, getApiContext } from '../api';
import { config } from '../config';
import type { BusinessDb } from '../db/business';
import { getMeta, setMeta } from '../db/business';
import { applyChanges, recalcStock } from './apply';
import { ensureNumberBlocks } from './numbers';
import { onLocalChange } from './outbox';
import { useSyncStore } from './store';

/** How many failed attempts before a transient failure is surfaced as "failed" in the Sync Center. */
const MAX_TRANSIENT_RETRIES = 12;

export interface EngineOptions {
  database: BusinessDb;
  businessId: string;
  deviceId: string;
  /** Registers the device with the server if it has not been registered yet. */
  ensureDevice: () => Promise<void>;
  /** Called when the server rejects our credentials. */
  onAuthError?: () => void;
}

/**
 * Offline-first synchronization engine.
 *
 *   detect online → push local operations → apply server results → pull server changes
 *   (incremental cursor) → reserve invoice numbers → upload attachments
 *
 * - The device's IndexedDB is the operational database; the engine never blocks the UI.
 * - Online status is decided by real requests (health probe), not just navigator.onLine.
 * - One sync at a time across tabs (Web Locks), exponential backoff with jitter on failures.
 * - Idempotent: every operation carries an operation_id; replays are safe.
 */
export class SyncEngine {
  private opts: EngineOptions | null = null;
  private rerun = false;
  private debounceTimer: number | null = null;
  private intervalTimer: number | null = null;
  private retryTimer: number | null = null;
  private failures = 0;
  private unsubscribers: Array<() => void> = [];
  private intervalMs: number = config.syncIntervalMs;

  start(options: EngineOptions): void {
    this.stop();
    this.opts = options;
    void getMeta<string>('last_sync_at', options.database).then((value) => useSyncStore.getState().set({ lastSyncAt: value ?? null }));

    const onOnline = () => {
      useSyncStore.getState().set({ online: true });
      this.requestSync('online', 0);
    };
    const onOffline = () => useSyncStore.getState().set({ online: false, status: 'offline' });
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.requestSync('visible', 300);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'shopdesk:sync') this.requestSync('background-sync', 0);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    this.unsubscribers.push(
      () => window.removeEventListener('online', onOnline),
      () => window.removeEventListener('offline', onOffline),
      () => document.removeEventListener('visibilitychange', onVisible),
      () => navigator.serviceWorker?.removeEventListener('message', onMessage),
      onLocalChange(() => {
        this.requestSync('local-change', 600);
        void this.registerBackgroundSync();
      }),
    );
    this.setInterval(config.syncIntervalMs);
    this.requestSync('start', 0);
  }

  stop(): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    for (const timer of [this.debounceTimer, this.retryTimer]) if (timer) window.clearTimeout(timer);
    if (this.intervalTimer) window.clearInterval(this.intervalTimer);
    this.debounceTimer = this.retryTimer = this.intervalTimer = null;
    this.opts = null;
    this.rerun = false;
    this.failures = 0;
  }

  /** Faster polling for screens that need near-real-time updates (e.g. kitchen display). */
  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.intervalTimer) window.clearInterval(this.intervalTimer);
    this.intervalTimer = window.setInterval(() => this.requestSync('interval', 0), this.intervalMs);
  }

  requestSync(_reason: string, delayMs = 800): void {
    if (!this.opts) return;
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.run();
    }, delayMs);
  }

  /** "Sync Now" — also clears backoff so the user gets immediate feedback. */
  async syncNow(): Promise<void> {
    this.failures = 0;
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    await this.run();
  }

  /** Probe the API. Used to show real connectivity rather than navigator.onLine guesses. */
  async checkConnectivity(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      useSyncStore.getState().set({ online: false });
      return false;
    }
    try {
      await apiRequest('/health', { timeoutMs: config.healthTimeoutMs });
      useSyncStore.getState().set({ online: true });
      return true;
    } catch {
      useSyncStore.getState().set({ online: false });
      return false;
    }
  }

  private inflight: Promise<void> | null = null;

  /** Run a sync cycle; concurrent callers share (and await) the cycle already in flight. */
  run(): Promise<void> {
    if (!this.opts) return Promise.resolve();
    if (this.inflight) {
      this.rerun = true;
      return this.inflight;
    }
    this.inflight = this.runLocked().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async runLocked(): Promise<void> {
    if (!this.opts) return;
    const opts = this.opts;
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (locks?.request) {
      await locks.request(`shopdesk-sync-${opts.businessId}`, { ifAvailable: true }, async (lock) => {
        if (lock) await this.cycle(opts);
      });
    } else {
      await this.cycle(opts);
    }
    if (this.rerun && this.opts) {
      this.rerun = false;
      this.requestSync('rerun', 200);
    }
  }

  private async cycle(opts: EngineOptions): Promise<void> {
    if (!getApiContext().token) {
      useSyncStore.getState().set({ status: 'auth', lastError: 'Sign in online to sync.' });
      return;
    }
    const store = useSyncStore.getState();
    try {
      if (!(await this.checkConnectivity())) {
        store.set({ status: 'offline' });
        this.scheduleRetry();
        return;
      }
      store.set({ status: 'syncing', lastError: null, progress: { phase: 'register', done: 0, total: null } });
      await opts.ensureDevice();
      await this.pushAll(opts.database);
      await this.pullAll(opts.database);
      useSyncStore.getState().set({ progress: { phase: 'blocks', done: 0, total: null } });
      await ensureNumberBlocks(opts.database);
      await this.uploadAttachments(opts.database);
      await this.pruneSynced(opts.database);
      const now = new Date().toISOString();
      await setMeta('last_sync_at', now, opts.database);
      this.failures = 0;
      useSyncStore.getState().set({ status: 'idle', lastSyncAt: now, progress: null, nextRetryAt: null, online: true });
    } catch (error) {
      useSyncStore.getState().set({ progress: null });
      if (error instanceof ApiError && error.status === 401) {
        useSyncStore.getState().set({ status: 'auth', lastError: 'Your session expired. Sign in to resume syncing.' });
        opts.onAuthError?.();
      } else if (error instanceof NetworkError) {
        useSyncStore.getState().set({ status: 'offline', online: false, lastError: null });
        this.scheduleRetry();
      } else {
        useSyncStore.getState().set({ status: 'error', lastError: error instanceof Error ? error.message : 'Sync failed' });
        this.scheduleRetry();
      }
    }
  }

  private scheduleRetry(): void {
    const delay = backoffDelay(this.failures++);
    useSyncStore.getState().set({ nextRetryAt: Date.now() + delay });
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.run(), delay);
  }

  /** Push pending operations in creation order, in batches. */
  private async pushAll(database: BusinessDb): Promise<void> {
    // Operations interrupted mid-flight (tab closed) become pending again; replay is idempotent.
    await database.sync_queue.where('status').equals('syncing').modify({ status: 'pending' });
    let done = 0;
    for (let round = 0; round < 1000; round++) {
      const now = Date.now();
      const batch = (await database.sync_queue.where('status').equals('pending').sortBy('id'))
        .filter((op) => !op.next_attempt_at || op.next_attempt_at <= now)
        .slice(0, config.pushBatchSize);
      if (batch.length === 0) return;
      const total = await database.sync_queue.where('status').equals('pending').count();
      useSyncStore.getState().set({ progress: { phase: 'push', done, total: done + total } });
      await database.sync_queue.bulkUpdate(batch.map((op) => ({ key: op.id!, changes: { status: 'syncing' as const } })));

      let response: PushResponse;
      try {
        response = await apiRequest<PushResponse>('/sync/push', {
          body: { device_id: getApiContext().deviceId, operations: batch.map(toPushOperation) },
          timeoutMs: 60_000,
        });
      } catch (error) {
        await database.sync_queue.bulkUpdate(batch.map((op) => ({ key: op.id!, changes: { status: 'pending' as const } })));
        throw error;
      }
      await this.handlePushResponse(database, batch, response);
      done += batch.length;
      // Stop early if nothing could be accepted (e.g. all waiting for dependencies).
      if (response.accepted.length === 0 && response.conflicts.length === 0) return;
    }
  }

  private async handlePushResponse(database: BusinessDb, batch: SyncQueueItem[], response: PushResponse): Promise<void> {
    const byOpId = new Map(batch.map((op) => [op.operation_id, op]));
    const acceptedEntityIds: string[] = [];
    await database.transaction(
      'rw',
      [database.sync_queue, database.inventory_movements, database.stock_levels, database.sync_conflicts],
      async () => {
        const now = new Date().toISOString();
        for (const accepted of response.accepted) {
          const op = byOpId.get(accepted.operation_id);
          if (!op) continue;
          await database.sync_queue.update(op.id!, { status: 'synced', updated_at: now, last_error: null });
          acceptedEntityIds.push(op.entity_id);
        }
        for (const rejected of response.rejected) {
          const op = byOpId.get(rejected.operation_id);
          if (!op) continue;
          const retries = op.retry_count + 1;
          const giveUp = !rejected.retryable || retries >= MAX_TRANSIENT_RETRIES;
          await database.sync_queue.update(op.id!, {
            status: giveUp ? 'failed' : 'pending',
            retry_count: retries,
            last_error: formatRejection(rejected.message, rejected.errors),
            next_attempt_at: giveUp ? null : Date.now() + backoffDelay(retries - 1),
            updated_at: now,
          });
        }
        for (const conflict of response.conflicts) {
          const op = byOpId.get(conflict.operation_id);
          if (!op) continue;
          await database.sync_queue.update(op.id!, { status: 'conflict', last_error: conflict.message, updated_at: now });
          await database.sync_conflicts.put(toConflictRecord(conflict, op));
        }
        // Movements created by accepted operations are now included in the server's stock figure;
        // the local level is recalculated when that figure is pulled (push always precedes pull).
        for (const entityId of acceptedEntityIds) {
          await database.inventory_movements
            .where('reference_id')
            .equals(entityId)
            .filter((m) => m.synced !== 1)
            .modify({ synced: 1 });
        }
      },
    );
    if (response.accepted.length) {
      const total = ((await getMeta<number>('synced_total', database)) ?? 0) + response.accepted.length;
      await setMeta('synced_total', total, database);
    }
    if (response.server_changes.length) await applyChanges(database, response.server_changes);
  }

  /** Incremental pull using the change-feed cursor, page by page. */
  private async pullAll(database: BusinessDb): Promise<void> {
    let cursor = (await getMeta<number>('cursor', database)) ?? 0;
    let pages = 0;
    let received = 0;
    for (;;) {
      useSyncStore.getState().set({ progress: { phase: 'pull', done: received, total: null } });
      const page = await apiRequest<PullResponse>('/sync/pull', {
        body: { device_id: getApiContext().deviceId, cursor, limit: config.pullPageSize },
        timeoutMs: 60_000,
      });
      await applyChanges(database, page.changes);
      received += page.changes.length;
      cursor = page.cursor;
      await setMeta('cursor', cursor, database);
      pages++;
      if (!page.has_more || pages > 10_000) break;
    }
    if (received > 0) {
      // Make sure every stock level reflects its unconfirmed local movements.
      const keys = (await database.inventory_movements.where('synced').notEqual(1).toArray()).map((m) => m.stock_key);
      await recalcStock(database, keys);
    }
    await setMeta('initial_sync_done', true, database);
  }

  private async uploadAttachments(database: BusinessDb): Promise<void> {
    const pending = await database.attachments.where('uploaded').equals(0).toArray();
    for (const attachment of pending) {
      // Only after the expense itself reached the server.
      const queued = await database.sync_queue
        .where('entity_id')
        .equals(attachment.entity_id)
        .filter((op) => op.status !== 'synced')
        .count();
      if (queued > 0) continue;
      const form = new FormData();
      form.append('entity_type', attachment.entity_type);
      form.append('entity_id', attachment.entity_id);
      form.append('file', attachment.blob, attachment.filename);
      useSyncStore.getState().set({ progress: { phase: 'attachments', done: 0, total: pending.length } });
      const result = await apiRequest<{ data: { expense: Record<string, unknown> } }>('/attachments', { body: form, timeoutMs: 60_000 });
      await database.transaction('rw', database.attachments, database.expenses, async () => {
        await database.attachments.update(attachment.id, { uploaded: 1 });
        await database.expenses.put(result.data.expense as never);
      });
    }
  }

  /** Keep the outbox small: synced operations older than 3 days are removed. */
  private async pruneSynced(database: BusinessDb): Promise<void> {
    const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await database.sync_queue
      .where('status')
      .equals('synced')
      .filter((op) => op.updated_at < cutoff)
      .delete();
  }

  private async registerBackgroundSync(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker?.ready;
      const sync = (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } } | undefined)?.sync;
      await sync?.register('shopdesk-sync');
    } catch {
      // Background Sync is optional (not supported in every browser).
    }
  }
}

function toPushOperation(op: SyncQueueItem): PushOperation {
  return {
    operation_id: op.operation_id,
    entity_type: op.entity_type,
    entity_id: op.entity_id,
    operation: op.operation,
    payload: op.payload,
    base_version: op.base_version,
    created_at: op.created_at,
    user_id: op.user_id,
  };
}

function formatRejection(message: string, errors: Record<string, string[]> | null): string {
  if (!errors) return message;
  const details = Object.entries(errors)
    .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
    .join('; ');
  return details ? `${message} (${details})` : message;
}

function toConflictRecord(conflict: ConflictOperation, op: SyncQueueItem) {
  return {
    id: conflict.conflict_id,
    business_id: '',
    operation_id: conflict.operation_id,
    entity_type: conflict.entity_type,
    entity_id: conflict.entity_id,
    conflict_type: conflict.conflict_type,
    fields: conflict.fields,
    server_data: conflict.server_data,
    local_payload: op.payload,
    message: conflict.message,
    status: 'open' as const,
    resolution: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
    version: 1,
    updated_at: new Date().toISOString(),
  };
}

export const syncEngine = new SyncEngine();
