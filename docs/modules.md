# Modules

Per-module reference. Read the relevant section before editing a module.
Dependency direction and boundary rules live in `CLAUDE.md`.

> Status legend: ✅ implemented · 🚧 in progress · ⬜ not started

## common ✅
Pure, dependency-free helpers shared across modules.
- `money.ts` — `Money` (integer minor units + ISO 4217 currency) and arithmetic
  helpers. The single place money math happens; throws on floats and on
  currency mismatches.
- `pagination.ts` — cursor pagination (`limit`/`cursor` → `nextCursor`).
- `errors.ts` — the standard API error shape and stable error codes. (A global
  exception filter mapping exceptions to this shape is a follow-up.)

## audit ✅
Append-only audit trail.
- `AuditService.record(tx, entry)` — writes one `audit_log` row **inside the
  caller's transaction**, so the audit entry commits atomically with the action.
  If the audit write fails, the action fails.

## catalog ✅
Products. Depends on `tenancy` (scoping) and `audit`.
- `CatalogService` — `create`, `list` (cursor-paginated), `get`, `update`,
  `deactivate`. Every query is scoped by `organizationId`. Create, price/cost
  changes, and deactivation run in a `$transaction` that also writes an audit
  row. Products are soft-retired (`active = false`), never deleted.
- `price`/`cost` are integer minor units in the organization's currency.
- Every edit increments `version` (for sync conflict handling). `sku` and
  `barcode` are each unique within an organization.
- Routes: `POST/GET /v1/products`, `GET/PATCH/DELETE /v1/products/:id`.
  Guarded by JWT + tenant + permission (`catalog.read` / `catalog.write`).
- Not yet built (spec §20.3, later tiers): CSV bulk import, search,
  per-branch price overrides.

## API docs (OpenAPI + Scalar)
OpenAPI is generated from `@nestjs/swagger` decorators and rendered by **Scalar**
(not Swagger UI) at **`/reference`** (wired in `src/main.ts`). Every endpoint
carries `@ApiOperation`; DTOs carry `@ApiProperty`/`@ApiPropertyOptional`.

## auth ✅ · tenancy ✅
Owned by the other engineer. See source; do not modify their internals here.

## inventory ⬜ · payments ⬜ · sales ⬜ · sync ⬜ · notifications ⬜ · reports ⬜
Not started. `inventory` is the next module (stock ledger) and depends on
`catalog`.
