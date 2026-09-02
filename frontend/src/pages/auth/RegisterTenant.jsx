import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ErrorAlert, extractErrorMessage } from '../../components/Feedback';

export default function RegisterTenant() {
  const { registerTenant } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ businessName: '', adminName: '', email: '', password: '', phone: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await registerTenant(form);
      navigate('/');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="d-flex align-items-center justify-content-center min-vh-100 bg-body-tertiary py-4">
      <div className="card shadow-sm" style={{ width: '420px' }}>
        <div className="card-body p-4">
          <h4 className="mb-1">Create your AK VisionFlow account</h4>
          <p className="text-body-secondary mb-4">Set up your shop/clinic in a few seconds</p>
          <ErrorAlert message={error} />
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">Business Name</label>
              <input className="form-control" required value={form.businessName} onChange={(e) => update('businessName', e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label">Your Name</label>
              <input className="form-control" required value={form.adminName} onChange={(e) => update('adminName', e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label">Phone</label>
              <input className="form-control" value={form.phone} onChange={(e) => update('phone', e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label">Email</label>
              <input type="email" className="form-control" required value={form.email} onChange={(e) => update('email', e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-control"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
              />
            </div>
            <button className="btn btn-primary w-100" disabled={loading}>
              {loading ? 'Creating...' : 'Create Account'}
            </button>
          </form>
          <p className="text-center mt-3 mb-0 small">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
