import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getOfflineDb } from './db';

// Reactive read from the local cache - re-renders automatically whenever the
// underlying IndexedDB table changes (optimistic stock decrement, a sync
// completing, or a fresh refreshCaches() pull), so the POS screen never shows
// a stale number just because it hasn't been told to re-fetch.
function useLiveTable(tenantId, tableName) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!tenantId) return undefined;
    const db = getOfflineDb(tenantId);
    const subscription = liveQuery(() => db[tableName].toArray()).subscribe({
      next: setRows,
      error: (err) => console.error(`Live query on ${tableName} failed:`, err),
    });
    return () => subscription.unsubscribe();
  }, [tenantId, tableName]);

  return rows;
}

export function useLiveProducts(tenantId) {
  return useLiveTable(tenantId, 'products');
}

export function useLiveCustomers(tenantId) {
  return useLiveTable(tenantId, 'customers');
}

export function useLiveSuppliers(tenantId) {
  return useLiveTable(tenantId, 'suppliers');
}

export function useLiveExpenseCategories(tenantId) {
  return useLiveTable(tenantId, 'expenseCategories');
}
