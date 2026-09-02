import { useEffect, useMemo, useState } from 'react';
import Modal from '../../components/Modal';
import { ErrorAlert, extractErrorMessage } from '../../components/Feedback';
import { useAuth } from '../../context/AuthContext';
import { refreshCaches, OUTBOXES } from '../../offline/syncEngine';
import { useLiveProducts, useLiveCustomers } from '../../offline/useOfflineData';

export default function Pos() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  // Live-reads from the local cache - automatically reflects optimistic
  // stock changes, completed syncs, and cache refreshes without any manual
  // re-fetch wiring, whether they happen from this tab or the sync engine
  // running in the background.
  const products = useLiveProducts(tenantId);
  const customers = useLiveCustomers(tenantId);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]); // { productId, name, unitPrice, quantity, discount, maxStock }
  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [error, setError] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [receipt, setReceipt] = useState(null);

  // Refresh the local cache from the server whenever we're online and this
  // screen mounts - this is what lets the same POS screen work identically
  // online or offline (it always renders from the cache via the hooks above).
  useEffect(() => {
    if (!tenantId || !navigator.onLine) return;
    refreshCaches(tenantId).catch((err) => {
      console.warn('Could not refresh offline cache, using last known data:', err);
    });
  }, [tenantId]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q)
    );
  }, [products, search]);

  function addToCart(product) {
    setCart((c) => {
      const existing = c.find((l) => l.productId === product.id);
      if (existing) {
        return c.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...c,
        {
          productId: product.id,
          name: product.name,
          unitPrice: Number(product.sellingPrice),
          quantity: 1,
          discount: 0,
          maxStock: Number(product.stockQuantity),
        },
      ];
    });
  }

  function updateLine(productId, field, value) {
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, [field]: value } : l)));
  }
  function removeLine(productId) {
    setCart((c) => c.filter((l) => l.productId !== productId));
  }

  const subtotal = useMemo(
    () => cart.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unitPrice || 0) - Number(l.discount || 0), 0),
    [cart]
  );
  const total = Math.max(subtotal - Number(discount || 0) + Number(tax || 0), 0);

  // A cart line may exceed what this device last saw in stock (another
  // device could have sold it since, or stock simply ran low). We still let
  // the sale be queued - the server is the sole authority on whether it's
  // actually allowed - but the cashier gets a heads-up either way.
  const overStock = cart.some((l) => Number(l.quantity) > l.maxStock);

  async function checkout() {
    setError('');
    if (cart.length === 0) return;
    setCheckingOut(true);
    try {
      const payload = {
        customerId: customerId || undefined,
        items: cart.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discount: Number(l.discount || 0),
        })),
        discount: Number(discount || 0),
        tax: Number(tax || 0),
        amountPaid: amountPaid === '' ? undefined : Number(amountPaid),
        paymentMethod,
      };

      const finalEntry = await OUTBOXES.sales.submit(tenantId, payload);

      if (finalEntry.status === 'conflict' || finalEntry.status === 'failed') {
        setError(`Sale could not be completed: ${finalEntry.lastError}`);
      } else {
        setReceipt(finalEntry);
        setCart([]);
        setCustomerId('');
        setDiscount(0);
        setTax(0);
        setAmountPaid('');
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setCheckingOut(false);
    }
  }

  return (
    <div className="row g-3">
      <div className="col-lg-7">
        <h4 className="mb-3">Point of Sale</h4>
        <input
          className="form-control mb-3"
          placeholder="Search product by name, SKU, barcode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="row g-2" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {filteredProducts.map((p) => (
            <div className="col-md-4" key={p.id}>
              <button
                type="button"
                className="btn btn-outline-primary w-100 h-100 text-start p-2"
                disabled={Number(p.stockQuantity) <= 0}
                onClick={() => addToCart(p)}
              >
                <div className="fw-semibold">{p.name}</div>
                <div className="small">${Number(p.sellingPrice).toFixed(2)}</div>
                <div className="small text-body-secondary">Stock: {Number(p.stockQuantity)}</div>
              </button>
            </div>
          ))}
          {filteredProducts.length === 0 && (
            <p className="text-body-secondary">No cached products match. Connect to the internet at least once to load the catalog.</p>
          )}
        </div>
      </div>

      <div className="col-lg-5">
        <div className="card">
          <div className="card-header">Cart</div>
          <div className="card-body" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
            <ErrorAlert message={error} />
            {overStock && (
              <div className="alert alert-warning py-2 small">
                One or more items exceed the last known stock on this device. The sale can still be completed, but may be
                flagged as a conflict if stock has genuinely run out.
              </div>
            )}
            {cart.length === 0 && <p className="text-body-secondary">Cart is empty</p>}
            {cart.map((l) => (
              <div key={l.productId} className="d-flex align-items-center gap-2 mb-2">
                <div className="flex-grow-1">
                  <div className="small fw-semibold">{l.name}</div>
                  <div className="d-flex gap-1">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="form-control form-control-sm"
                      style={{ width: 70 }}
                      value={l.quantity}
                      onChange={(e) => updateLine(l.productId, 'quantity', e.target.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="form-control form-control-sm"
                      style={{ width: 80 }}
                      value={l.unitPrice}
                      onChange={(e) => updateLine(l.productId, 'unitPrice', e.target.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="form-control form-control-sm"
                      style={{ width: 70 }}
                      placeholder="disc"
                      value={l.discount}
                      onChange={(e) => updateLine(l.productId, 'discount', e.target.value)}
                    />
                  </div>
                </div>
                <button className="btn btn-sm btn-outline-danger" onClick={() => removeLine(l.productId)}>
                  &times;
                </button>
              </div>
            ))}
          </div>
          <div className="card-footer">
            <div className="mb-2">
              <label className="form-label small mb-0">Customer (optional)</label>
              <select className="form-select form-select-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="row g-2 mb-2">
              <div className="col-4">
                <label className="form-label small mb-0">Discount</label>
                <input type="number" min="0" step="0.01" className="form-control form-control-sm" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
              <div className="col-4">
                <label className="form-label small mb-0">Tax</label>
                <input type="number" min="0" step="0.01" className="form-control form-control-sm" value={tax} onChange={(e) => setTax(e.target.value)} />
              </div>
              <div className="col-4">
                <label className="form-label small mb-0">Method</label>
                <select className="form-select form-select-sm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="mb-2">
              <label className="form-label small mb-0">Amount Paid (blank = full)</label>
              <input type="number" min="0" step="0.01" className="form-control form-control-sm" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
            </div>
            <div className="d-flex justify-content-between fs-5 fw-bold mb-2">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
            <button className="btn btn-success w-100" disabled={cart.length === 0 || checkingOut} onClick={checkout}>
              {checkingOut ? 'Processing...' : 'Complete Sale'}
            </button>
          </div>
        </div>
      </div>

      <Modal
        show={!!receipt}
        title={receipt?.status === 'synced' ? 'Sale Completed' : 'Sale Queued'}
        onClose={() => setReceipt(null)}
        footer={
          <button className="btn btn-primary" onClick={() => setReceipt(null)}>
            Close
          </button>
        }
      >
        {receipt && (
          <div>
            {receipt.status === 'synced' ? (
              <>
                <p className="fw-bold">Invoice: {receipt.serverResult.invoiceNumber}</p>
                <ul className="list-unstyled">
                  {receipt.serverResult.items.map((i) => (
                    <li key={i.id} className="d-flex justify-content-between">
                      <span>Qty {Number(i.quantity)}</span>
                      <span>${Number(i.lineTotal).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                <hr />
                <div className="d-flex justify-content-between fw-bold">
                  <span>Total</span>
                  <span>${Number(receipt.serverResult.total).toFixed(2)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="alert alert-info mb-3">
                  This sale is saved on this device and will sync automatically once you're back online. You can check
                  its status any time from the sync badge in the top bar.
                </div>
                <ul className="list-unstyled">
                  {receipt.payload.items.map((i, idx) => (
                    <li key={idx} className="d-flex justify-content-between">
                      <span>Qty {i.quantity}</span>
                      <span>${(i.quantity * i.unitPrice - (i.discount || 0)).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
