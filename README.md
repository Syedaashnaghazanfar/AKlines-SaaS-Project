# AK VisionFlow — Phase 1 (Core Commercial MVP) + Phase 2 (Offline creation & sync)

Multi-tenant SaaS ERP for optical shops, eye clinics, medical stores, and lens
laboratories. **Phase 1** is a deployable MVP covering the full daily
workflow — login → products → customers/suppliers → purchases → stock →
sales/POS → payments → invoices → expenses → optical orders →
dashboard/reports. On top of that, **Phase 2** makes creating records in
POS/Sales, Purchases, Expenses, Customers, Suppliers, and Optical Orders work
offline end to end, with idempotent sync and explicit conflict handling (see
"Offline creation & sync" below).

The product is generic and tenant-independent. **Khalid Eye Clinic** is used
only as a demo/test tenant via the seed script — nothing about it is
hard-coded into the application.

## Stack

- **Backend:** Node.js + Express (REST API), Prisma ORM, PostgreSQL, JWT auth
- **Frontend:** React (Vite) SPA, Bootstrap 5, React Router, Axios
- **PWA:** Web App Manifest + Service Worker (installable app-shell caching;
  full offline transactions are Phase 2)

## Repository layout

```
backend/    Express API, Prisma schema + migrations, seed script, tests
frontend/   React + Vite SPA
docker-compose.yml   Postgres + backend + frontend, for local or VPS use
```

---

## 1. Local development setup

### Prerequisites
- Node.js 20+
- A PostgreSQL 14+ instance (via Docker, a local install, or a hosted DB)

### Backend

```bash
cd backend
npm install
cp .env.example .env      # edit DATABASE_URL, JWT_SECRET, etc.
npx prisma migrate deploy # applies the versioned migrations in prisma/migrations
npm run seed               # optional: creates a SUPER_ADMIN + demo tenant (see below)
npm run dev                 # starts the API on http://localhost:4000
```

If you're iterating on the schema itself (not just deploying it), use
`npx prisma migrate dev` instead of `migrate deploy` — it will prompt to
create a new migration from your schema changes. Never use `migrate reset`
against a database with real tenant data.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env       # set VITE_API_URL if not http://localhost:4000/api
npm run dev                 # starts the SPA on http://localhost:5173
```

### Running both via Docker Compose

```bash
docker compose up --build
# Postgres  -> localhost:5432
# Backend   -> localhost:4000
# Frontend  -> localhost:8080
```

After the containers are up, run migrations and (optionally) the seed script
inside the backend container:

```bash
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run seed
```

---

## 2. Creating a tenant (a real shop/clinic)

Two ways:

1. **Self-service:** `POST /api/auth/register-tenant` (also available from the
   frontend's "Create your account" screen) creates a new tenant, its main
   branch, and its first `TENANT_ADMIN` user in one step.
2. **Seed script (demo data only):** `npm run seed` inside `backend/` creates
   a demo tenant (default: "Khalid Eye Clinic") with sample categories,
   products, a customer, and a supplier, plus a platform `SUPER_ADMIN` user.
   This is **separate from production migrations** and should not be run
   against a production database unless you specifically want demo data.

Default seed credentials are controlled by environment variables in `.env`
(`SEED_SUPER_ADMIN_EMAIL/PASSWORD`, `SEED_DEMO_ADMIN_EMAIL/PASSWORD`) —
**change these before running the seed against anything but a local/dev
database.**

---

## Offline creation & sync (Phase 2)

Creating a record in POS/Sales, Purchases, Expenses, Customers, Suppliers, or
Optical Orders works identically online or offline.

**How it works** (`frontend/src/offline/`):
- `db.js` — a per-tenant IndexedDB database (via Dexie.js). Caches `products`,
  `customers`, `suppliers`, and `expenseCategories` for read access, plus one
  durable outbox table per entity (`pendingSales`, `pendingPurchases`,
  `pendingExpenses`, `pendingCustomers`, `pendingSuppliers`,
  `pendingOpticalOrders`).
- `syncEngine.js` — `createOutbox()` builds a full queue/sync/retry/discard
  lifecycle shared by every entity. Every create is written to its outbox
  first, with a client-generated idempotency key created once at queue time;
  `submit()` queues and then, if online, attempts to sync immediately, so the
  user never waits on the network. `syncAll()` drains every outbox at once
  (called automatically on reconnect and on app mount, or on demand via the
  "Sync Now" button in the sync status widget).
- **Idempotency is enforced server-side, not just client-side.** Every model
  that accepts offline creation (`Sale`, `Purchase`, `Expense`, `Customer`,
  `Supplier`, `OpticalOrder`) has a `@@unique([tenantId, idempotencyKey])`
  constraint; the corresponding controller looks up that key before creating
  and returns the original record on a retry instead of duplicating it. This
  is what makes a retried sync (after a dropped connection mid-request) safe.
- **Conflicts are never auto-resolved.** The sync engine relies entirely on
  each entity's existing server-side validation (e.g. the atomic stock-check
  in `POST /api/sales`) — a rejected item is marked `conflict` (409) or
  `failed` (other 4xx) and left in the sync status widget for a human to
  retry or discard. Nothing is ever silently dropped or force-applied.
- Cached lists used in offline-capable forms (products, customers, suppliers,
  expense categories) are reactive via Dexie `liveQuery`, so they reflect
  optimistic changes, completed syncs, and cache refreshes immediately.

**Known limitation:** an offline-created record (e.g. a brand-new Customer)
cannot yet be referenced by another offline-created record (e.g. a Sale for
that customer) in the same offline session, because the real server ID
doesn't exist until it syncs. Referencing an already-existing
customer/supplier/product while offline works fine. Browsing/searching full
lists (Customers, Suppliers, Purchases, Expenses, Optical Orders) still
requires connectivity — only creation is offline-capable; the underlying
server-side pagination isn't replicated into the local cache.

**Verifying it manually:** open a page (e.g. POS or Expenses) once while
online to populate its cache, then go offline (e.g. DevTools → Network →
Offline) and create a record — it should show a "saved on this device"
notice and a pending badge in the top bar. Reconnect and it should sync
automatically, the badge should update, and the record should appear in the
list.

---

## 3. Roles

`TENANT_ADMIN`, `MANAGER`, `CASHIER`, `STORE_KEEPER`, `RECEPTIONIST`,
`ACCOUNTANT` are tenant-scoped roles created via the Users page (Tenant Admin
only). `SUPER_ADMIN` is a platform-level foundation role (no `tenantId`) —
the full Master Portal for managing tenants is Phase 3. All role checks are
enforced server-side (`src/middleware/auth.js`, `src/constants/roles.js`);
the frontend only hides UI it knows the user can't use.

---

## 4. Database migrations

Migrations live in `backend/prisma/migrations/` and are version-controlled.
Rules enforced by convention in this codebase:

- Migrations are **additive** — never edit a migration that has already been
  applied to a shared/production database. Create a new one instead.
- `npx prisma migrate deploy` is the **production-safe** command — it applies
  pending migrations without ever resetting data. Never run
  `prisma migrate reset` against a database holding real tenant data.
- Soft-delete (`isActive` flags, `archivedAt`) is used for master data
  (products, customers, suppliers, categories, branches) so historical
  sales/purchases referencing them stay valid.
- Financial and stock transactions (`Sale`, `Purchase`, `InventoryTransaction`,
  `Payment`) are never physically deleted or edited after the fact — sales are
  reversed via `POST /api/sales/:id/reverse`, which restores stock and marks
  the original record `REVERSED` rather than deleting it.

---

## 5. Backup & restore (PostgreSQL)

**Backup:**
```bash
pg_dump -Fc "$DATABASE_URL" -f akvisionflow_$(date +%Y%m%d_%H%M).dump
```

**Restore (into an empty database):**
```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists akvisionflow_YYYYMMDD_HHMM.dump
```

**If running via `docker-compose.yml`**, run `pg_dump`/`pg_restore` inside the
`postgres` container instead (it has the matching client tools installed):
```bash
docker compose exec postgres pg_dump -U postgres -Fc akvisionflow -f /tmp/backup.dump
docker cp $(docker compose ps -q postgres):/tmp/backup.dump ./akvisionflow_$(date +%Y%m%d_%H%M).dump
```
To restore, copy the dump back in and run `pg_restore` the same way, ideally
into a separate database first (`CREATE DATABASE akvisionflow_restore_test;`)
to verify it before ever restoring over a live one.

Take a backup before every migration deploy against a production database,
and test the restore procedure on a staging database periodically — a backup
you have never restored from is not a verified backup. **This procedure has
been verified end-to-end**: a live backup was taken, restored into a
separate test database, and every table's row count matched the original
exactly (tenants, users, products, sales, purchases, customers).

---

## 6. Testing

```bash
cd backend
npm test
```

The included suite (`tests/api.test.js`) verifies routing, auth/RBAC gating
(every protected endpoint rejects unauthenticated requests), request
validation, and error-response shaping — none of which require a live
database. Before a production release, also run through the full workflow
against a real (throwaway) Postgres database and confirm:

**Frontend (offline sync engine):**
```bash
cd frontend
npm test
```

`src/offline/syncEngine.test.js` covers the generic outbox (`createOutbox()`)
against a real in-memory IndexedDB (via `fake-indexeddb`), with only the
network (`apiClient`) mocked: idempotency-key stability across retries,
conflict (409) vs. failure (4xx) handling, a conflict never blocking the rest
of the queue, network errors halting the drain without touching later items,
optimistic stock effects for Sales/Purchases, and `syncAll()` draining every
entity independently. Note: Vitest's default `forks` worker pool hangs in
this project's sandboxed dev environment (process spawning is restricted) -
`vitest.config.js` sets `pool: 'threads'` to work around it; if tests hang
with "no tests" and a worker-timeout error elsewhere, that's the cause.

- [ ] Tenant registration + login
- [ ] A user from Tenant A cannot see Tenant B's data (tenant isolation)
- [ ] Role permission boundaries (e.g. a Cashier cannot access Users)
- [ ] Product create with opening stock creates an `OPENING_STOCK` inventory transaction
- [ ] Purchase → receive stock increases product stock atomically
- [ ] Sale → stock deduction is atomic and blocks over-selling (unless the
      `allowNegativeStock` tenant setting is explicitly enabled)
- [ ] Sale reversal restores stock and preserves the original sale record
- [ ] Reports return correct totals against known seed data
- [ ] `prisma migrate deploy` runs cleanly against a fresh database

---

## 7. API overview

All endpoints are under `/api` and (except `/api/health`, `/api/auth/login`,
`/api/auth/register-tenant`) require `Authorization: Bearer <JWT>`.

| Module | Base path |
|---|---|
| Auth | `/api/auth` (register-tenant, login, me) |
| Users | `/api/users` (Tenant Admin only) |
| Branches | `/api/branches` |
| Categories | `/api/categories` |
| Products | `/api/products` (+ `/:id/adjust-stock`) |
| Customers | `/api/customers` (+ `/:id/history`) |
| Suppliers | `/api/suppliers` (+ `/:id/ledger`) |
| Purchases | `/api/purchases` (+ `/:id/receive`, `/:id/pay`) |
| Sales / POS | `/api/sales` (+ `/:id/reverse`) |
| Inventory | `/api/inventory/transactions` |
| Optical Orders | `/api/optical-orders` |
| Expense Categories | `/api/expense-categories` |
| Expenses | `/api/expenses` |
| Payments | `/api/payments` (read-only ledger view) |
| Dashboard | `/api/dashboard` |
| Reports | `/api/reports/{sales/daily, sales/monthly, inventory, stock-movement, expenses, profit-loss, optical-orders, medicine-expiry}` |
| Settings | `/api/settings` |

All list endpoints support `page`, `pageSize`, and (where relevant) `search`
query params and return `{ items, total, page, pageSize }`.

---

## 8. Deployment checklist

1. Provision PostgreSQL and set `DATABASE_URL`.
2. Set a strong `JWT_SECRET` and correct `CORS_ORIGINS` in the backend `.env`.
3. `npx prisma migrate deploy` (never `migrate dev`/`reset` in production).
4. Build and run the backend (`npm run build` step is not required for the
   Express API; `npm start` runs it directly, or use `backend/Dockerfile`).
5. Build the frontend (`npm run build` in `frontend/`, or `frontend/Dockerfile`
   which serves the built SPA via nginx) with `VITE_API_URL` pointed at the
   deployed API's public URL.
6. Serve both over HTTPS (terminate TLS at your load balancer/reverse proxy
   — this is not done inside the containers).
7. Take a database backup, then smoke-test: register a tenant, log in, create
   a product, complete a POS sale, view the dashboard.

`docker-compose.yml` at the repo root brings up Postgres + backend + frontend
together for a single-VPS deployment; for a managed PaaS, deploy `backend/`
and `frontend/` as separate services pointing at a managed Postgres instance.

---

## 9. What's intentionally NOT in Phase 1

Per the product roadmap: Master/Super Admin portal, subscription billing UI,
full offline transaction engine and sync, push notifications, WhatsApp/SMS
integration, EMR/OPD, AI prescription reading, OCT integration, hospital
management. The architecture (tenant isolation, versioned migrations,
idempotency keys on sales, immutable/reversal-based financial records) is
built so these can be added later as versioned updates without disturbing
existing tenant data.
