const express = require('express');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant } = require('../../middleware/auth');

const router = express.Router();
router.use(authenticate, requireTenant);

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

router.get('/', async (req, res) => {
  const tenantId = req.user.tenantId;
  const today = startOfDay();
  const monthStart = startOfMonth();

  const [
    todaySales,
    monthSales,
    monthPurchases,
    products,
    customerCount,
    supplierCount,
    pendingOpticalOrders,
    lowStockCandidates,
    expiringMedicines,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { tenantId, status: 'COMPLETED', createdAt: { gte: today } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { tenantId, status: 'COMPLETED', createdAt: { gte: monthStart } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.purchase.aggregate({
      where: { tenantId, status: 'RECEIVED', createdAt: { gte: monthStart } },
      _sum: { total: true },
    }),
    prisma.product.findMany({
      where: { tenantId, isActive: true },
      select: { stockQuantity: true, purchasePrice: true, lowStockThreshold: true, expiryDate: true, name: true },
    }),
    prisma.customer.count({ where: { tenantId, isActive: true } }),
    prisma.supplier.count({ where: { tenantId, isActive: true } }),
    prisma.opticalOrder.count({ where: { tenantId, status: { in: ['PENDING', 'IN_LAB', 'READY'] } } }),
    null,
    null,
  ]);

  const inventoryValue = products.reduce((sum, p) => sum + Number(p.stockQuantity) * Number(p.purchasePrice), 0);
  const lowStockItems = products.filter((p) => Number(p.stockQuantity) <= Number(p.lowStockThreshold));

  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  const expiring = products.filter((p) => p.expiryDate && new Date(p.expiryDate) <= in30Days);

  // Gross profit estimate: sale line revenue minus each product's current
  // average purchase cost - a simplification since Phase 1 doesn't do FIFO/lot costing.
  const monthSaleItems = await prisma.saleItem.findMany({
    where: { sale: { tenantId, status: 'COMPLETED', createdAt: { gte: monthStart } } },
    include: { product: { select: { purchasePrice: true } } },
  });
  const grossProfitEstimate = monthSaleItems.reduce(
    (sum, item) => sum + (Number(item.lineTotal) - Number(item.quantity) * Number(item.product.purchasePrice)),
    0
  );

  res.json({
    todaySales: { total: Number(todaySales._sum.total || 0), count: todaySales._count },
    monthSales: { total: Number(monthSales._sum.total || 0), count: monthSales._count },
    monthPurchases: { total: Number(monthPurchases._sum.total || 0) },
    grossProfitEstimate,
    inventoryValue,
    customerCount,
    supplierCount,
    pendingOpticalOrders,
    lowStockItems: lowStockItems.slice(0, 20),
    lowStockCount: lowStockItems.length,
    expiringMedicines: expiring.slice(0, 20),
    expiringCount: expiring.length,
  });
});

module.exports = router;
