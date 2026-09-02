import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useState, useEffect } from 'react';
import SyncStatusWidget from './SyncStatusWidget';
import { syncAll } from '../offline/syncEngine';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', roles: null },
  { to: '/pos', label: 'POS / Sales', roles: ['TENANT_ADMIN', 'MANAGER', 'CASHIER'] },
  { to: '/sales-history', label: 'Sales History', roles: ['TENANT_ADMIN', 'MANAGER', 'CASHIER'] },
  { to: '/products', label: 'Products', roles: ['TENANT_ADMIN', 'MANAGER', 'STORE_KEEPER', 'CASHIER', 'RECEPTIONIST', 'ACCOUNTANT'] },
  { to: '/purchases', label: 'Purchases', roles: ['TENANT_ADMIN', 'MANAGER', 'STORE_KEEPER'] },
  { to: '/customers', label: 'Customers', roles: null },
  { to: '/suppliers', label: 'Suppliers', roles: null },
  { to: '/optical-orders', label: 'Optical Orders', roles: ['TENANT_ADMIN', 'MANAGER', 'RECEPTIONIST'] },
  { to: '/expenses', label: 'Expenses', roles: ['TENANT_ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { to: '/reports', label: 'Reports', roles: ['TENANT_ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { to: '/users', label: 'Users', roles: ['TENANT_ADMIN'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [online, setOnline] = useState(navigator.onLine);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      if (user?.tenantId) syncAll(user.tenantId);
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [user?.tenantId]);

  // Catches the case where the tab is already online when it loads (or a
  // previous sync attempt died mid-drain without the browser ever firing an
  // 'offline' event) - without this, a queue could sit unsynced until the
  // next online/offline transition.
  useEffect(() => {
    if (navigator.onLine && user?.tenantId) syncAll(user.tenantId);
  }, [user?.tenantId]);

  const visibleNav = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user?.role));

  return (
    <div className="d-flex vh-100 overflow-hidden">
      <aside className={`bg-body-tertiary border-end p-3 sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <h5 className="mb-4">AK VisionFlow</h5>
        <nav className="nav flex-column gap-1">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link rounded px-2 py-1 ${isActive ? 'active bg-primary text-white' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-grow-1 d-flex flex-column overflow-hidden">
        <header className="d-flex align-items-center justify-content-between border-bottom px-3 py-2">
          <button className="btn btn-sm btn-outline-secondary d-md-none" onClick={() => setSidebarOpen((v) => !v)}>
            ☰
          </button>
          <div className="d-flex align-items-center gap-2">
            <SyncStatusWidget tenantId={user?.tenantId} online={online} />
          </div>
          <div className="d-flex align-items-center gap-3">
            <button className="btn btn-sm btn-outline-secondary" onClick={toggleTheme}>
              {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
            </button>
            <span className="text-body-secondary small">
              {user?.name} <span className="badge text-bg-secondary">{user?.role}</span>
            </span>
            <button
              className="btn btn-sm btn-outline-danger"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Logout
            </button>
          </div>
        </header>
        <main className="flex-grow-1 overflow-auto p-3">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
