import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import Modal from '../../components/Modal';
import Pagination from '../../components/Pagination';
import { Spinner, ErrorAlert, EmptyState, extractErrorMessage } from '../../components/Feedback';
import { useAuth } from '../../context/AuthContext';

const emptyForm = {
  categoryId: '',
  type: 'GENERAL',
  name: '',
  sku: '',
  barcode: '',
  purchasePrice: 0,
  sellingPrice: 0,
  openingStock: 0,
  lowStockThreshold: 0,
  unit: 'pcs',
  frameBrand: '',
  frameColor: '',
  lensType: '',
  lensMaterial: '',
  batchNumber: '',
  expiryDate: '',
};

const CAN_MANAGE = ['TENANT_ADMIN', 'MANAGER', 'STORE_KEEPER'];

export default function Products() {
  const { user } = useAuth();
  const canManage = CAN_MANAGE.includes(user?.role);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [adjustProduct, setAdjustProduct] = useState(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const pageSize = 20;

  function load() {
    setLoading(true);
    apiClient
      .get('/products', { params: { page, pageSize, search: search || undefined, type: type || undefined, lowStockOnly: lowStockOnly || undefined } })
      .then((res) => {
        setItems(res.data.items);
        setTotal(res.data.total);
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page, search, type, lowStockOnly]);
  useEffect(() => {
    apiClient.get('/categories', { params: { pageSize: 100 } }).then((res) => setCategories(res.data.items));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        categoryId: form.categoryId || undefined,
        purchasePrice: Number(form.purchasePrice),
        sellingPrice: Number(form.sellingPrice),
        openingStock: Number(form.openingStock),
        lowStockThreshold: Number(form.lowStockThreshold),
        expiryDate: form.expiryDate || undefined,
      };
      await apiClient.post('/products', payload);
      setShowModal(false);
      setForm(emptyForm);
      setPage(1);
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleAdjust(e) {
    e.preventDefault();
    if (!adjustProduct) return;
    setError('');
    try {
      await apiClient.post(`/products/${adjustProduct.id}/adjust-stock`, {
        quantity: Number(adjustQty),
        note: adjustNote || undefined,
      });
      setAdjustProduct(null);
      setAdjustQty('');
      setAdjustNote('');
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Products</h4>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + New Product
          </button>
        )}
      </div>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <input
          className="form-control"
          style={{ maxWidth: 260 }}
          placeholder="Search name, SKU, barcode..."
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <select
          className="form-select"
          style={{ maxWidth: 180 }}
          value={type}
          onChange={(e) => {
            setPage(1);
            setType(e.target.value);
          }}
        >
          <option value="">All Types</option>
          <option value="GENERAL">General</option>
          <option value="MEDICINE">Medicine</option>
          <option value="FRAME">Frame</option>
          <option value="LENS">Lens</option>
        </select>
        <div className="form-check align-self-center">
          <input
            className="form-check-input"
            type="checkbox"
            id="lowStockOnly"
            checked={lowStockOnly}
            onChange={(e) => {
              setPage(1);
              setLowStockOnly(e.target.checked);
            }}
          />
          <label className="form-check-label" htmlFor="lowStockOnly">
            Low stock only
          </label>
        </div>
      </div>

      <ErrorAlert message={error} />
      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState message="No products found." />
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>SKU</th>
                  <th className="text-end">Stock</th>
                  <th className="text-end">Purchase</th>
                  <th className="text-end">Selling</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const low = Number(p.stockQuantity) <= Number(p.lowStockThreshold);
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.type}</td>
                      <td>{p.category?.name || '-'}</td>
                      <td>{p.sku || '-'}</td>
                      <td className={`text-end ${low ? 'text-danger fw-semibold' : ''}`}>{Number(p.stockQuantity)}</td>
                      <td className="text-end">{Number(p.purchasePrice).toFixed(2)}</td>
                      <td className="text-end">{Number(p.sellingPrice).toFixed(2)}</td>
                      {canManage && (
                        <td>
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => setAdjustProduct(p)}>
                            Adjust Stock
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
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
        title="New Product"
        size="lg"
        onClose={() => setShowModal(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
              Cancel
            </button>
            <button type="submit" form="product-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSave} id="product-form">
          <div className="row g-2">
            <div className="col-md-6">
              <label className="form-label">Name</label>
              <input className="form-control" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Type</label>
              <select className="form-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="GENERAL">General</option>
                <option value="MEDICINE">Medicine</option>
                <option value="FRAME">Frame</option>
                <option value="LENS">Lens</option>
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Category</label>
              <select className="form-select" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">SKU</label>
              <input className="form-control" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Barcode</label>
              <input className="form-control" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Unit</label>
              <input className="form-control" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Purchase Price</label>
              <input type="number" step="0.01" min="0" className="form-control" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Selling Price</label>
              <input type="number" step="0.01" min="0" className="form-control" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Opening Stock</label>
              <input type="number" step="0.01" min="0" className="form-control" value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Low Stock Threshold</label>
              <input type="number" step="0.01" min="0" className="form-control" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} />
            </div>

            {form.type === 'FRAME' && (
              <>
                <div className="col-md-6">
                  <label className="form-label">Frame Brand</label>
                  <input className="form-control" value={form.frameBrand} onChange={(e) => setForm({ ...form, frameBrand: e.target.value })} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Frame Color</label>
                  <input className="form-control" value={form.frameColor} onChange={(e) => setForm({ ...form, frameColor: e.target.value })} />
                </div>
              </>
            )}

            {form.type === 'LENS' && (
              <>
                <div className="col-md-6">
                  <label className="form-label">Lens Type</label>
                  <input className="form-control" value={form.lensType} onChange={(e) => setForm({ ...form, lensType: e.target.value })} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Lens Material</label>
                  <input className="form-control" value={form.lensMaterial} onChange={(e) => setForm({ ...form, lensMaterial: e.target.value })} />
                </div>
              </>
            )}

            {form.type === 'MEDICINE' && (
              <>
                <div className="col-md-6">
                  <label className="form-label">Batch Number</label>
                  <input className="form-control" value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Expiry Date</label>
                  <input type="date" className="form-control" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
                </div>
              </>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        show={!!adjustProduct}
        title={`Adjust Stock - ${adjustProduct?.name || ''}`}
        onClose={() => setAdjustProduct(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setAdjustProduct(null)}>
              Cancel
            </button>
            <button type="submit" form="adjust-stock-form" className="btn btn-primary">
              Apply
            </button>
          </>
        }
      >
        <form onSubmit={handleAdjust} id="adjust-stock-form">
          <p className="text-body-secondary">Current stock: {adjustProduct && Number(adjustProduct.stockQuantity)}</p>
          <div className="mb-2">
            <label className="form-label">Quantity (use negative to reduce)</label>
            <input type="number" className="form-control" required value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
          </div>
          <div className="mb-2">
            <label className="form-label">Note</label>
            <input className="form-control" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
          </div>
        </form>
      </Modal>
    </div>
  );
}
