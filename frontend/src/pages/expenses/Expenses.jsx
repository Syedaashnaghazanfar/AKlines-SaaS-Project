import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import Modal from '../../components/Modal';
import Pagination from '../../components/Pagination';
import { Spinner, ErrorAlert, EmptyState, extractErrorMessage } from '../../components/Feedback';
import { useAuth } from '../../context/AuthContext';
import { OUTBOXES, refreshCaches } from '../../offline/syncEngine';
import { useLiveExpenseCategories } from '../../offline/useOfflineData';

export default function Expenses() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const categories = useLiveExpenseCategories(tenantId);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [form, setForm] = useState({ categoryId: '', amount: '', description: '', expenseDate: '' });
  const [saving, setSaving] = useState(false);

  const pageSize = 20;

  function load() {
    setLoading(true);
    apiClient
      .get('/expenses', { params: { page, pageSize } })
      .then((res) => {
        setItems(res.data.items);
        setTotal(res.data.total);
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]);

  // Populate/refresh the offline category cache so the expense form's
  // dropdown works even without connectivity.
  useEffect(() => {
    if (tenantId && navigator.onLine) {
      refreshCaches(tenantId).catch((err) => console.warn('Could not refresh offline cache:', err));
    }
  }, [tenantId]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const entry = await OUTBOXES.expenses.submit(tenantId, {
        categoryId: form.categoryId,
        amount: Number(form.amount),
        description: form.description || undefined,
        expenseDate: form.expenseDate || undefined,
      });
      if (entry.status === 'conflict' || entry.status === 'failed') {
        setError(`Could not save expense: ${entry.lastError}`);
        return;
      }
      setShowModal(false);
      setForm({ categoryId: '', amount: '', description: '', expenseDate: '' });
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

  // Expense categories are lightweight master data managed online-only for
  // now (they aren't in the Phase 2 offline-creation scope) - the expense
  // record itself is what needs to work offline.
  async function handleSaveCategory(e) {
    e.preventDefault();
    try {
      await apiClient.post('/expense-categories', { name: newCatName });
      setNewCatName('');
      setShowCatModal(false);
      await refreshCaches(tenantId);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Expenses</h4>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary" onClick={() => setShowCatModal(true)}>
            + Category
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + New Expense
          </button>
        </div>
      </div>

      {notice && <div className="alert alert-info py-2">{notice}</div>}
      <ErrorAlert message={error} />
      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState message="No expenses recorded yet." />
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th className="text-end">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.expenseDate).toLocaleDateString()}</td>
                    <td>{e.category?.name}</td>
                    <td>{e.description}</td>
                    <td className="text-end">{Number(e.amount).toFixed(2)}</td>
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
        title="New Expense"
        onClose={() => setShowModal(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving || !form.categoryId} onClick={handleSave}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSave}>
          <div className="mb-2">
            <label className="form-label">Category</label>
            <select className="form-select" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Select category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-2">
            <label className="form-label">Amount</label>
            <input type="number" min="0.01" step="0.01" className="form-control" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="mb-2">
            <label className="form-label">Date</label>
            <input type="date" className="form-control" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
          </div>
          <div className="mb-2">
            <label className="form-label">Description</label>
            <input className="form-control" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </form>
      </Modal>

      <Modal
        show={showCatModal}
        title="New Expense Category"
        onClose={() => setShowCatModal(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowCatModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSaveCategory}>
              Save
            </button>
          </>
        }
      >
        <form onSubmit={handleSaveCategory}>
          <label className="form-label">Name</label>
          <input className="form-control" required value={newCatName} onChange={(e) => setNewCatName(e.target.value)} />
        </form>
      </Modal>
    </div>
  );
}
