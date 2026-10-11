import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7, type PushOperation, type SyncChange } from '@shopdesk/shared';
import { setupBusiness, makeProduct, type TestBusiness } from '@/test/helpers';
import { setApiContext } from '@/lib/api';
import { getMeta } from '@/lib/db/business';
import { SyncEngine } from '@/lib/sync/engine';
import { useSyncStore } from '@/lib/sync/store';

type Handler = (body: Record<string, unknown>) => { status?: number; json: unknown };

/** Minimal fake API: route → handler. Throwing simulates the network being down. */
function fakeServer(routes: Record<string, Handler>, opts: { down?: boolean } = {}) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (opts.down) throw new TypeError('Failed to fetch');
    const path = new URL(url).pathname.replace('/api/v1', '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ path, body });
    const handler = routes[path];
    if (!handler) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    const result = handler(body);
    return new Response(JSON.stringify(result.json), { status: result.status ?? 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const blocks = () => ({ json: { success: true, data: [] } });
const emptyPull = () => ({ json: { success: true, changes: [], cursor: 0, has_more: false, server_time: new Date().toISOString() } });

let env: TestBusiness;
let engine: SyncEngine;

beforeEach(async () => {
  env = await setupBusiness();
  setApiContext({ token: 'test-token', businessId: env.businessId, deviceId: env.deviceId });
  useSyncStore.getState().set({ status: 'idle', online: true, lastError: null });
  engine = new SyncEngine();
});

/** Start after the fake server is installed (start() triggers an immediate sync). */
function start() {
  engine.start({ database: env.database, businessId: env.businessId, deviceId: env.deviceId, ensureDevice: async () => {} });
}

afterEach(() => {
  engine.stop();
  vi.unstubAllGlobals();
});

describe('sync engine', () => {
  it('stays offline without losing data when the server is unreachable', async () => {
    await makeProduct(env);
    fakeServer({}, { down: true });
    start();
    await engine.syncNow();
    expect(useSyncStore.getState().status).toBe('offline');
    expect((await env.database.sync_queue.toArray())[0]!.status).toBe('pending');
  });

  it('pushes pending operations in order and marks them synced', async () => {
    const product = await makeProduct(env);
    const server = fakeServer({
      '/health': () => ({ json: { success: true } }),
      '/sync/push': (body) => ({ json: { success: true, accepted: (body.operations as PushOperation[]).map((o) => ({ operation_id: o.operation_id, entity_id: o.entity_id, status: 'accepted' })), rejected: [], conflicts: [], server_changes: [] } }),
      '/sync/pull': emptyPull,
      '/devices/number-blocks': blocks,
    });
    start();
    await engine.syncNow();
    const push = server.calls.find((c) => c.path === '/sync/push')!;
    expect((push.body.operations as PushOperation[])[0]).toMatchObject({ operation: 'CREATE_PRODUCT', entity_id: product.id });
    expect(push.body.device_id).toBe(env.deviceId);
    expect((await env.database.sync_queue.toArray())[0]!.status).toBe('synced');
    expect(await getMeta('synced_total')).toBe(1);
    expect(useSyncStore.getState().status).toBe('idle');
  });

  it('replays safely: the same operation_id is sent again after an interrupted push', async () => {
    await makeProduct(env);
    const op = (await env.database.sync_queue.toArray())[0]!;
    await env.database.sync_queue.update(op.id!, { status: 'syncing' }); // tab closed mid-push
    const seen: string[] = [];
    fakeServer({
      '/health': () => ({ json: { success: true } }),
      '/sync/push': (body) => {
        const operations = body.operations as PushOperation[];
        seen.push(...operations.map((o) => o.operation_id));
        return { json: { success: true, accepted: operations.map((o) => ({ operation_id: o.operation_id, entity_id: o.entity_id, status: 'duplicate' })), rejected: [], conflicts: [], server_changes: [] } };
      },
      '/sync/pull': emptyPull,
      '/devices/number-blocks': blocks,
    });
    start();
    await engine.syncNow();
    expect(seen).toEqual([op.operation_id]);
    expect((await env.database.sync_queue.get(op.id!))!.status).toBe('synced');
  });

  it('keeps retryable rejections pending with backoff and marks permanent ones failed', async () => {
    await makeProduct(env, { name: 'A' });
    await makeProduct(env, { name: 'B' });
    const [a, b] = await env.database.sync_queue.orderBy('id').toArray();
    fakeServer({
      '/health': () => ({ json: { success: true } }),
      '/sync/push': () => ({
        json: {
          success: true,
          accepted: [],
          rejected: [
            { operation_id: a!.operation_id, code: 'dependency_missing', message: 'Category not synced yet', retryable: true, errors: {} },
            { operation_id: b!.operation_id, code: 'validation_failed', message: 'Invalid data', retryable: false, errors: { selling_price: ['Too high'] } },
          ],
          conflicts: [],
          server_changes: [],
        },
      }),
      '/sync/pull': emptyPull,
      '/devices/number-blocks': blocks,
    });
    start();
    await engine.syncNow();
    const [ra, rb] = await env.database.sync_queue.orderBy('id').toArray();
    expect(ra).toMatchObject({ status: 'pending', retry_count: 1 });
    expect(ra!.next_attempt_at).toBeGreaterThan(Date.now());
    expect(rb).toMatchObject({ status: 'failed' });
    expect(rb!.last_error).toContain('Too high');
  });

  it('records conflicts for the Conflict Center', async () => {
    const product = await makeProduct(env);
    const op = (await env.database.sync_queue.toArray())[0]!;
    fakeServer({
      '/health': () => ({ json: { success: true } }),
      '/sync/push': () => ({ json: { success: true, accepted: [], rejected: [], conflicts: [{ operation_id: op.operation_id, entity_type: 'product', entity_id: product.id, conflict_id: uuidv7(), conflict_type: 'field', message: 'Edited on two devices', fields: [{ field: 'selling_price', base: 59, local: 65, server: 62 }], server_data: null }], server_changes: [] } }),
      '/sync/pull': emptyPull,
      '/devices/number-blocks': blocks,
    });
    start();
    await engine.syncNow();
    expect((await env.database.sync_queue.get(op.id!))!.status).toBe('conflict');
    const conflicts = await env.database.sync_conflicts.toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ entity_id: product.id, status: 'open' });
  });

  it('pulls pages of changes and advances the cursor', async () => {
    const categoryId = uuidv7();
    const change = (seq: number, name: string): SyncChange => ({ seq, entity_type: 'category', entity_id: categoryId, action: 'upsert', data: { id: categoryId, business_id: env.businessId, name, parent_id: null, color: null, sort_order: 0, active: true, version: seq, created_at: '', updated_at: '', deleted_at: null } });
    const server = fakeServer({
      '/health': () => ({ json: { success: true } }),
      '/sync/pull': (body) => (body.cursor === 0 ? { json: { success: true, changes: [change(5, 'Old')], cursor: 5, has_more: true, server_time: '' } } : { json: { success: true, changes: [change(9, 'New')], cursor: 9, has_more: false, server_time: '' } }),
      '/devices/number-blocks': blocks,
    });
    start();
    await engine.syncNow();
    expect(server.calls.filter((c) => c.path === '/sync/pull').map((c) => c.body.cursor)).toEqual([0, 5]);
    expect((await env.database.categories.get(categoryId))!.name).toBe('New');
    expect(await getMeta('cursor')).toBe(9);
  });

  it('reports an expired session without discarding work', async () => {
    await makeProduct(env);
    fakeServer({
      '/health': () => ({ json: { success: true } }),
      '/sync/push': () => ({ status: 401, json: { message: 'Unauthenticated.' } }),
    });
    start();
    await engine.syncNow();
    expect(useSyncStore.getState().status).toBe('auth');
    expect((await env.database.sync_queue.toArray())[0]!.status).toBe('pending');
  });

  it('stops and revokes local access when the user was removed from the business', async () => {
    await makeProduct(env);
    fakeServer({
      '/health': () => ({ json: { success: true } }),
      '/sync/push': () => ({ status: 403, json: { message: 'You do not have access to this business.', code: 'business_access_denied' } }),
    });
    const onAccessRevoked = vi.fn();
    engine.start({ database: env.database, businessId: env.businessId, deviceId: env.deviceId, ensureDevice: async () => {}, onAccessRevoked });
    await engine.syncNow();
    expect(onAccessRevoked).toHaveBeenCalled();
    expect(useSyncStore.getState().status).toBe('auth');
    // Unsynced work is never discarded.
    expect((await env.database.sync_queue.toArray())[0]!.status).toBe('pending');
  });

  it('sends the device secret with every device request', async () => {
    setApiContext({ deviceSecret: 'device-secret-123' });
    const seen: Array<string | null> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('X-Device-Secret'));
      return new Response(JSON.stringify({ success: true, changes: [], cursor: 0, has_more: false, data: [] }), { status: 200 });
    }));
    start();
    await engine.syncNow();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((h) => h === 'device-secret-123')).toBe(true);
    setApiContext({ deviceSecret: null });
  });
});

