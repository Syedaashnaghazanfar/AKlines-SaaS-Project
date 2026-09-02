const { verifyToken } = require('../utils/jwt');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const prisma = require('../config/prisma');

// Verifies the JWT and attaches req.user = { id, tenantId, role }.
// Re-checks the user record so a deactivated user/tenant loses access immediately,
// not only after their token expires.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    throw new UnauthorizedError('Invalid or expired token');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    throw new UnauthorizedError('Account is inactive or no longer exists');
  }
  if (user.tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
    if (!tenant || !tenant.isActive) {
      throw new ForbiddenError('Tenant account is inactive');
    }
  }

  req.user = {
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
    branchId: user.branchId,
    name: user.name,
    email: user.email,
  };
  next();
}

// Requires a tenant-scoped user (blocks platform-only SUPER_ADMIN users from
// tenant business endpoints unless they've been given a tenantId).
function requireTenant(req, res, next) {
  if (!req.user.tenantId) {
    throw new ForbiddenError('This action requires an active tenant context');
  }
  next();
}

// Role-based access control. Server-side only - never trust a client-supplied role.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError('You do not have permission to perform this action');
    }
    next();
  };
}

module.exports = { authenticate, requireTenant, requireRole };
