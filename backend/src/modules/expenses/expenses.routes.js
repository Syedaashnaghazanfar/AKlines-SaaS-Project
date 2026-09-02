const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { FINANCE_STAFF } = require('../../constants/roles');
const { ValidationError, NotFoundError } = require('../../utils/errors');
const { findExistingByIdempotencyKey } = require('../../utils/idempotency');

const createSchema = z.object({
  categoryId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().optional(),
  expenseDate: z.coerce.date().optional(),
  method: z.string().default('cash'),
  idempotencyKey: z.string().optional(),
});

const updateSchema = z.object({
  categoryId: z.string().uuid().optional(),
  amount: z.number().positive().optional(),
  description: z.string().optional(),
  expenseDate: z.coerce.date().optional(),
});

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...FINANCE_STAFF));

router.get('/', async (req, res) => {
  const { from, to, categoryId, page = '1', pageSize = '20' } = req.query;
  const take = Math.min(parseInt(pageSize, 10) || 20, 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where = { tenantId: req.user.tenantId };
  if (categoryId) where.categoryId = categoryId;
  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = new Date(from);
    if (to) where.expenseDate.lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    prisma.expense.findMany({ where, include: { category: true }, orderBy: { expenseDate: 'desc' }, skip, take }),
    prisma.expense.count({ where }),
  ]);

  res.json({ items, total, page: Number(page), pageSize: take });
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid expense data', parsed.error.flatten());
  const { method, ...data } = parsed.data;

  if (data.idempotencyKey) {
    const existing = await findExistingByIdempotencyKey(prisma.expense, req.user.tenantId, data.idempotencyKey, {
      category: true,
    });
    if (existing) return res.status(200).json({ item: existing, deduplicated: true });
  }

  const item = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({ data: { ...data, tenantId: req.user.tenantId } });
    await tx.payment.create({
      data: {
        tenantId: req.user.tenantId,
        direction: 'OUT',
        amount: expense.amount,
        method,
        expenseId: expense.id,
      },
    });
    return expense;
  });

  res.status(201).json({ item });
});

router.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid expense data', parsed.error.flatten());

  const existing = await prisma.expense.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) throw new NotFoundError();

  const item = await prisma.expense.update({ where: { id: existing.id }, data: parsed.data });
  res.json({ item });
});

module.exports = router;
