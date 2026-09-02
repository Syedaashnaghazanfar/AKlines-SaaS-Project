const express = require('express');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { FINANCE_STAFF } = require('../../constants/roles');

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...FINANCE_STAFF));

function dateRange(query, defaultDays = 30) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - defaultDays * 86400000);
  return { from, to };
}

// 1. Daily Sales Report
router.get('/sales/daily', async (req, res) => {
  const date = req.query.date ? new Date(req.query.date) : new Date();
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(date); end.setHours(23, 59, 59, 999);

  const sales = await prisma.sale.findMany({
    where: { tenantId: req.user.tenantId, status: 'COMPLETED', createdAt: { gte: start, lte: end } },
    include: { items: true, customer: true },
    orderBy: { createdAt: 'asc' },
  });
  const totals = sales.reduce(
    (acc, s) => ({
      subtotal: acc.subtotal + Number(s.subtotal),
      discount: acc.discount + Number(s.discount),
      total: acc.total + Number(s.total),
      amountPaid: acc.amountPaid + Number(s.amountPaid),
    }),
    { subtotal: 0, discount: 0, total: 0, amountPaid: 0 }
  );
  res.json({ date: start, sales, totals, count: sales.length });
});

// 2. Monthly Sales Report
router.get('/sales/monthly', async (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const month = req.query.month ? parseInt(req.query.month, 10) - 1 : new Date().getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);

  const sales = await prisma.sale.findMany({
    where: { tenantId: req.user.tenantId, status: 'COMPLETED', createdAt: { gte: start, lt: end } },
  });
  const byDay = {};
  for (const s of sales) {
    const day = s.createdAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + Number(s.total);
  }
  const total = sales.reduce((sum, s) => sum + Number(s.total), 0);
  res.json({ year, month: month + 1, total, count: sales.length, byDay });
});

// 3. Inventory Report
router.get('/inventory', async (req, res) => {
  const products = await prisma.product.findMany({
    where: { tenantId: req.user.tenantId, isActive: true },
    include: { category: true },
    orderBy: { name: 'asc' },
  });
  const rows = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category?.name,
    type: p.type,
    stockQuantity: Number(p.stockQuantity),
    purchasePrice: Number(p.purchasePrice),
    sellingPrice: Number(p.sellingPrice),
    stockValue: Number(p.stockQuantity) * Number(p.purchasePrice),
    lowStock: Number(p.stockQuantity) <= Number(p.lowStockThreshold),
  }));
  const totalStockValue = rows.reduce((sum, r) => sum + r.stockValue, 0);
  res.json({ rows, totalStockValue, count: rows.length });
});

// 4. Stock Movement Report
router.get('/stock-movement', async (req, res) => {
  const { from, to } = dateRange(req.query);
  const { productId } = req.query;

  const where = { tenantId: req.user.tenantId, createdAt: { gte: from, lte: to } };
  if (productId) where.productId = productId;

  const transactions = await prisma.inventoryTransaction.findMany({
    where,
    include: { product: { select: { name: true, sku: true, unit: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ from, to, transactions, count: transactions.length });
});

// 7. Expense Report
router.get('/expenses', async (req, res) => {
  const { from, to } = dateRange(req.query);
  const expenses = await prisma.expense.findMany({
    where: { tenantId: req.user.tenantId, expenseDate: { gte: from, lte: to } },
    include: { category: true },
    orderBy: { expenseDate: 'desc' },
  });
  const byCategory = {};
  for (const e of expenses) {
    const key = e.category.name;
    byCategory[key] = (byCategory[key] || 0) + Number(e.amount);
  }
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  res.json({ from, to, expenses, total, byCategory });
});

// 8. Basic Profit & Loss
router.get('/profit-loss', async (req, res) => {
  const { from, to } = dateRange(req.query);
  const tenantId = req.user.tenantId;

  const [saleItems, expenses] = await Promise.all([
    prisma.saleItem.findMany({
      where: { sale: { tenantId, status: 'COMPLETED', createdAt: { gte: from, lte: to } } },
      include: { product: { select: { purchasePrice: true } } },
    }),
    prisma.expense.aggregate({
      where: { tenantId, expenseDate: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
  ]);

  const revenue = saleItems.reduce((sum, i) => sum + Number(i.lineTotal), 0);
  const cogs = saleItems.reduce((sum, i) => sum + Number(i.quantity) * Number(i.product.purchasePrice), 0);
  const grossProfit = revenue - cogs;
  const totalExpenses = Number(expenses._sum.amount || 0);
  const netProfit = grossProfit - totalExpenses;

  res.json({ from, to, revenue, cogs, grossProfit, totalExpenses, netProfit });
});

// 9. Optical Order Report
router.get('/optical-orders', async (req, res) => {
  const { from, to } = dateRange(req.query, 90);
  const orders = await prisma.opticalOrder.findMany({
    where: { tenantId: req.user.tenantId, createdAt: { gte: from, lte: to } },
    include: { customer: true },
    orderBy: { createdAt: 'desc' },
  });
  const byStatus = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  res.json({ from, to, orders, count: orders.length, byStatus });
});

// 10. Medicine Expiry Report
router.get('/medicine-expiry', async (req, res) => {
  const withinDays = parseInt(req.query.withinDays, 10) || 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);

  const products = await prisma.product.findMany({
    where: {
      tenantId: req.user.tenantId,
      type: 'MEDICINE',
      isActive: true,
      expiryDate: { not: null, lte: cutoff },
    },
    orderBy: { expiryDate: 'asc' },
  });
  res.json({ withinDays, products, count: products.length });
});

module.exports = router;
