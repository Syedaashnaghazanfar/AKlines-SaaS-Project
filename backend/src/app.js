require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { corsOrigins, nodeEnv } = require('./config/env');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./modules/auth/auth.routes');
const userRoutes = require('./modules/users/users.routes');
const branchRoutes = require('./modules/branches/branches.routes');
const categoryRoutes = require('./modules/categories/categories.routes');
const productRoutes = require('./modules/products/products.routes');
const customerRoutes = require('./modules/customers/customers.routes');
const supplierRoutes = require('./modules/suppliers/suppliers.routes');
const purchaseRoutes = require('./modules/purchases/purchases.routes');
const saleRoutes = require('./modules/sales/sales.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const opticalOrderRoutes = require('./modules/opticalOrders/opticalOrders.routes');
const expenseCategoryRoutes = require('./modules/expenseCategories/expenseCategories.routes');
const expenseRoutes = require('./modules/expenses/expenses.routes');
const paymentRoutes = require('./modules/payments/payments.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const reportRoutes = require('./modules/reports/reports.routes');
const settingsRoutes = require('./modules/settings/settings.routes');

const app = express();

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
if (nodeEnv !== 'test') app.use(morgan(nodeEnv === 'production' ? 'combined' : 'dev'));

// Brute-force protection on auth endpoints only.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register-tenant', authLimiter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/optical-orders', opticalOrderRoutes);
app.use('/api/expense-categories', expenseCategoryRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
