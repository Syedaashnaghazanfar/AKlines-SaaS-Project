const { z } = require('zod');
const prisma = require('../../config/prisma');
const { hashPassword, verifyPassword } = require('../../utils/password');
const { signToken } = require('../../utils/jwt');
const { UnauthorizedError, ValidationError } = require('../../utils/errors');
const { logAudit } = require('../../middleware/audit');

const registerTenantSchema = z.object({
  businessName: z.string().min(2),
  adminName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
});

async function registerTenant(req, res) {
  const parsed = registerTenantSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid registration data', parsed.error.flatten());
  const { businessName, adminName, email, password, phone } = parsed.data;

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: businessName,
        businessName,
        phone,
        subscription: { create: { plan: 'trial', status: 'TRIAL' } },
      },
    });

    const branch = await tx.branch.create({
      data: { tenantId: tenant.id, name: 'Main Branch', isMain: true },
    });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        name: adminName,
        email: email.toLowerCase(),
        passwordHash,
        role: 'TENANT_ADMIN',
      },
    });

    return { tenant, user };
  });

  const token = signToken(result.user);
  res.status(201).json({
    token,
    user: sanitizeUser(result.user),
    tenant: result.tenant,
  });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid login data', parsed.error.flatten());
  const { email, password } = parsed.data;

  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive) throw new UnauthorizedError('Invalid email or password');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new UnauthorizedError('Invalid email or password');

  if (user.tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
    if (!tenant || !tenant.isActive) throw new UnauthorizedError('Tenant account is inactive');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signToken(user);
  req.user = { id: user.id, tenantId: user.tenantId, role: user.role };
  await logAudit({ req, action: 'LOGIN', entity: 'User', entityId: user.id });

  res.json({ token, user: sanitizeUser(user) });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { tenant: true, branch: true },
  });
  res.json({ user: sanitizeUser(user), tenant: user.tenant, branch: user.branch });
}

function sanitizeUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

module.exports = { registerTenant, login, me };
