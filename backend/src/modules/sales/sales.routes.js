const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { SALES_STAFF, MANAGEMENT } = require('../../constants/roles');
const { ValidationError, NotFoundError, ConflictError } = require('../../utils/errors');
const { logAudit } = require('../../middleware/audit');

const itemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
});

const createSchema = z.object({
  customerId: z.string().uuid().optional(),
  items: z.array(itemSchema).min(1),
  discount: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  amountPaid: z.number().nonnegative().optional(),
  paymentMethod: z.string().default('cash'),
  idempotencyKey: z.string().optional(),
});

async function nextInvoiceNumber(tx, tenantId) {
  const count = await tx.sale.count({ where: { tenantId } });
  return `INV-${String(count + 1).padStart(6, '0')}`;
}

async function isNegativeStockAllowed(tenantId) {
  const setting = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: 'allowNegativeStock' } },
  });
  return setting?.value === 'true';
}

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...SALES_STAFF));

router.get('/', async (req, res) => {
  const { search, from, to, page = '1', pageSize = '20' } = req.query;
  const take = Math.min(parseInt(pageSize, 10) || 20, 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where = { tenantId: req.user.tenantId };
  if (search) where.invoiceNumber = { contains: search, mode: 'insensitive' };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: { customer: true, items: true, cashier: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.sale.count({ where }),
  ]);

  res.json({ items, total, page: Number(page), pageSize: take });
});

router.get('/:id', async (req, res) => {
  const item = await prisma.sale.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
    include: { customer: true, items: { include: { product: true } }, payments: true, cashier: { select: { name: true } } },
  });
  if (!item) throw new NotFoundError();
  res.json({ item });
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid sale data', parsed.error.flatten());
  const { customerId, items, discount, tax, paymentMethod, idempotencyKey } = parsed.data;

  // Idempotent retry: if this exact operation was already recorded, return it
  // instead of double-selling (important once POS clients start retrying on
  // flaky connections, and a required foundation for Phase 2 offline sync).
  if (idempotencyKey) {
    const existing = await prisma.sale.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: req.user.tenantId, idempotencyKey } },
      include: { items: true },
    });
    if (existing) return res.status(200).json({ item: existing, deduplicated: true });
  }

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice - i.discount, 0);
  const total = Math.max(subtotal - discount + tax, 0);
  const amountPaid = parsed.data.amountPaid ?? total;
  if (amountPaid > total) throw new ValidationError('Amount paid cannot exceed sale total');

  const allowNegative = await isNegativeStockAllowed(req.user.tenantId);

  const sale = await prisma.$transaction(async (tx) => {
    // Lock-and-check each product's stock before deducting.
    for (const line of items) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, tenantId: req.user.tenantId },
      });
      if (!product) throw new NotFoundError(`Product ${line.productId} not found`);
      const resultingStock = Number(product.stockQuantity) - line.quantity;
      if (resultingStock < 0 && !allowNegative) {
        throw new ConflictError(`Insufficient stock for ${product.name} (available: ${product.stockQuantity})`);
      }
    }

    const invoiceNumber = await nextInvoiceNumber(tx, req.user.tenantId);
    const created = await tx.sale.create({
      data: {
        tenantId: req.user.tenantId,
        customerId,
        invoiceNumber,
        subtotal,
        discount,
        tax,
        total,
        amountPaid,
        paymentMethod,
        paymentStatus: amountPaid >= total ? 'PAID' : amountPaid <= 0 ? 'UNPAID' : 'PARTIAL',
        cashierId: req.user.id,
        idempotencyKey,
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discount: i.discount,
            lineTotal: i.quantity * i.unitPrice - i.discount,
          })),
        },
      },
      include: { items: true, customer: true },
    });

    for (const line of items) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      const newBalance = Number(product.stockQuantity) - line.quantity;
      await tx.product.update({ where: { id: product.id }, data: { stockQuantity: newBalance } });
      await tx.inventoryTransaction.create({
        data: {
          tenantId: req.user.tenantId,
          productId: product.id,
          type: 'SALE_DEDUCTION',
          quantity: -line.quantity,
          balanceAfter: newBalance,
          reference: created.id,
          createdById: req.user.id,
        },
      });
    }

    if (amountPaid > 0) {
      await tx.payment.create({
        data: {
          tenantId: req.user.tenantId,
          direction: 'IN',
          amount: amountPaid,
          method: paymentMethod,
          saleId: created.id,
          customerId,
        },
      });
    }

    return created;
  });

  await logAudit({ req, action: 'SALE_CREATE', entity: 'Sale', entityId: sale.id });
  res.status(201).json({ item: sale });
});

// Reversal instead of deletion - the original sale record is preserved
// (financial transactions must be immutable / reversal-based, never deleted).
router.post('/:id/reverse', requireRole(...MANAGEMENT), async (req, res) => {
  const sale = await prisma.$transaction(async (tx) => {
    const existing = await tx.sale.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      include: { items: true },
    });
    if (!existing) throw new NotFoundError();
    if (existing.status === 'REVERSED') throw new ConflictError('Sale has already been reversed');

    for (const line of existing.items) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      const newBalance = Number(product.stockQuantity) + Number(line.quantity);
      await tx.product.update({ where: { id: product.id }, data: { stockQuantity: newBalance } });
      await tx.inventoryTransaction.create({
        data: {
          tenantId: req.user.tenantId,
          productId: product.id,
          type: 'SALE_REVERSAL',
          quantity: line.quantity,
          balanceAfter: newBalance,
          reference: existing.id,
          createdById: req.user.id,
        },
      });
    }

    return tx.sale.update({ where: { id: existing.id }, data: { status: 'REVERSED' } });
  });

  await logAudit({ req, action: 'SALE_REVERSE', entity: 'Sale', entityId: sale.id });
  res.json({ item: sale });
});

module.exports = router;
