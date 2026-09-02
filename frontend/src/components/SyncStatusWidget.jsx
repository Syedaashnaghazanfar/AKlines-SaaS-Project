import { useState } from 'react';
import { useSyncStatus } from '../offline/useSyncStatus';
import { syncAll, OUTBOXES } from '../offline/syncEngine';
import Modal from './Modal';

function formatLastSync(ts) {
  if (!ts) return 'never';
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Date(ts).toLocaleString();
}

// Each entity's queued payload has a different shape - this renders a short,
// human-readable summary for the sync queue table.
function summarize(item) {
  const p = item.payload;
  switch (item.entityKey) {
    case 'sales':
    case 'purchases': {
      const total = p.items.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice ?? l.unitCost), 0);
      return `${p.items.length} item(s), $${total.toFixed(2)}`;
    }
    case 'expenses':
      return `$${Number(p.amount).toFixed(2)}`;
    case 'customers':
    case 'suppliers':
      return p.name;
    case 'opticalOrders':
      return `$${Number(p.totalAmount || 0).toFixed(2)}`;
    case 'reversals':
      return `Invoice ${p.invoiceNumber}`;
    default:
      return '';
  }
}

export default function SyncStatusWidget({ tenantId, online }) {
  const { pendingCount, conflictCount, lastSyncAt, items } = useSyncStatus(tenantId);
  const [showPanel, setShowPanel] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function handleSyncNow() {
    setSyncing(true);
    try {
      await syncAll(tenantId);
    } finally {
      setSyncing(false);
    }
  }

  const hasQueue = items.length > 0;

  return (
    <>
      <div className="d-flex align-items-center gap-2">
        <span className={`badge text-bg-${online ? 'success' : 'danger'}`}>{online ? 'Online' : 'Offline'}</span>
        {hasQueue && (
          <button
            type="button"
            className={`badge border-0 text-bg-${conflictCount > 0 ? 'danger' : pendingCount > 0 ? 'warning' : 'secondary'}`}
            onClick={() => setShowPanel(true)}
            title="View sync queue"
          >
            {pendingCount > 0 && `${pendingCount} pending`}
            {pendingCount > 0 && conflictCount > 0 && ' · '}
            {conflictCount > 0 && `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`}
            {pendingCount === 0 && conflictCount === 0 && 'synced'}
          </button>
        )}
      </div>

      <Modal
        show={showPanel}
        title="Offline Sync Queue"
        onClose={() => setShowPanel(false)}
        size="lg"
        footer={
          <>
            <span className="text-body-secondary small me-auto">Last synced: {formatLastSync(lastSyncAt)}</span>
            <button className="btn btn-secondary" onClick={() => setShowPanel(false)}>
              Close
            </button>
            <button className="btn btn-primary" disabled={!online || syncing} onClick={handleSyncNow}>
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </>
        }
      >
        {!online && (
          <div className="alert alert-warning py-2">
            You're offline. Records created now are saved on this device and will sync automatically once you're back
            online.
          </div>
        )}
        {items.length === 0 && <p className="text-body-secondary">No queued records.</p>}
        {items.length > 0 && (
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th>Type</th>
                <th>Queued</th>
                <th>Summary</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.entityKey}-${item.clientId}`}>
                  <td>{item.entityLabel}</td>
                  <td>{new Date(item.createdAt).toLocaleTimeString()}</td>
                  <td>{summarize(item)}</td>
                  <td>
                    {item.status === 'conflict' ? (
                      <span className="badge text-bg-danger" title={item.lastError}>
                        Conflict
                      </span>
                    ) : item.status === 'failed' ? (
                      <span className="badge text-bg-danger" title={item.lastError}>
                        Failed
                      </span>
                    ) : item.status === 'synced' ? (
                      <span className="badge text-bg-success">Synced</span>
                    ) : item.status === 'syncing' ? (
                      <span className="badge text-bg-info">Syncing...</span>
                    ) : (
                      <span className="badge text-bg-warning">Pending</span>
                    )}
                    {(item.status === 'conflict' || item.status === 'failed') && (
                      <div className="small text-danger mt-1">{item.lastError}</div>
                    )}
                  </td>
                  <td>
                    {(item.status === 'conflict' || item.status === 'failed') && (
                      <div className="d-flex gap-1">
                        <button
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => OUTBOXES[item.entityKey].retry(tenantId, item.clientId)}
                        >
                          Retry
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => OUTBOXES[item.entityKey].discard(tenantId, item.clientId)}
                        >
                          Discard
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </>
  );
}
