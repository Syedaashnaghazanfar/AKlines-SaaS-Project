const express = require('express');
const { z } = require('zod');
const buildCrudController = require('../../utils/crudFactory');
const { authenticate, requireTenant, requireRole } = require('../../middleware/auth');
const { INVENTORY_STAFF, CONTACTS_STAFF } = require('../../constants/roles');

const createSchema = z.object({ name: z.string().min(1) });
const updateSchema = z.object({ name: z.string().min(1).optional(), isActive: z.boolean().optional() });

const controller = buildCrudController({ model: 'category', createSchema, updateSchema });

const router = express.Router();
router.use(authenticate, requireTenant);

router.get('/', requireRole(...CONTACTS_STAFF), controller.list);
router.get('/:id', requireRole(...CONTACTS_STAFF), controller.getOne);
router.post('/', requireRole(...INVENTORY_STAFF), controller.create);
router.patch('/:id', requireRole(...INVENTORY_STAFF), controller.update);
router.delete('/:id', requireRole(...INVENTORY_STAFF), controller.archive);

module.exports = router;
