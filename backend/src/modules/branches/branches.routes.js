const express = require('express');
const { z } = require('zod');
const buildCrudController = require('../../utils/crudFactory');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { TENANT_ADMIN_ONLY, ALL_ROLES } = require('../../constants/roles');

const createSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
});
const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

const controller = buildCrudController({ model: 'branch', createSchema, updateSchema });

const router = express.Router();
router.use(authenticate, requireTenant);

router.get('/', requireRole(...ALL_ROLES), controller.list);
router.get('/:id', requireRole(...ALL_ROLES), controller.getOne);
router.post('/', requireRole(...TENANT_ADMIN_ONLY), controller.create);
router.patch('/:id', requireRole(...TENANT_ADMIN_ONLY), controller.update);
router.delete('/:id', requireRole(...TENANT_ADMIN_ONLY), controller.archive);

module.exports = router;
