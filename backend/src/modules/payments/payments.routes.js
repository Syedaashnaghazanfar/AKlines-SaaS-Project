const express = require('express');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { FINANCE_STAFF } = require('../../constants/roles');

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...FINANCE_STAFF));

// Read-only aggregate view - payments themselves are created as a side effect
// of sales, purchases, and expenses (see those modules) to keep money movement
// always tied to the transaction that caused it.
router.get('/', async (req, res) => {
  const { direction, from, to, page = '1', pageSize = '20' } = req.query;
  const take = Math.min(parseInt(pageSize, 10) || 20, 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where = { tenantId: req.user.tenantId };
  if (direction) where.direction = direction;
  if (from || to) {
    where.paidAt = {};
    if (from) where.paidAt.gte = new Date(from);
    if (to) where.paidAt.lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { sale: true, purchase: true, customer: true, supplier: true, expense: true },
      orderBy: { paidAt: 'desc' },
      skip,
      take,
    }),
    prisma.payment.count({ where }),
  ]);

  res.json({ items, total, page: Number(page), pageSize: take });
});

module.exports = router;
