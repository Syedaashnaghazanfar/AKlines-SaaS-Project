const express = require('express');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { INVENTORY_STAFF } = require('../../constants/roles');

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...INVENTORY_STAFF));

// Stock movement listing - supports the Stock Movement Report and per-product history.
router.get('/transactions', async (req, res) => {
  const { productId, from, to, page = '1', pageSize = '50' } = req.query;
  const take = Math.min(parseInt(pageSize, 10) || 50, 200);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where = { tenantId: req.user.tenantId };
  if (productId) where.productId = productId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      include: { product: { select: { name: true, sku: true, unit: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);

  res.json({ items, total, page: Number(page), pageSize: take });
});

module.exports = router;
