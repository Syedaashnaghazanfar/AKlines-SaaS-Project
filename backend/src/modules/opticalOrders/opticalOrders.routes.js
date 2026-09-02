const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { FRONT_DESK } = require('../../constants/roles');
const { ValidationError, NotFoundError } = require('../../utils/errors');
const { findExistingByIdempotencyKey } = require('../../utils/idempotency');

const STATUS_VALUES = ['PENDING', 'IN_LAB', 'READY', 'DELIVERED', 'CANCELLED'];

const eyeSchema = z.object({
  sphere: z.number().optional(),
  cylinder: z.number().optional(),
  axis: z.number().int().optional(),
  add: z.number().optional(),
});

const prescriptionSchema = z.object({
  od: eyeSchema.optional(),
  os: eyeSchema.optional(),
  pd: z.number().optional(),
  prescribedBy: z.string().optional(),
  prescribedAt: z.coerce.date().optional(),
  notes: z.string().optional(),
});

const createSchema = z.object({
  customerId: z.string().uuid(),
  frameDescription: z.string().optional(),
  lensDescription: z.string().optional(),
  totalAmount: z.number().nonnegative().default(0),
  amountPaid: z.number().nonnegative().default(0),
  expectedDeliveryDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  prescription: prescriptionSchema.optional(),
  idempotencyKey: z.string().optional(),
});

// amountPaid is intentionally excluded here - it can only change via POST
// /:id/pay, which also records the corresponding Payment ledger entry.
const updateSchema = createSchema
  .omit({ amountPaid: true, idempotencyKey: true })
  .partial()
  .extend({ status: z.enum(STATUS_VALUES).optional() });

function toPrescriptionData(p) {
  if (!p) return undefined;
  return {
    odSphere: p.od?.sphere,
    odCylinder: p.od?.cylinder,
    odAxis: p.od?.axis,
    odAdd: p.od?.add,
    osSphere: p.os?.sphere,
    osCylinder: p.os?.cylinder,
    osAxis: p.os?.axis,
    osAdd: p.os?.add,
    pd: p.pd,
    prescribedBy: p.prescribedBy,
    prescribedAt: p.prescribedAt,
    notes: p.notes,
  };
}

async function nextOrderNumber(tx, tenantId) {
  const count = await tx.opticalOrder.count({ where: { tenantId } });
  return `OO-${String(count + 1).padStart(6, '0')}`;
}

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...FRONT_DESK));

router.get('/', async (req, res) => {
  const { search, status, page = '1', pageSize = '20' } = req.query;
  const take = Math.min(parseInt(pageSize, 10) || 20, 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where = { tenantId: req.user.tenantId };
  if (status) where.status = status;
  if (search) where.orderNumber = { contains: search, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.opticalOrder.findMany({
      where,
      include: { customer: true, prescription: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.opticalOrder.count({ where }),
  ]);

  res.json({ items, total, page: Number(page), pageSize: take });
});

router.get('/:id', async (req, res) => {
  const item = await prisma.opticalOrder.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
    include: { customer: true, prescription: true, payments: true },
  });
  if (!item) throw new NotFoundError();
  res.json({ item });
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid optical order data', parsed.error.flatten());
  const { prescription, ...data } = parsed.data;
  if (data.amountPaid > data.totalAmount) {
    throw new ValidationError('Amount paid cannot exceed the order total');
  }

  if (data.idempotencyKey) {
    const existing = await findExistingByIdempotencyKey(prisma.opticalOrder, req.user.tenantId, data.idempotencyKey, {
      customer: true,
      prescription: true,
    });
    if (existing) return res.status(200).json({ item: existing, deduplicated: true });
  }

  const item = await prisma.$transaction(async (tx) => {
    const orderNumber = await nextOrderNumber(tx, req.user.tenantId);
    const created = await tx.opticalOrder.create({
      data: {
        ...data,
        tenantId: req.user.tenantId,
        orderNumber,
        prescription: prescription ? { create: toPrescriptionData(prescription) } : undefined,
      },
      include: { customer: true, prescription: true },
    });

    if (data.amountPaid > 0) {
      await tx.payment.create({
        data: {
          tenantId: req.user.tenantId,
          direction: 'IN',
          amount: data.amountPaid,
          opticalOrderId: created.id,
          customerId: created.customerId,
        },
      });
    }

    return created;
  });

  res.status(201).json({ item });
});

// Record an additional payment against an existing order (e.g. balance paid on
// delivery) - deposits and later payments both need to be visible in the
// Payments ledger, not just tracked as a running total on the order itself.
router.post('/:id/pay', async (req, res) => {
  const schema = z.object({ amount: z.number().positive(), method: z.string().default('cash'), note: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid payment data', parsed.error.flatten());

  const item = await prisma.$transaction(async (tx) => {
    const existing = await tx.opticalOrder.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!existing) throw new NotFoundError();

    const newPaid = Number(existing.amountPaid) + parsed.data.amount;
    if (newPaid > Number(existing.totalAmount)) {
      throw new ValidationError('Payment would exceed the order total');
    }

    await tx.payment.create({
      data: {
        tenantId: req.user.tenantId,
        direction: 'IN',
        amount: parsed.data.amount,
        method: parsed.data.method,
        note: parsed.data.note,
        opticalOrderId: existing.id,
        customerId: existing.customerId,
      },
    });

    return tx.opticalOrder.update({
      where: { id: existing.id },
      data: { amountPaid: newPaid },
      include: { customer: true, prescription: true },
    });
  });

  res.json({ item });
});

router.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid optical order data', parsed.error.flatten());
  const { prescription, ...data } = parsed.data;

  const existing = await prisma.opticalOrder.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
  });
  if (!existing) throw new NotFoundError();

  if (data.status === 'DELIVERED' && !data.deliveredAt) data.deliveredAt = new Date();

  const item = await prisma.$transaction(async (tx) => {
    if (prescription) {
      await tx.prescription.upsert({
        where: { opticalOrderId: existing.id },
        create: { opticalOrderId: existing.id, ...toPrescriptionData(prescription) },
        update: toPrescriptionData(prescription),
      });
    }
    return tx.opticalOrder.update({
      where: { id: existing.id },
      data,
      include: { customer: true, prescription: true },
    });
  });

  res.json({ item });
});

module.exports = router;
