import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import Modal from '../../components/Modal';
import Pagination from '../../components/Pagination';
import StatusBadge from '../../components/StatusBadge';
import { Spinner, ErrorAlert, EmptyState, extractErrorMessage } from '../../components/Feedback';
import { useAuth } from '../../context/AuthContext';

// Reversal is Management-only server-side (see backend sales.routes.js) -
// mirrored here only to hide the button for roles who'd get a 403 anyway.
const CAN_REVERSE = ['TENANT_ADMIN', 'MANAGER'];

export default function SalesHistory() {
  const { user } = useAuth();
  const canReverse = CAN_REVERSE.includes(user?.role);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewSale, setViewSale] = useState(null);
  const [reversingId, setReversingId] = useState(null);
  const pageSize = 20;

  function load() {
    setLoading(true);
    apiClient
      .get('/sales', { params: { page, pageSize, search: search || undefined, from: from || undefined, to: to || undefined } })
      .then((res) => {
        setItems(res.data.items);
        setTotal(res.data.total);
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page, search, from, to]);

  async function handleReverse(sale) {
    setReversingId(sale.id);
    setError('');
    setNotice('');
    try {
      await apiClient.post(`/sales/${sale.id}/reverse`);
      setNotice(`Invoice ${sale.invoiceNumber} reversed - stock has been restored.`);
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setReversingId(null);
    }
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Sales History</h4>
      </div>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <input
          className="form-control"
          style={{ maxWidth: 220 }}
          placeholder="Search invoice #..."
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <input
          type="date"
          className="form-control"
          style={{ maxWidth: 180 }}
          value={from}
          onChange={(e) => {
            setPage(1);
            setFrom(e.target.value);
          }}
        />
        <input
          type="date"
          className="form-control"
          style={{ maxWidth: 180 }}
          value={to}
          onChange={(e) => {
            setPage(1);
            setTo(e.target.value);
          }}
        />
      </div>

      {notice && <div className="alert alert-info py-2">{notice}</div>}
      <ErrorAlert message={error} />
      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState message="No sales found." />
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Cashier</th>
                  <th className="text-end">Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <button className="btn btn-link p-0" onClick={() => setViewSale(sale)}>
                        {sale.invoiceNumber}
                      </button>
                    </td>
                    <td>{new Date(sale.createdAt).toLocaleString()}</td>
                    <td>{sale.customer?.name || 'Walk-in'}</td>
                    <td>{sale.cashier?.name || '-'}</td>
                    <td className="text-end">{Number(sale.total).toFixed(2)}</td>
                    <td><StatusBadge status={sale.paymentStatus} /></td>
                    <td><StatusBadge status={sale.status} /></td>
                    <td>
                      {canReverse && sale.status === 'COMPLETED' && (
                        <button
                          className="btn btn-sm btn-outline-danger"
                          disabled={reversingId === sale.id}
                          onClick={() => handleReverse(sale)}
                        >
                          {reversingId === sale.id ? 'Reversing...' : 'Reverse'}
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

      <Modal show={!!viewSale} title={`Invoice ${viewSale?.invoiceNumber || ''}`} onClose={() => setViewSale(null)}>
        {viewSale && (
          <div>
            <p className="mb-1">
              <strong>Customer:</strong> {viewSale.customer?.name || 'Walk-in'}
            </p>
            <p className="mb-3">
              <strong>Cashier:</strong> {viewSale.cashier?.name || '-'}
            </p>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Qty</th>
                  <th className="text-end">Unit Price</th>
                  <th className="text-end">Discount</th>
                  <th className="text-end">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {viewSale.items.map((line) => (
                  <tr key={line.id}>
                    <td>{Number(line.quantity)}</td>
                    <td className="text-end">{Number(line.unitPrice).toFixed(2)}</td>
                    <td className="text-end">{Number(line.discount).toFixed(2)}</td>
                    <td className="text-end">{Number(line.lineTotal).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="d-flex justify-content-between">
              <span>Subtotal</span>
              <span>{Number(viewSale.subtotal).toFixed(2)}</span>
            </div>
            <div className="d-flex justify-content-between">
              <span>Discount</span>
              <span>{Number(viewSale.discount).toFixed(2)}</span>
            </div>
            <div className="d-flex justify-content-between">
              <span>Tax</span>
              <span>{Number(viewSale.tax).toFixed(2)}</span>
            </div>
            <hr />
            <div className="d-flex justify-content-between fw-bold">
              <span>Total</span>
              <span>{Number(viewSale.total).toFixed(2)}</span>
            </div>
            <div className="d-flex justify-content-between">
              <span>Amount Paid</span>
              <span>{Number(viewSale.amountPaid).toFixed(2)}</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
