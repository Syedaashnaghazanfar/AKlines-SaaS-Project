const prisma = require('../config/prisma');

// Fire-and-forget audit log write. Never throws into the request path -
// an audit logging failure must not block the business operation itself.
async function logAudit({ req, action, entity, entityId, metadata }) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: req.user?.tenantId ?? null,
        userId: req.user?.id ?? null,
        action,
        entity,
        entityId,
        metadata,
        ipAddress: req.ip,
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

module.exports = { logAudit };
