import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from '../api/client';
import { OUTBOXES, syncAll } from './syncEngine';
import { getOfflineDb } from './db';

// The sync engine's correctness lives entirely in how it drains outboxes
// against the network, so the network (apiClient) is the only thing mocked -
// everything else (Dexie/IndexedDB) runs for real via fake-indexeddb.
vi.mock('../api/client', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

// A fresh tenantId per test gives each one its own IndexedDB database, so
// tests never see each other's queued/synced records.
function freshTenantId() {
  return crypto.randomUUID();
}

const saleItem = { items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }] };

beforeEach(() => {
  apiClient.post.mockReset();
  apiClient.get.mockReset();
});

describe('outbox: queue', () => {
  it('assigns a client-generated idempotency key when none is provided', async () => {
    const tenantId = freshTenantId();
    const entry = await OUTBOXES.sales.queue(tenantId, saleItem);
    expect(entry.payload.idempotencyKey).toBe(entry.clientId);
    expect(entry.status).toBe('pending');
  });

  it('keeps a caller-supplied idempotency key instead of overwriting it', async () => {
    const tenantId = freshTenantId();
    const entry = await OUTBOXES.sales.queue(tenantId, { ...saleItem, idempotencyKey: 'explicit-key' });
    expect(entry.payload.idempotencyKey).toBe('explicit-key');
  });
});

describe('outbox: sync success path', () => {
  it('marks the entry synced and stores the server result', async () => {
    const tenantId = freshTenantId();
    apiClient.post.mockResolvedValueOnce({ data: { item: { id: 'server-1', invoiceNumber: 'INV-000001' } } });

    const entry = await OUTBOXES.sales.queue(tenantId, saleItem);
    await OUTBOXES.sales.sync(tenantId);

    const stored = await getOfflineDb(tenantId).pendingSales.get(entry.clientId);
    expect(stored.status).toBe('synced');
    expect(stored.serverResult.invoiceNumber).toBe('INV-000001');
    expect(apiClient.post).toHaveBeenCalledWith('/sales', expect.objectContaining({ idempotencyKey: entry.clientId }));
  });
});

describe('outbox: idempotency across retries', () => {
  it('never regenerates the idempotency key when a sync attempt is retried', async () => {
    const tenantId = freshTenantId();
    const entry = await OUTBOXES.sales.queue(tenantId, saleItem);

    // First attempt: network failure - should stay pending, not consume the key.
    apiClient.post.mockRejectedValueOnce(new TypeError('network down'));
    await OUTBOXES.sales.sync(tenantId);
    let stored = await getOfflineDb(tenantId).pendingSales.get(entry.clientId);
    expect(stored.status).toBe('pending');
    expect(stored.payload.idempotencyKey).toBe(entry.clientId);

    // Second attempt: succeeds - the exact same key must be sent again.
    apiClient.post.mockResolvedValueOnce({ data: { item: { id: 'server-2' } } });
    await OUTBOXES.sales.sync(tenantId);
    stored = await getOfflineDb(tenantId).pendingSales.get(entry.clientId);
    expect(stored.status).toBe('synced');
    expect(stored.payload.idempotencyKey).toBe(entry.clientId);
    expect(apiClient.post).toHaveBeenLastCalledWith('/sales', expect.objectContaining({ idempotencyKey: entry.clientId }));
  });
});

describe('outbox: conflict handling', () => {
  it('marks a 409 as conflict with the server message, and keeps draining the rest of the queue', async () => {
    const tenantId = freshTenantId();
    const entry1 = await OUTBOXES.sales.queue(tenantId, saleItem);
    const entry2 = await OUTBOXES.sales.queue(tenantId, { items: [{ productId: 'p2', quantity: 1, unitPrice: 5 }] });

    apiClient.post
      .mockRejectedValueOnce({ response: { status: 409, data: { error: 'Insufficient stock for Widget (available: 0)' } } })
      .mockResolvedValueOnce({ data: { item: { id: 'server-2' } } });

    await OUTBOXES.sales.sync(tenantId);

    const db = getOfflineDb(tenantId);
    const stored1 = await db.pendingSales.get(entry1.clientId);
    const stored2 = await db.pendingSales.get(entry2.clientId);
    expect(stored1.status).toBe('conflict');
    expect(stored1.lastError).toBe('Insufficient stock for Widget (available: 0)');
    // A conflict on one item must never block the rest of the queue.
    expect(stored2.status).toBe('synced');
    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });

  it('marks a non-409 4xx as failed rather than conflict', async () => {
    const tenantId = freshTenantId();
    const entry = await OUTBOXES.sales.queue(tenantId, saleItem);
    apiClient.post.mockRejectedValueOnce({ response: { status: 422, data: { error: 'Invalid sale data' } } });

    await OUTBOXES.sales.sync(tenantId);

    const stored = await getOfflineDb(tenantId).pendingSales.get(entry.clientId);
    expect(stored.status).toBe('failed');
    expect(stored.lastError).toBe('Invalid sale data');
  });

  it('never auto-resolves a conflict - it stays until retry or discard', async () => {
    const tenantId = freshTenantId();
    const entry = await OUTBOXES.sales.queue(tenantId, saleItem);
    apiClient.post.mockRejectedValueOnce({ response: { status: 409, data: { error: 'conflict' } } });
    await OUTBOXES.sales.sync(tenantId);

    // Calling sync again (e.g. a later reconnect) must not touch a conflicted item.
    await OUTBOXES.sales.sync(tenantId);
    const stored = await getOfflineDb(tenantId).pendingSales.get(entry.clientId);
    expect(stored.status).toBe('conflict');
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });
});

describe('outbox: network failure stops the drain', () => {
  it('leaves the failed item and everything after it pending, without attempting later items', async () => {
    const tenantId = freshTenantId();
    const entry1 = await OUTBOXES.sales.queue(tenantId, saleItem);
    const entry2 = await OUTBOXES.sales.queue(tenantId, { items: [{ productId: 'p2', quantity: 1, unitPrice: 5 }] });

    apiClient.post.mockRejectedValueOnce(new TypeError('network down'));
    await OUTBOXES.sales.sync(tenantId);

    expect(apiClient.post).toHaveBeenCalledTimes(1); // second item never attempted
    const db = getOfflineDb(tenantId);
    expect((await db.pendingSales.get(entry1.clientId)).status).toBe('pending');
    expect((await db.pendingSales.get(entry2.clientId)).status).toBe('pending');
  });
});

describe('outbox: retry and discard', () => {
  it('retry resets a conflicted item to pending and re-attempts the sync', async () => {
    const tenantId = freshTenantId();
    const entry = await OUTBOXES.sales.queue(tenantId, saleItem);
    apiClient.post.mockRejectedValueOnce({ response: { status: 409, data: { error: 'conflict' } } });
    await OUTBOXES.sales.sync(tenantId);

    apiClient.post.mockResolvedValueOnce({ data: { item: { id: 'server-3' } } });
    await OUTBOXES.sales.retry(tenantId, entry.clientId);

    const stored = await getOfflineDb(tenantId).pendingSales.get(entry.clientId);
    expect(stored.status).toBe('synced');
  });

  it('discard permanently removes the item', async () => {
    const tenantId = freshTenantId();
    const entry = await OUTBOXES.sales.queue(tenantId, saleItem);
    apiClient.post.mockRejectedValueOnce({ response: { status: 409, data: { error: 'conflict' } } });
    await OUTBOXES.sales.sync(tenantId);

    await OUTBOXES.sales.discard(tenantId, entry.clientId);
    expect(await getOfflineDb(tenantId).pendingSales.get(entry.clientId)).toBeUndefined();
  });
});

describe('optimistic cache effects', () => {
  it('sales queue decrements cached product stock immediately', async () => {
    const tenantId = freshTenantId();
    const db = getOfflineDb(tenantId);
    await db.products.put({ id: 'p1', name: 'Widget', stockQuantity: 10 });

    await OUTBOXES.sales.queue(tenantId, { items: [{ productId: 'p1', quantity: 3, unitPrice: 5 }] });

    expect((await db.products.get('p1')).stockQuantity).toBe(7);
  });

  it('purchases only increment cached stock when receiveImmediately is true', async () => {
    const tenantId = freshTenantId();
    const db = getOfflineDb(tenantId);
    await db.products.put({ id: 'p1', name: 'Widget', stockQuantity: 10 });

    await OUTBOXES.purchases.queue(tenantId, {
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 5, unitCost: 2 }],
      receiveImmediately: false,
    });
    expect((await db.products.get('p1')).stockQuantity).toBe(10);

    await OUTBOXES.purchases.queue(tenantId, {
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 5, unitCost: 2 }],
      receiveImmediately: true,
    });
    expect((await db.products.get('p1')).stockQuantity).toBe(15);
  });
});

describe('syncAll', () => {
  it('drains every entity outbox for the given tenant independently', async () => {
    const tenantId = freshTenantId();
    apiClient.post.mockResolvedValue({ data: { item: { id: 'x' } } });

    await OUTBOXES.sales.queue(tenantId, saleItem);
    await OUTBOXES.expenses.queue(tenantId, { categoryId: 'c1', amount: 50 });

    await syncAll(tenantId);

    const db = getOfflineDb(tenantId);
    expect((await db.pendingSales.toArray())[0].status).toBe('synced');
    expect((await db.pendingExpenses.toArray())[0].status).toBe('synced');
  });

  it('a conflict in one entity does not block another entity from syncing', async () => {
    const tenantId = freshTenantId();
    apiClient.post.mockImplementation((path) => {
      if (path === '/sales') return Promise.reject({ response: { status: 409, data: { error: 'conflict' } } });
      return Promise.resolve({ data: { item: { id: 'x' } } });
    });

    await OUTBOXES.sales.queue(tenantId, saleItem);
    await OUTBOXES.expenses.queue(tenantId, { categoryId: 'c1', amount: 50 });

    await syncAll(tenantId);

    const db = getOfflineDb(tenantId);
    expect((await db.pendingSales.toArray())[0].status).toBe('conflict');
    expect((await db.pendingExpenses.toArray())[0].status).toBe('synced');
  });
});
