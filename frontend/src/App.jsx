import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/auth/Login';
import RegisterTenant from './pages/auth/RegisterTenant';
import Dashboard from './pages/dashboard/Dashboard';
import Products from './pages/products/Products';
import Customers from './pages/customers/Customers';
import Suppliers from './pages/suppliers/Suppliers';
import Purchases from './pages/purchases/Purchases';
import Pos from './pages/sales/Pos';
import OpticalOrders from './pages/opticalOrders/OpticalOrders';
import Expenses from './pages/expenses/Expenses';
import Reports from './pages/reports/Reports';
import Users from './pages/users/Users';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<RegisterTenant />} />

            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route
                path="/pos"
                element={
                  <ProtectedRoute roles={['TENANT_ADMIN', 'MANAGER', 'CASHIER']}>
                    <Pos />
                  </ProtectedRoute>
                }
              />
              <Route path="/products" element={<Products />} />
              <Route
                path="/purchases"
                element={
                  <ProtectedRoute roles={['TENANT_ADMIN', 'MANAGER', 'STORE_KEEPER']}>
                    <Purchases />
                  </ProtectedRoute>
                }
              />
              <Route path="/customers" element={<Customers />} />
              <Route path="/suppliers" element={<Suppliers />} />
              <Route
                path="/optical-orders"
                element={
                  <ProtectedRoute roles={['TENANT_ADMIN', 'MANAGER', 'RECEPTIONIST']}>
                    <OpticalOrders />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/expenses"
                element={
                  <ProtectedRoute roles={['TENANT_ADMIN', 'MANAGER', 'ACCOUNTANT']}>
                    <Expenses />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/reports"
                element={
                  <ProtectedRoute roles={['TENANT_ADMIN', 'MANAGER', 'ACCOUNTANT']}>
                    <Reports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/users"
                element={
                  <ProtectedRoute roles={['TENANT_ADMIN']}>
                    <Users />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
