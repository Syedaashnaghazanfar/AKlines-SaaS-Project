const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { INVENTORY_STAFF, CONTACTS_STAFF } = require('../../constants/roles');
const { ValidationError, NotFoundError } = require('../../utils/errors');
const { logAudit } = require('../../middleware/audit');

const PRODUCT_TYPES = ['GENERAL', 'MEDICINE', 'FRAME', 'LENS'];

const createSchema = z.object({
  categoryId: z.string().uuid().optional(),
  type: z.enum(PRODUCT_TYPES).default('GENERAL'),
  name: z.string().min(1),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  description: z.string().optional(),
  purchasePrice: z.number().nonnegative().default(0),
  sellingPrice: z.number().nonnegative().default(0),
  openingStock: z.number().nonnegative().default(0),
  lowStockThreshold: z.number().nonnegative().default(0),
  unit: z.string().default('pcs'),
  frameBrand: z.string().optional(),
  frameModel: z.string().optional(),
  frameColor: z.string().optional(),
  frameSize: z.string().optional(),
  lensType: z.string().optional(),
  lensMaterial: z.string().optional(),
  lensCoating: z.string().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.coerce.date().optional(),
});

const updateSchema = createSchema.partial().omit({ openingStock: true }).extend({ isActive: z.boolean().optional() });

const adjustSchema = z.object({
  quantity: z.number().refine((v) => v !== 0, 'Quantity must be non-zero'),
  note: z.string().optional(),
});

const router = express.Router();
router.use(authenticate, requireTenant);

router.get('/', requireRole(...CONTACTS_STAFF), async (req, res) => {
  const { search, type, lowStockOnly, includeInactive, page = '1', pageSize = '20' } = req.query;
  const take = Math.min(parseInt(pageSize, 10) || 20, 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where = { tenantId: req.user.tenantId };
  if (includeInactive !== 'true') where.isActive = true;
  if (type) where.type = type;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ];
  }

  let items = await prisma.product.findMany({
    where,
    include: { category: true },
    orderBy: { name: 'asc' },
    skip,
    take,
  });
  if (lowStockOnly === 'true') {
    items = items.filter((p) => Number(p.stockQuantity) <= Number(p.lowStockThreshold));
  }
  const total = await prisma.product.count({ where });

  res.json({ items, total, page: Number(page), pageSize: take });
});

router.get('/:id', requireRole(...CONTACTS_STAFF), async (req, res) => {
  const item = await prisma.product.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
    include: { category: true },
  });
  if (!item) throw new NotFoundError();
  res.json({ item });
});

router.post('/', requireRole(...INVENTORY_STAFF), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid product data', parsed.error.flatten());
  const { openingStock, ...data } = parsed.data;

  const item = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: { ...data, tenantId: req.user.tenantId, stockQuantity: openingStock },
    });
    if (openingStock > 0) {
      await tx.inventoryTransaction.create({
        data: {
          tenantId: req.user.tenantId,
          productId: product.id,
          type: 'OPENING_STOCK',
          quantity: openingStock,
          balanceAfter: openingStock,
          createdById: req.user.id,
        },
      });
    }
    return product;
  });

  await logAudit({ req, action: 'PRODUCT_CREATE', entity: 'Product', entityId: item.id });
  res.status(201).json({ item });
});

router.patch('/:id', requireRole(...INVENTORY_STAFF), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid product data', parsed.error.flatten());

  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
  });
  if (!existing) throw new NotFoundError();

  const item = await prisma.product.update({ where: { id: existing.id }, data: parsed.data });
  await logAudit({ req, action: 'PRODUCT_UPDATE', entity: 'Product', entityId: item.id });
  res.json({ item });
});

router.delete('/:id', requireRole(...INVENTORY_STAFF), async (req, res) => {
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
  });
  if (!existing) throw new NotFoundError();
  const item = await prisma.product.update({
    where: { id: existing.id },
    data: { isActive: false, archivedAt: new Date() },
  });
  res.json({ item });
});

// Manual stock adjustment - always creates an audit-tracked inventory transaction,
// never mutates stockQuantity directly without a paper trail.
router.post('/:id/adjust-stock', requireRole(...INVENTORY_STAFF), async (req, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid adjustment data', parsed.error.flatten());
  const { quantity, note } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!product) throw new NotFoundError();

    const newBalance = Number(product.stockQuantity) + quantity;
    if (newBalance < 0) throw new ValidationError('Adjustment would result in negative stock');

    const updated = await tx.product.update({
      where: { id: product.id },
      data: { stockQuantity: newBalance },
    });
    await tx.inventoryTransaction.create({
      data: {
        tenantId: req.user.tenantId,
        productId: product.id,
        type: quantity > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantity,
        balanceAfter: newBalance,
        note,
        createdById: req.user.id,
      },
    });
    return updated;
  });

  await logAudit({ req, action: 'STOCK_ADJUST', entity: 'Product', entityId: result.id, metadata: { quantity, note } });
  res.json({ item: result });
});

module.exports = router;
