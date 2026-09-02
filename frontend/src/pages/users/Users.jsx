import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import Modal from '../../components/Modal';
import { Spinner, ErrorAlert, extractErrorMessage } from '../../components/Feedback';

const ROLES = ['MANAGER', 'CASHIER', 'STORE_KEEPER', 'RECEPTIONIST', 'ACCOUNTANT', 'TENANT_ADMIN'];

export default function Users() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'CASHIER' });
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    apiClient
      .get('/users')
      .then((res) => setItems(res.data.items))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiClient.post('/users', form);
      setShowModal(false);
      setForm({ name: '', email: '', password: '', role: 'CASHIER' });
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u) {
    try {
      await apiClient.patch(`/users/${u.id}`, { isActive: !u.isActive });
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Users</h4>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + New User
        </button>
      </div>

      <ErrorAlert message={error} />
      {loading ? (
        <Spinner />
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td><span className="badge text-bg-secondary">{u.role}</span></td>
                    <td><span className={`badge text-bg-${u.isActive ? 'success' : 'danger'}`}>{u.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => toggleActive(u)}>
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        show={showModal}
        title="New User"
        onClose={() => setShowModal(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSave}>
          <div className="mb-2">
            <label className="form-label">Name</label>
            <input className="form-control" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="mb-2">
            <label className="form-label">Email</label>
            <input type="email" className="form-control" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="mb-2">
            <label className="form-label">Password</label>
            <input type="password" className="form-control" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="mb-2">
            <label className="form-label">Role</label>
            <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </form>
      </Modal>
    </div>
  );
}
