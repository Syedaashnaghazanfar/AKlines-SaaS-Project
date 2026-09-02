const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { INVENTORY_STAFF } = require('../../constants/roles');
const { ValidationError, NotFoundError, ConflictError } = require('../../utils/errors');
const { logAudit } = require('../../middleware/audit');
const { findExistingByIdempotencyKey } = require('../../utils/idempotency');

const itemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative(),
});

const createSchema = z.object({
  supplierId: z.string().uuid(),
  items: z.array(itemSchema).min(1),
  discount: z.number().nonnegative().default(0),
  amountPaid: z.number().nonnegative().default(0),
  receiveImmediately: z.boolean().default(false),
  idempotencyKey: z.string().optional(),
});

async function nextPurchaseNumber(tx, tenantId) {
  const count = await tx.purchase.count({ where: { tenantId } });
  return `PO-${String(count + 1).padStart(6, '0')}`;
}

async function receivePurchaseStock(tx, purchase, userId) {
  for (const item of purchase.items) {
    const product = await tx.product.findUnique({ where: { id: item.productId } });
    const newBalance = Number(product.stockQuantity) + Number(item.quantity);
    await tx.product.update({ where: { id: product.id }, data: { stockQuantity: newBalance } });
    await tx.inventoryTransaction.create({
      data: {
        tenantId: purchase.tenantId,
        productId: product.id,
        type: 'PURCHASE_RECEIVE',
        quantity: item.quantity,
        balanceAfter: newBalance,
        reference: purchase.id,
        createdById: userId,
      },
    });
  }
}

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...INVENTORY_STAFF));

router.get('/', async (req, res) => {
  const { search, status, page = '1', pageSize = '20' } = req.query;
  const take = Math.min(parseInt(pageSize, 10) || 20, 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where = { tenantId: req.user.tenantId };
  if (status) where.status = status;
  if (search) where.purchaseNumber = { contains: search, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: { supplier: true, items: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.purchase.count({ where }),
  ]);

  res.json({ items, total, page: Number(page), pageSize: take });
});

router.get('/:id', async (req, res) => {
  const item = await prisma.purchase.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
    include: { supplier: true, items: { include: { product: true } }, payments: true },
  });
  if (!item) throw new NotFoundError();
  res.json({ item });
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid purchase data', parsed.error.flatten());
  const { supplierId, items, discount, amountPaid, receiveImmediately, idempotencyKey } = parsed.data;

  if (idempotencyKey) {
    const existing = await findExistingByIdempotencyKey(prisma.purchase, req.user.tenantId, idempotencyKey, {
      items: true,
      supplier: true,
    });
    if (existing) return res.status(200).json({ item: existing, deduplicated: true });
  }

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
  const total = Math.max(subtotal - discount, 0);
  if (amountPaid > total) throw new ValidationError('Amount paid cannot exceed purchase total');

  const purchase = await prisma.$transaction(async (tx) => {
    const purchaseNumber = await nextPurchaseNumber(tx, req.user.tenantId);
    const created = await tx.purchase.create({
      data: {
        tenantId: req.user.tenantId,
        supplierId,
        purchaseNumber,
        subtotal,
        discount,
        total,
        amountPaid,
        idempotencyKey,
        paymentStatus: amountPaid <= 0 ? 'UNPAID' : amountPaid >= total ? 'PAID' : 'PARTIAL',
        status: receiveImmediately ? 'RECEIVED' : 'DRAFT',
        receivedAt: receiveImmediately ? new Date() : null,
        createdById: req.user.id,
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitCost: i.unitCost,
            lineTotal: i.quantity * i.unitCost,
          })),
        },
      },
      include: { items: true, supplier: true },
    });

    if (amountPaid > 0) {
      await tx.payment.create({
        data: {
          tenantId: req.user.tenantId,
          direction: 'OUT',
          amount: amountPaid,
          purchaseId: created.id,
          supplierId,
        },
      });
    }

    if (receiveImmediately) {
      await receivePurchaseStock(tx, created, req.user.id);
    }

    return created;
  });

  await logAudit({ req, action: 'PURCHASE_CREATE', entity: 'Purchase', entityId: purchase.id });
  res.status(201).json({ item: purchase });
});

// Receive stock for a DRAFT purchase - atomic: every item's stock update and the
// status flip to RECEIVED happen in one transaction or not at all.
router.post('/:id/receive', async (req, res) => {
  const purchase = await prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      include: { items: true },
    });
    if (!existing) throw new NotFoundError();
    if (existing.status !== 'DRAFT') throw new ConflictError('Purchase has already been received or cancelled');

    await receivePurchaseStock(tx, existing, req.user.id);

    return tx.purchase.update({
      where: { id: existing.id },
      data: { status: 'RECEIVED', receivedAt: new Date() },
      include: { items: true, supplier: true },
    });
  });

  await logAudit({ req, action: 'PURCHASE_RECEIVE', entity: 'Purchase', entityId: purchase.id });
  res.json({ item: purchase });
});

router.post('/:id/pay', async (req, res) => {
  const schema = z.object({ amount: z.number().positive(), method: z.string().default('cash'), note: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid payment data', parsed.error.flatten());

  const purchase = await prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!existing) throw new NotFoundError();

    const newPaid = Number(existing.amountPaid) + parsed.data.amount;
    if (newPaid > Number(existing.total)) throw new ValidationError('Payment would exceed purchase total');

    await tx.payment.create({
      data: {
        tenantId: req.user.tenantId,
        direction: 'OUT',
        amount: parsed.data.amount,
        method: parsed.data.method,
        note: parsed.data.note,
        purchaseId: existing.id,
        supplierId: existing.supplierId,
      },
    });

    return tx.purchase.update({
      where: { id: existing.id },
      data: {
        amountPaid: newPaid,
        paymentStatus: newPaid >= Number(existing.total) ? 'PAID' : 'PARTIAL',
      },
    });
  });

  res.json({ item: purchase });
});

module.exports = router;
