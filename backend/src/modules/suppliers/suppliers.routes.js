const express = require('express');
const { z } = require('zod');
const buildCrudController = require('../../utils/crudFactory');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { CONTACTS_STAFF, INVENTORY_STAFF } = require('../../constants/roles');
const prisma = require('../../config/prisma');
const { NotFoundError } = require('../../utils/errors');

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  idempotencyKey: z.string().optional(),
});
const updateSchema = createSchema.omit({ idempotencyKey: true }).partial().extend({ isActive: z.boolean().optional() });

const controller = buildCrudController({
  model: 'supplier',
  createSchema,
  updateSchema,
  searchFields: ['name', 'phone', 'email'],
  supportsIdempotencyKey: true,
});

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...CONTACTS_STAFF));

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', requireRole(...INVENTORY_STAFF), controller.create);
router.patch('/:id', requireRole(...INVENTORY_STAFF), controller.update);
router.delete('/:id', requireRole(...INVENTORY_STAFF), controller.archive);

// Supplier ledger: purchases + payments made to this supplier.
router.get('/:id/ledger', async (req, res) => {
  const supplier = await prisma.supplier.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
  });
  if (!supplier) throw new NotFoundError();

  const [purchases, payments] = await Promise.all([
    prisma.purchase.findMany({
      where: { tenantId: req.user.tenantId, supplierId: supplier.id },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    }),
    prisma.payment.findMany({
      where: { tenantId: req.user.tenantId, supplierId: supplier.id },
      orderBy: { paidAt: 'desc' },
    }),
  ]);

  const totalPurchased = purchases.reduce((sum, p) => sum + Number(p.total), 0);
  const totalPaid = purchases.reduce((sum, p) => sum + Number(p.amountPaid), 0);

  res.json({ supplier, purchases, payments, balanceDue: totalPurchased - totalPaid });
});

module.exports = router;
