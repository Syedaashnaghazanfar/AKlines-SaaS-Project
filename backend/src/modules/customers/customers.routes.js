const express = require('express');
const { z } = require('zod');
const buildCrudController = require('../../utils/crudFactory');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { CONTACTS_STAFF } = require('../../constants/roles');
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
  model: 'customer',
  createSchema,
  updateSchema,
  searchFields: ['name', 'phone', 'email'],
  supportsIdempotencyKey: true,
});

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...CONTACTS_STAFF));

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.patch('/:id', controller.update);
router.delete('/:id', controller.archive);

// Transaction/history view: sales + optical orders + payments for this customer.
router.get('/:id/history', async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
  });
  if (!customer) throw new NotFoundError();

  const [sales, opticalOrders, payments] = await Promise.all([
    prisma.sale.findMany({
      where: { tenantId: req.user.tenantId, customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    }),
    prisma.opticalOrder.findMany({
      where: { tenantId: req.user.tenantId, customerId: customer.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.findMany({
      where: { tenantId: req.user.tenantId, customerId: customer.id },
      orderBy: { paidAt: 'desc' },
    }),
  ]);

  const totalSales = sales.reduce((sum, s) => sum + Number(s.total), 0);
  const totalPaid = sales.reduce((sum, s) => sum + Number(s.amountPaid), 0);

  res.json({
    customer,
    sales,
    opticalOrders,
    payments,
    balanceDue: totalSales - totalPaid,
  });
});

module.exports = router;
