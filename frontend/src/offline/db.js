import Dexie from 'dexie';

// Local offline store. Scoped per tenant (tenantId in the DB name) so switching
// accounts on the same device/browser never mixes one shop's cached data or
// queued records with another's.
let dbInstance = null;
let currentTenantId = null;

export function getOfflineDb(tenantId) {
  if (dbInstance && currentTenantId === tenantId) return dbInstance;
  if (dbInstance) dbInstance.close();

  const db = new Dexie(`akvf_offline_${tenantId}`);

  // v1: Phase 2 slice 1 - offline POS/Sales only.
  db.version(1).stores({
    products: 'id, name, sku, barcode',
    customers: 'id, name',
    pendingSales: 'clientId, status, createdAt',
    meta: 'key',
  });

  // v2: Phase 2 slice 2 - extends offline creation to Purchases, Expenses,
  // Customers, Suppliers, and Optical Orders. Every "pending*" table shares
  // the same shape (clientId, status, createdAt, payload, lastError,
  // serverResult) so they can all be driven by the same generic outbox logic
  // in syncEngine.js - see createOutbox().
  db.version(2).stores({
    products: 'id, name, sku, barcode',
    customers: 'id, name',
    suppliers: 'id, name',
    expenseCategories: 'id, name',
    pendingSales: 'clientId, status, createdAt',
    pendingPurchases: 'clientId, status, createdAt',
    pendingExpenses: 'clientId, status, createdAt',
    pendingCustomers: 'clientId, status, createdAt',
    pendingSuppliers: 'clientId, status, createdAt',
    pendingOpticalOrders: 'clientId, status, createdAt',
    meta: 'key',
  });

  dbInstance = db;
  currentTenantId = tenantId;
  return db;
}
