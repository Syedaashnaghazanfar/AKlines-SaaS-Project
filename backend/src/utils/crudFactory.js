const prisma = require('../config/prisma');
const { NotFoundError, ValidationError } = require('./errors');
const { findExistingByIdempotencyKey } = require('./idempotency');

// Generic tenant-scoped CRUD controller factory for simple master-data
// entities (categories, customers, suppliers, branches, expense categories).
// Business-logic-heavy modules (products, sales, purchases, optical orders)
// have their own hand-written controllers instead of using this.
function buildCrudController({
  model, // prisma model name, e.g. 'customer'
  createSchema,
  updateSchema,
  searchFields = ['name'],
  defaultOrderBy = { createdAt: 'desc' },
  includeArchivedField = true,
  // Set for models with a @@unique([tenantId, idempotencyKey]) constraint -
  // lets an offline-queued create be retried safely without duplicating.
  supportsIdempotencyKey = false,
}) {
  const delegate = prisma[model];

  async function list(req, res) {
    const { search, page = '1', pageSize = '20', includeInactive } = req.query;
    const take = Math.min(parseInt(pageSize, 10) || 20, 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const where = { tenantId: req.user.tenantId };
    if (includeArchivedField && includeInactive !== 'true') {
      where.isActive = true;
    }
    if (search) {
      where.OR = searchFields.map((field) => ({
        [field]: { contains: search, mode: 'insensitive' },
      }));
    }

    const [items, total] = await Promise.all([
      delegate.findMany({ where, orderBy: defaultOrderBy, skip, take }),
      delegate.count({ where }),
    ]);

    res.json({ items, total, page: Number(page), pageSize: take });
  }

  async function getOne(req, res) {
    const item = await delegate.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!item) throw new NotFoundError();
    res.json({ item });
  }

  async function create(req, res) {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid data', parsed.error.flatten());

    if (supportsIdempotencyKey && parsed.data.idempotencyKey) {
      const existing = await findExistingByIdempotencyKey(delegate, req.user.tenantId, parsed.data.idempotencyKey);
      if (existing) return res.status(200).json({ item: existing, deduplicated: true });
    }

    const item = await delegate.create({
      data: { ...parsed.data, tenantId: req.user.tenantId },
    });
    res.status(201).json({ item });
  }

  async function update(req, res) {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid data', parsed.error.flatten());

    const existing = await delegate.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!existing) throw new NotFoundError();

    const item = await delegate.update({ where: { id: existing.id }, data: parsed.data });
    res.json({ item });
  }

  // Soft-delete: business master data is archived, never physically removed,
  // so historical sales/purchases referencing it remain valid.
  async function archive(req, res) {
    const existing = await delegate.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!existing) throw new NotFoundError();

    const item = await delegate.update({ where: { id: existing.id }, data: { isActive: false } });
    res.json({ item });
  }

  return { list, getOne, create, update, archive };
}

module.exports = buildCrudController;
