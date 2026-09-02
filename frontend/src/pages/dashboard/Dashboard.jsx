import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import { Spinner, ErrorAlert, extractErrorMessage } from '../../components/Feedback';

function StatCard({ label, value, sub, variant = 'primary' }) {
  return (
    <div className="col-sm-6 col-lg-3">
      <div className={`card border-${variant} h-100`}>
        <div className="card-body">
          <div className="text-body-secondary small">{label}</div>
          <div className="fs-4 fw-semibold">{value}</div>
          {sub && <div className="text-body-secondary small">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient
      .get('/dashboard')
      .then((res) => setData(res.data))
      .catch((err) => setError(extractErrorMessage(err)));
  }, []);

  if (error) return <ErrorAlert message={error} />;
  if (!data) return <Spinner />;

  return (
    <div>
      <h4 className="mb-3">Dashboard</h4>
      <div className="row g-3 mb-4">
        <StatCard label="Today's Sales" value={`$${data.todaySales.total.toFixed(2)}`} sub={`${data.todaySales.count} invoices`} />
        <StatCard label="This Month's Sales" value={`$${data.monthSales.total.toFixed(2)}`} sub={`${data.monthSales.count} invoices`} variant="success" />
        <StatCard label="This Month's Purchases" value={`$${data.monthPurchases.total.toFixed(2)}`} variant="info" />
        <StatCard label="Est. Gross Profit (Month)" value={`$${data.grossProfitEstimate.toFixed(2)}`} variant="secondary" />
        <StatCard label="Inventory Value" value={`$${data.inventoryValue.toFixed(2)}`} />
        <StatCard label="Customers" value={data.customerCount} />
        <StatCard label="Suppliers" value={data.supplierCount} />
        <StatCard label="Pending Optical Orders" value={data.pendingOpticalOrders} variant="warning" />
      </div>

      <div className="row g-3">
        <div className="col-md-6">
          <div className="card">
            <div className="card-header d-flex justify-content-between">
              <span>Low Stock Items</span>
              <span className="badge text-bg-danger">{data.lowStockCount}</span>
            </div>
            <ul className="list-group list-group-flush">
              {data.lowStockItems.length === 0 && <li className="list-group-item text-body-secondary">None</li>}
              {data.lowStockItems.map((p) => (
                <li key={p.name} className="list-group-item d-flex justify-content-between">
                  <span>{p.name}</span>
                  <span>{Number(p.stockQuantity)} left</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card">
            <div className="card-header d-flex justify-content-between">
              <span>Expiring Medicines (30 days)</span>
              <span className="badge text-bg-warning">{data.expiringCount}</span>
            </div>
            <ul className="list-group list-group-flush">
              {data.expiringMedicines.length === 0 && <li className="list-group-item text-body-secondary">None</li>}
              {data.expiringMedicines.map((p) => (
                <li key={p.name} className="list-group-item d-flex justify-content-between">
                  <span>{p.name}</span>
                  <span>{new Date(p.expiryDate).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
