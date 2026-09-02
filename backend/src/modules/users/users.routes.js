const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { TENANT_ADMIN_ONLY } = require('../../constants/roles');
const { hashPassword } = require('../../utils/password');
const { ValidationError, NotFoundError, ForbiddenError } = require('../../utils/errors');

const ROLE_VALUES = ['TENANT_ADMIN', 'MANAGER', 'CASHIER', 'STORE_KEEPER', 'RECEPTIONIST', 'ACCOUNTANT'];

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLE_VALUES),
  branchId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(ROLE_VALUES).optional(),
  branchId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

function sanitize(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

const router = express.Router();
router.use(authenticate, requireTenant, requireRole(...TENANT_ADMIN_ONLY));

router.get('/', async (req, res) => {
  const users = await prisma.user.findMany({
    where: { tenantId: req.user.tenantId },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ items: users.map(sanitize) });
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid user data', parsed.error.flatten());
  const { name, email, password, role, branchId } = parsed.data;

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { tenantId: req.user.tenantId, name, email: email.toLowerCase(), passwordHash, role, branchId },
  });
  res.status(201).json({ item: sanitize(user) });
});

router.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid user data', parsed.error.flatten());

  const existing = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
  });
  if (!existing) throw new NotFoundError();
  if (existing.id === req.user.id && parsed.data.isActive === false) {
    throw new ForbiddenError('You cannot deactivate your own account');
  }

  const { password, ...rest } = parsed.data;
  const data = { ...rest };
  if (password) data.passwordHash = await hashPassword(password);

  const user = await prisma.user.update({ where: { id: existing.id }, data });
  res.json({ item: sanitize(user) });
});

module.exports = router;
