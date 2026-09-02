import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import { Spinner, ErrorAlert, extractErrorMessage } from '../../components/Feedback';

const TABS = [
  { key: 'sales/daily', label: 'Daily Sales' },
  { key: 'sales/monthly', label: 'Monthly Sales' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'stock-movement', label: 'Stock Movement' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'profit-loss', label: 'Profit & Loss' },
  { key: 'optical-orders', label: 'Optical Orders' },
  { key: 'medicine-expiry', label: 'Medicine Expiry' },
];

export default function Reports() {
  const [active, setActive] = useState(TABS[0].key);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function runReport(key) {
    setActive(key);
    setLoading(true);
    setError('');
    apiClient
      .get(`/reports/${key}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => runReport(TABS[0].key), []);

  return (
    <div>
      <h4 className="mb-3">Reports</h4>
      <ul className="nav nav-pills mb-3 flex-wrap">
        {TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <button className={`nav-link ${active === t.key ? 'active' : ''}`} onClick={() => runReport(t.key)}>
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      <ErrorAlert message={error} />
      {loading ? <Spinner /> : <ReportBody reportKey={active} data={data} />}
    </div>
  );
}

function ReportBody({ reportKey, data }) {
  if (!data) return null;

  if (reportKey === 'sales/daily' || reportKey === 'sales/monthly') {
    return (
      <div className="card">
        <div className="card-body">
          <p>Total: <strong>${(data.total ?? data.totals?.total ?? 0).toFixed(2)}</strong> ({data.count} transactions)</p>
        </div>
      </div>
    );
  }

  if (reportKey === 'inventory') {
    return (
      <div className="card">
        <div className="card-body">
          <p>Total Stock Value: <strong>${data.totalStockValue.toFixed(2)}</strong></p>
        </div>
        <div className="table-responsive">
          <table className="table table-sm mb-0">
            <thead><tr><th>Name</th><th>Type</th><th className="text-end">Stock</th><th className="text-end">Value</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={r.lowStock ? 'table-warning' : ''}>
                  <td>{r.name}</td><td>{r.type}</td>
                  <td className="text-end">{r.stockQuantity}</td>
                  <td className="text-end">{r.stockValue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (reportKey === 'stock-movement') {
    return (
      <div className="table-responsive">
        <table className="table table-sm">
          <thead><tr><th>Date</th><th>Product</th><th>Type</th><th className="text-end">Qty</th><th className="text-end">Balance After</th></tr></thead>
          <tbody>
            {data.transactions.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
                <td>{t.product?.name}</td>
                <td>{t.type}</td>
                <td className="text-end">{Number(t.quantity)}</td>
                <td className="text-end">{Number(t.balanceAfter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (reportKey === 'expenses') {
    return (
      <div>
        <div className="card mb-3">
          <div className="card-body">
            <p>Total: <strong>${data.total.toFixed(2)}</strong></p>
            {Object.entries(data.byCategory).map(([k, v]) => (
              <div key={k} className="d-flex justify-content-between"><span>{k}</span><span>${v.toFixed(2)}</span></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (reportKey === 'profit-loss') {
    return (
      <div className="card">
        <div className="card-body">
          <div className="d-flex justify-content-between"><span>Revenue</span><span>${data.revenue.toFixed(2)}</span></div>
          <div className="d-flex justify-content-between"><span>Cost of Goods Sold</span><span>${data.cogs.toFixed(2)}</span></div>
          <div className="d-flex justify-content-between fw-bold"><span>Gross Profit</span><span>${data.grossProfit.toFixed(2)}</span></div>
          <div className="d-flex justify-content-between"><span>Expenses</span><span>${data.totalExpenses.toFixed(2)}</span></div>
          <hr />
          <div className="d-flex justify-content-between fs-5 fw-bold"><span>Net Profit</span><span>${data.netProfit.toFixed(2)}</span></div>
        </div>
      </div>
    );
  }

  if (reportKey === 'optical-orders') {
    return (
      <div>
        <p>Total orders: {data.count}</p>
        {Object.entries(data.byStatus).map(([k, v]) => (
          <span key={k} className="badge text-bg-secondary me-2">{k}: {v}</span>
        ))}
      </div>
    );
  }

  if (reportKey === 'medicine-expiry') {
    return (
      <div className="table-responsive">
        <table className="table table-sm">
          <thead><tr><th>Name</th><th>Batch</th><th>Expiry</th><th className="text-end">Stock</th></tr></thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p.id}><td>{p.name}</td><td>{p.batchNumber}</td><td>{new Date(p.expiryDate).toLocaleDateString()}</td><td className="text-end">{Number(p.stockQuantity)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}
