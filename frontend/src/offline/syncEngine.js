import apiClient from '../api/client';
import { getOfflineDb } from './db';

// Phase 2 offline architecture, generalized in slice 2 beyond just Sales.
//
// Design (unchanged from slice 1, now shared across every offline-capable
// entity):
// - Every offline-capable create is written to its own local outbox table
//   first, then synced - the user never waits on the network to save it.
// - Each queued item carries a client-generated idempotencyKey, created once
//   at queue time and never regenerated, so a retried sync (after a dropped
//   connection mid-request) can never create a duplicate record. The server
//   enforces this via a @@unique([tenantId, idempotencyKey]) constraint on
//   every model that accepts one.
// - Conflicts are never auto-resolved. If the server rejects an item (4xx),
//   it's marked 'conflict' (409) or 'failed' (other 4xx) and left for a
//   human to review via the sync status UI - never silently dropped.
// - Each outbox drains sequentially, oldest first, so entities that check
//   server-side invariants (like Sales checking stock) see a consistent
//   order of events.
//
// Known limitation: an offline-created record (e.g. a new Customer) cannot
// yet be referenced by another offline-created record (e.g. a Sale for that
// customer) in the same offline session, because the real server ID doesn't
// exist until it syncs. Referencing already-existing (previously synced)
// customers/suppliers/products while offline works fine.

function generateClientId() {
  return crypto.randomUUID();
}

// Builds a full outbox (queue/list/sync/retry/discard) for one entity type.
// `applyOptimisticEffect(db, payload)` is optional - used by entities whose
// creation has a side effect on the product cache (Sales deduct stock,
// Purchases add it) so the POS/product views stay locally consistent between
// syncs.
function createOutbox({ tableName, apiPath, applyOptimisticEffect }) {
  async function queue(tenantId, payload) {
    const db = getOfflineDb(tenantId);
    const clientId = generateClientId();
    const entry = {
      clientId,
      status: 'pending',
      createdAt: Date.now(),
      payload: { ...payload, idempotencyKey: payload.idempotencyKey || clientId },
      lastError: null,
      serverResult: null,
    };

    await db.transaction('rw', db[tableName], db.products, async () => {
      await db[tableName].add(entry);
      if (applyOptimisticEffect) await applyOptimisticEffect(db, entry.payload);
    });

    return entry;
  }

  async function listPending(tenantId) {
    return getOfflineDb(tenantId)[tableName].orderBy('createdAt').toArray();
  }

  // Scoped to this outbox's closure, so concurrent callers (the reconnect
  // listener, the mount effect, and a manual "Sync Now" click all firing at
  // once) share the same in-flight promise instead of racing two drains of
  // the same table. Keyed by tenantId - not just a single shared promise -
  // so a sync for one tenant can never be handed back as the result for a
  // different tenant's sync call (e.g. if the active tenant changes without
  // a full page reload).
  const inFlightPromises = new Map();
  function sync(tenantId) {
    if (inFlightPromises.has(tenantId)) return inFlightPromises.get(tenantId);
    const promise = runSync(tenantId).finally(() => {
      inFlightPromises.delete(tenantId);
    });
    inFlightPromises.set(tenantId, promise);
    return promise;
  }

  async function runSync(tenantId) {
    const db = getOfflineDb(tenantId);
    const queueItems = await db[tableName].where('status').equals('pending').sortBy('createdAt');

    for (const entry of queueItems) {
      await db[tableName].update(entry.clientId, { status: 'syncing' });
      try {
        const { data } = await apiClient.post(apiPath, entry.payload);
        await db[tableName].update(entry.clientId, { status: 'synced', serverResult: data.item });
      } catch (err) {
        if (err.response?.status === 409) {
          await db[tableName].update(entry.clientId, {
            status: 'conflict',
            lastError: err.response.data?.error || 'Conflict at sync time',
          });
          continue; // one conflict shouldn't block the rest of the queue
        }
        if (err.response?.status >= 400 && err.response?.status < 500) {
          await db[tableName].update(entry.clientId, {
            status: 'failed',
            lastError: err.response.data?.error || 'Rejected by server',
          });
          continue;
        }
        // Network error or 5xx - stop draining, retry everything from here
        // (inclusive) on the next sync attempt.
        await db[tableName].update(entry.clientId, { status: 'pending' });
        return;
      }
    }

    await db.meta.put({ key: `lastSyncAt:${tableName}`, value: Date.now() });
  }

  async function retry(tenantId, clientId) {
    await getOfflineDb(tenantId)[tableName].update(clientId, { status: 'pending', lastError: null });
    return sync(tenantId);
  }

  async function discard(tenantId, clientId) {
    await getOfflineDb(tenantId)[tableName].delete(clientId);
  }

  // Convenience for form submit handlers: queue, then - if online - attempt
  // to sync immediately and return the final state (synced/conflict/failed)
  // rather than making every caller re-implement that sequence.
  async function submit(tenantId, payload) {
    const entry = await queue(tenantId, payload);
    if (navigator.onLine) {
      await sync(tenantId);
      return getOfflineDb(tenantId)[tableName].get(entry.clientId);
    }
    return entry;
  }

  return { queue, listPending, sync, retry, discard, submit };
}

// Builds an outbox for an action against an *existing* server record (e.g.
// reversing a sale), as opposed to createOutbox() which queues creation of a
// new one. Differs from createOutbox in three ways: no idempotencyKey is
// injected (the request has no body - the server identifies the target by
// ID in the URL and the action is naturally safe to not-retry once synced),
// no optimistic local effect is applied (the entity being acted on isn't
// cached locally by this engine), and the request path is built per-entry
// from its payload rather than fixed.
function createActionOutbox({ tableName, buildPath }) {
  async function queue(tenantId, payload) {
    const db = getOfflineDb(tenantId);
    const clientId = generateClientId();
    const entry = { clientId, status: 'pending', createdAt: Date.now(), payload, lastError: null, serverResult: null };
    await db[tableName].add(entry);
    return entry;
  }

  async function listPending(tenantId) {
    return getOfflineDb(tenantId)[tableName].orderBy('createdAt').toArray();
  }

  const inFlightPromises = new Map();
  function sync(tenantId) {
    if (inFlightPromises.has(tenantId)) return inFlightPromises.get(tenantId);
    const promise = runSync(tenantId).finally(() => {
      inFlightPromises.delete(tenantId);
    });
    inFlightPromises.set(tenantId, promise);
    return promise;
  }

  async function runSync(tenantId) {
    const db = getOfflineDb(tenantId);
    const queueItems = await db[tableName].where('status').equals('pending').sortBy('createdAt');

    for (const entry of queueItems) {
      await db[tableName].update(entry.clientId, { status: 'syncing' });
      try {
        const { data } = await apiClient.post(buildPath(entry.payload));
        await db[tableName].update(entry.clientId, { status: 'synced', serverResult: data.item });
      } catch (err) {
        if (err.response?.status === 409) {
          await db[tableName].update(entry.clientId, {
            status: 'conflict',
            lastError: err.response.data?.error || 'Conflict at sync time',
          });
          continue;
        }
        if (err.response?.status >= 400 && err.response?.status < 500) {
          await db[tableName].update(entry.clientId, {
            status: 'failed',
            lastError: err.response.data?.error || 'Rejected by server',
          });
          continue;
        }
        await db[tableName].update(entry.clientId, { status: 'pending' });
        return;
      }
    }

    await db.meta.put({ key: `lastSyncAt:${tableName}`, value: Date.now() });
  }

  async function retry(tenantId, clientId) {
    await getOfflineDb(tenantId)[tableName].update(clientId, { status: 'pending', lastError: null });
    return sync(tenantId);
  }

  async function discard(tenantId, clientId) {
    await getOfflineDb(tenantId)[tableName].delete(clientId);
  }

  async function submit(tenantId, payload) {
    const entry = await queue(tenantId, payload);
    if (navigator.onLine) {
      await sync(tenantId);
      return getOfflineDb(tenantId)[tableName].get(entry.clientId);
    }
    return entry;
  }

  return { queue, listPending, sync, retry, discard, submit };
}

async function decrementCachedStock(db, payload) {
  for (const line of payload.items) {
    const product = await db.products.get(line.productId);
    if (product) {
      await db.products.update(line.productId, {
        stockQuantity: Number(product.stockQuantity) - Number(line.quantity),
      });
    }
  }
}

async function incrementCachedStockIfReceiving(db, payload) {
  if (!payload.receiveImmediately) return;
  for (const line of payload.items) {
    const product = await db.products.get(line.productId);
    if (product) {
      await db.products.update(line.productId, {
        stockQuantity: Number(product.stockQuantity) + Number(line.quantity),
      });
    }
  }
}

const salesOutbox = createOutbox({ tableName: 'pendingSales', apiPath: '/sales', applyOptimisticEffect: decrementCachedStock });
const purchasesOutbox = createOutbox({
  tableName: 'pendingPurchases',
  apiPath: '/purchases',
  applyOptimisticEffect: incrementCachedStockIfReceiving,
});
const expensesOutbox = createOutbox({ tableName: 'pendingExpenses', apiPath: '/expenses' });
const customersOutbox = createOutbox({ tableName: 'pendingCustomers', apiPath: '/customers' });
const suppliersOutbox = createOutbox({ tableName: 'pendingSuppliers', apiPath: '/suppliers' });
const opticalOrdersOutbox = createOutbox({ tableName: 'pendingOpticalOrders', apiPath: '/optical-orders' });
const reversalsOutbox = createActionOutbox({
  tableName: 'pendingReversals',
  buildPath: (payload) => `/sales/${payload.saleId}/reverse`,
});

export const OUTBOXES = {
  sales: salesOutbox,
  purchases: purchasesOutbox,
  expenses: expensesOutbox,
  customers: customersOutbox,
  suppliers: suppliersOutbox,
  opticalOrders: opticalOrdersOutbox,
  reversals: reversalsOutbox,
};

// Backwards-compatible named exports (slice 1 API surface, used by Pos.jsx).
export const queueSale = salesOutbox.queue;
export const listPendingSales = salesOutbox.listPending;
export const syncPendingSales = salesOutbox.sync;
export const retryPendingSale = salesOutbox.retry;
export const discardPendingSale = salesOutbox.discard;

// Runs every entity's outbox. Safe to call opportunistically (on reconnect,
// on mount, or from a manual "Sync Now") - each outbox no-ops if its queue
// is empty.
export async function syncAll(tenantId) {
  await Promise.all(Object.values(OUTBOXES).map((outbox) => outbox.sync(tenantId)));
}

export async function refreshCaches(tenantId) {
  const db = getOfflineDb(tenantId);
  const [productsRes, customersRes, suppliersRes, expenseCategoriesRes] = await Promise.all([
    apiClient.get('/products', { params: { pageSize: 500 } }),
    apiClient.get('/customers', { params: { pageSize: 500 } }),
    apiClient.get('/suppliers', { params: { pageSize: 500 } }),
    apiClient.get('/expense-categories', { params: { pageSize: 200 } }),
  ]);
  await db.transaction('rw', db.products, db.customers, db.suppliers, db.expenseCategories, db.meta, async () => {
    await db.products.clear();
    await db.products.bulkPut(productsRes.data.items);
    await db.customers.clear();
    await db.customers.bulkPut(customersRes.data.items);
    await db.suppliers.clear();
    await db.suppliers.bulkPut(suppliersRes.data.items);
    await db.expenseCategories.clear();
    await db.expenseCategories.bulkPut(expenseCategoriesRes.data.items);
    await db.meta.put({ key: 'lastCacheRefresh', value: Date.now() });
  });
}

export async function getCachedProducts(tenantId) {
  return getOfflineDb(tenantId).products.toArray();
}

export async function getCachedCustomers(tenantId) {
  return getOfflineDb(tenantId).customers.toArray();
}

export async function getCachedSuppliers(tenantId) {
  return getOfflineDb(tenantId).suppliers.toArray();
}

export async function getCachedExpenseCategories(tenantId) {
  return getOfflineDb(tenantId).expenseCategories.toArray();
}
