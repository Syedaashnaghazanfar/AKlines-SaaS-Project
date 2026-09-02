import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getOfflineDb } from './db';

const ENTITY_TABLES = [
  { key: 'sales', tableName: 'pendingSales', label: 'Sale' },
  { key: 'purchases', tableName: 'pendingPurchases', label: 'Purchase' },
  { key: 'expenses', tableName: 'pendingExpenses', label: 'Expense' },
  { key: 'customers', tableName: 'pendingCustomers', label: 'Customer' },
  { key: 'suppliers', tableName: 'pendingSuppliers', label: 'Supplier' },
  { key: 'opticalOrders', tableName: 'pendingOpticalOrders', label: 'Optical Order' },
];

// Reactively reflects every offline outbox combined, so the sync status
// widget updates immediately whenever anything is queued or synced anywhere
// in the app, without polling.
export function useSyncStatus(tenantId) {
  const [state, setState] = useState({ pendingCount: 0, conflictCount: 0, lastSyncAt: null, items: [] });

  useEffect(() => {
    if (!tenantId) return undefined;
    const db = getOfflineDb(tenantId);

    const subscription = liveQuery(async () => {
      const perEntity = await Promise.all(
        ENTITY_TABLES.map(async ({ key, tableName, label }) => {
          const rows = await db[tableName].orderBy('createdAt').reverse().toArray();
          return rows.map((row) => ({ ...row, entityKey: key, entityLabel: label }));
        })
      );
      const items = perEntity.flat().sort((a, b) => b.createdAt - a.createdAt);

      const lastSyncTimestamps = await Promise.all(
        ENTITY_TABLES.map(({ tableName }) => db.meta.get(`lastSyncAt:${tableName}`))
      );
      const lastSyncAt = lastSyncTimestamps.reduce((max, row) => (row?.value && row.value > max ? row.value : max), null);

      return {
        items,
        pendingCount: items.filter((i) => i.status === 'pending' || i.status === 'syncing').length,
        conflictCount: items.filter((i) => i.status === 'conflict').length,
        lastSyncAt,
      };
    }).subscribe({
      next: setState,
      error: (err) => console.error('Sync status live query failed:', err),
    });

    return () => subscription.unsubscribe();
  }, [tenantId]);

  return state;
}
