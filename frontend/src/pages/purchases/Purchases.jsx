import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import Modal from '../../components/Modal';
import Pagination from '../../components/Pagination';
import StatusBadge from '../../components/StatusBadge';
import { Spinner, ErrorAlert, EmptyState, extractErrorMessage } from '../../components/Feedback';
import { useAuth } from '../../context/AuthContext';
import { OUTBOXES, refreshCaches } from '../../offline/syncEngine';
import { useLiveProducts, useLiveSuppliers } from '../../offline/useOfflineData';

export default function Purchases() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const suppliers = useLiveSuppliers(tenantId);
  const products = useLiveProducts(tenantId);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState([{ productId: '', quantity: 1, unitCost: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [amountPaid, setAmountPaid] = useState(0);
  const [receiveImmediately, setReceiveImmediately] = useState(true);
  const [saving, setSaving] = useState(false);

  const pageSize = 20;

  function load() {
    setLoading(true);
    apiClient
      .get('/purchases', { params: { page, pageSize } })
      .then((res) => {
        setItems(res.data.items);
        setTotal(res.data.total);
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]);
  useEffect(() => {
    if (tenantId && navigator.onLine) {
      refreshCaches(tenantId).catch((err) => console.warn('Could not refresh offline cache:', err));
    }
  }, [tenantId]);

  function updateLine(idx, field, value) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { productId: '', quantity: 1, unitCost: 0 }]);
  }
  function removeLine(idx) {
    setLines((ls) => ls.filter((_, i) => i !== idx));
  }

  const subtotal = lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unitCost || 0), 0);
  const total_ = Math.max(subtotal - Number(discount || 0), 0);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const entry = await OUTBOXES.purchases.submit(tenantId, {
        supplierId,
        items: lines
          .filter((l) => l.productId)
          .map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
        discount: Number(discount),
        amountPaid: Number(amountPaid),
        receiveImmediately,
      });
      if (entry.status === 'conflict' || entry.status === 'failed') {
        setError(`Could not save purchase: ${entry.lastError}`);
        return;
      }
      setShowModal(false);
      setSupplierId('');
      setLines([{ productId: '', quantity: 1, unitCost: 0 }]);
      setDiscount(0);
      setAmountPaid(0);
      if (entry.status === 'synced') {
        setPage(1);
        load();
      } else {
        setNotice("Saved on this device - will appear in the list once it's synced (you're offline).");
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function receive(id) {
    try {
      await apiClient.post(`/purchases/${id}/receive`);
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Purchases</h4>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + New Purchase
        </button>
      </div>

      {notice && <div className="alert alert-info py-2">{notice}</div>}
      <ErrorAlert message={error} />
      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState message="No purchases yet." />
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th className="text-end">Total</th>
                  <th className="text-end">Paid</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.purchaseNumber}</td>
                    <td>{p.supplier?.name}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td><StatusBadge status={p.paymentStatus} /></td>
                    <td className="text-end">{Number(p.total).toFixed(2)}</td>
                    <td className="text-end">{Number(p.amountPaid).toFixed(2)}</td>
                    <td>
                      {p.status === 'DRAFT' && (
                        <button className="btn btn-sm btn-outline-success" onClick={() => receive(p.id)}>
                          Receive Stock
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-footer">
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        </div>
      )}

      <Modal
        show={showModal}
        title="New Purchase"
        size="lg"
        onClose={() => setShowModal(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving || !supplierId} onClick={handleSave}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSave}>
          <div className="mb-2">
            <label className="form-label">Supplier</label>
            <select className="form-select" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <label className="form-label">Items</label>
          {lines.map((line, idx) => (
            <div className="row g-2 mb-2" key={idx}>
              <div className="col-5">
                <select className="form-select" value={line.productId} onChange={(e) => updateLine(idx, 'productId', e.target.value)}>
                  <option value="">Select product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-3">
                <input type="number" min="0.01" step="0.01" className="form-control" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', e.target.value)} />
              </div>
              <div className="col-3">
                <input type="number" min="0" step="0.01" className="form-control" placeholder="Unit Cost" value={line.unitCost} onChange={(e) => updateLine(idx, 'unitCost', e.target.value)} />
              </div>
              <div className="col-1">
                <button type="button" className="btn btn-outline-danger" onClick={() => removeLine(idx)}>
                  &times;
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={addLine}>
            + Add Line
          </button>

          <div className="row g-2">
            <div className="col-md-4">
              <label className="form-label">Discount</label>
              <input type="number" min="0" step="0.01" className="form-control" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Amount Paid Now</label>
              <input type="number" min="0" step="0.01" className="form-control" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
            </div>
            <div className="col-md-4 d-flex align-items-end">
              <div className="form-check">
                <input className="form-check-input" type="checkbox" id="receiveNow" checked={receiveImmediately} onChange={(e) => setReceiveImmediately(e.target.checked)} />
                <label className="form-check-label" htmlFor="receiveNow">
                  Receive stock immediately
                </label>
              </div>
            </div>
          </div>

          <div className="text-end mt-3">
            <div>Subtotal: {subtotal.toFixed(2)}</div>
            <div className="fw-bold">Total: {total_.toFixed(2)}</div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
